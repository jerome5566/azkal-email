-- ============================================================================
-- Azkal Email Platform: database-level safety guards
-- Run this AFTER the generated schema migration.
-- These are the guarantees that do not live in application code.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Suppression mirror.
--    Keeps email_identities.is_suppressed in sync so the Contacts UI can filter
--    cheaply. This is a convenience mirror, NOT the enforcement mechanism.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_suppression_mirror() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE email_identities
       SET is_suppressed = TRUE
     WHERE email_normalized = NEW.email_normalized;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE email_identities
       SET is_suppressed = FALSE
     WHERE email_normalized = OLD.email_normalized;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_suppression_mirror ON suppression_list;
CREATE TRIGGER trg_suppression_mirror
AFTER INSERT OR DELETE ON suppression_list
FOR EACH ROW EXECUTE FUNCTION sync_suppression_mirror();


-- ----------------------------------------------------------------------------
-- 2. Suppression enforcement.
--    A recipient row can NEVER enter 'processing' if its address is suppressed.
--    Instead of erroring, it is diverted to 'suppressed' so the queue drains
--    cleanly and the reason stays visible. This is the hard guarantee: even a
--    bug in the worker cannot route around it.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION block_suppressed_send() RETURNS trigger AS $$
DECLARE
  addr TEXT;
BEGIN
  IF NEW.status = 'processing' AND (OLD.status IS DISTINCT FROM 'processing') THEN
    SELECT ei.email_normalized INTO addr
      FROM email_identities ei
     WHERE ei.id = NEW.email_identity_id;

    IF EXISTS (SELECT 1 FROM suppression_list s WHERE s.email_normalized = addr) THEN
      NEW.status := 'suppressed';
      NEW.claimed_at := NULL;
      NEW.last_error := 'Blocked at send time: address is on the suppression list';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_suppressed_send ON campaign_recipients;
CREATE TRIGGER trg_block_suppressed_send
BEFORE UPDATE ON campaign_recipients
FOR EACH ROW EXECUTE FUNCTION block_suppressed_send();


-- ----------------------------------------------------------------------------
-- 3. Terminal state protection.
--    Once a row is sent/delivered/bounced it must never go back to pending.
--    Prevents an accidental requeue from producing a duplicate send.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION protect_terminal_states() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('sent','delivered','bounced')
     AND NEW.status IN ('pending','processing') THEN
    RAISE EXCEPTION
      'Refusing to move recipient % from % back to % (would risk a duplicate send)',
      OLD.id, OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_terminal_states ON campaign_recipients;
CREATE TRIGGER trg_protect_terminal_states
BEFORE UPDATE ON campaign_recipients
FOR EACH ROW EXECUTE FUNCTION protect_terminal_states();


-- ----------------------------------------------------------------------------
-- 4. Exclusion cascade.
--    Adding an address to suppression immediately pulls every pending row for
--    that address out of every queue, in the same transaction. This is what
--    makes the Exclude button take effect on already-queued contacts.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cascade_suppression_to_queues() RETURNS trigger AS $$
BEGIN
  UPDATE campaign_recipients cr
     SET status = 'excluded',
         last_error = 'Excluded after being added to the suppression list'
    FROM email_identities ei
   WHERE cr.email_identity_id = ei.id
     AND ei.email_normalized = NEW.email_normalized
     AND cr.status = 'pending';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cascade_suppression ON suppression_list;
CREATE TRIGGER trg_cascade_suppression
AFTER INSERT ON suppression_list
FOR EACH ROW EXECUTE FUNCTION cascade_suppression_to_queues();


-- ----------------------------------------------------------------------------
-- 5. The claim function.
--    The single entry point the worker uses to take work off the queue.
--
--    Properties:
--      * FOR UPDATE SKIP LOCKED  -> two workers can never claim the same row
--      * suppression joined in   -> a suppressed row is never even returned
--      * usage incremented in    -> the daily cap cannot be overshot by a race
--        the same transaction
--      * commits BEFORE sending  -> a crash leaves rows in 'processing', which
--        the reaper marks 'unknown'. At-most-once, never at-least-once.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claim_recipients(
  p_campaign_id INT,
  p_batch_size  INT,
  p_global_cap  INT,
  p_usage_date  DATE
)
RETURNS TABLE (
  recipient_id     BIGINT,
  identity_id      BIGINT,
  email_raw        TEXT,
  merge_data       JSONB
) AS $$
DECLARE
  v_global_used   INT;
  v_campaign_used INT;
  v_campaign_cap  INT;
  v_allowed       INT;
BEGIN
  -- Lock the counter rows first so concurrent workers serialise here.
  INSERT INTO daily_sending_usage (usage_date, campaign_id, sent_count)
       VALUES (p_usage_date, 0, 0)
  ON CONFLICT DO NOTHING;

  INSERT INTO daily_sending_usage (usage_date, campaign_id, sent_count)
       VALUES (p_usage_date, p_campaign_id, 0)
  ON CONFLICT DO NOTHING;

  SELECT sent_count INTO v_global_used
    FROM daily_sending_usage
   WHERE usage_date = p_usage_date AND campaign_id = 0
     FOR UPDATE;

  SELECT sent_count INTO v_campaign_used
    FROM daily_sending_usage
   WHERE usage_date = p_usage_date AND campaign_id = p_campaign_id
     FOR UPDATE;

  SELECT daily_limit INTO v_campaign_cap
    FROM campaigns WHERE id = p_campaign_id;

  -- The tightest of: batch size, remaining global quota, remaining campaign quota
  v_allowed := LEAST(
    p_batch_size,
    GREATEST(p_global_cap  - v_global_used,   0),
    GREATEST(v_campaign_cap - v_campaign_used, 0)
  );

  IF v_allowed <= 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT cr.id
      FROM campaign_recipients cr
      JOIN email_identities ei ON ei.id = cr.email_identity_id
     WHERE cr.campaign_id = p_campaign_id
       AND cr.status = 'pending'
       AND NOT EXISTS (
             SELECT 1 FROM suppression_list s
              WHERE s.email_normalized = ei.email_normalized
           )
     ORDER BY cr.id
       FOR UPDATE OF cr SKIP LOCKED
     LIMIT v_allowed
  ),
  claimed AS (
    UPDATE campaign_recipients cr
       SET status        = 'processing',
           claimed_at    = NOW(),
           attempt_count = cr.attempt_count + 1
      FROM picked p
     WHERE cr.id = p.id
    RETURNING cr.id, cr.email_identity_id, cr.merge_data
  ),
  bumped AS (
    UPDATE daily_sending_usage d
       SET sent_count = d.sent_count + (SELECT COUNT(*) FROM claimed)
     WHERE d.usage_date = p_usage_date
       AND d.campaign_id IN (0, p_campaign_id)
    RETURNING 1
  )
  SELECT c.id, c.email_identity_id, ei.email_raw, c.merge_data
    FROM claimed c
    JOIN email_identities ei ON ei.id = c.email_identity_id;
END;
$$ LANGUAGE plpgsql;


-- ----------------------------------------------------------------------------
-- 6. The reaper.
--    Anything stuck in 'processing' past the timeout is marked 'unknown' and
--    is never retried automatically. A human decides. This is the deliberate
--    trade: we would rather miss a send than send twice.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reap_stale_sends(p_timeout_minutes INT DEFAULT 10)
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  WITH stale AS (
    UPDATE campaign_recipients
       SET status = 'unknown',
           last_error = 'Worker stopped mid-send. Delivery is uncertain, so this '
                     || 'was not retried. Review and decide manually.'
     WHERE status = 'processing'
       AND claimed_at < NOW() - (p_timeout_minutes || ' minutes')::INTERVAL
    RETURNING id, campaign_id, email_identity_id
  )
  INSERT INTO sending_events (campaign_recipient_id, campaign_id, email_identity_id, event_type)
  SELECT id, campaign_id, email_identity_id, 'unknown' FROM stale;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;


-- ----------------------------------------------------------------------------
-- 7. Contact search index. Trigram search across email, name and office.
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS email_identities_email_trgm
  ON email_identities USING gin (email_normalized gin_trgm_ops);

CREATE INDEX IF NOT EXISTS brokers_name_trgm
  ON brokers USING gin (name_en gin_trgm_ops);

CREATE INDEX IF NOT EXISTS brokers_office_trgm
  ON brokers USING gin (office_name_en gin_trgm_ops);

CREATE INDEX IF NOT EXISTS agencies_name_trgm
  ON agencies USING gin (name_en gin_trgm_ops);


-- ----------------------------------------------------------------------------
-- 8. Default settings.
-- ----------------------------------------------------------------------------

INSERT INTO system_settings (key, value) VALUES
  ('global_daily_limit',   '500'::jsonb),
  ('send_window_start',    '"08:00"'::jsonb),
  ('send_window_end',      '"18:00"'::jsonb),
  ('send_days',            '[0,1,2,3,4,5,6]'::jsonb),
  ('timezone',             '"Asia/Dubai"'::jsonb),
  ('warmup_enabled',       'true'::jsonb),
  ('warmup_schedule',      '[20,20,35,35,50,75,100,100,150,150,200,250,300,350,400,450,500]'::jsonb),
  ('warmup_started_on',    'null'::jsonb),
  ('from_name',            '"Azkal Media"'::jsonb),
  ('from_email',           '"hello@azkalmedia.agency"'::jsonb),
  ('reply_to',             '""'::jsonb),
  ('postal_address',       '""'::jsonb),
  ('sender_paused',        'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
