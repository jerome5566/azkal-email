# Azkal Media Email Platform

Internal email sending platform. Import, verify, exclude, campaign, send, monitor.

## What is built (sprint 1)

- Full database schema, all 15 tables
- Suppression and duplicate-send guarantees enforced by database triggers
- Auth (argon2, HTTP-only session cookie, login throttle)
- Dashboard with live figures
- CSV import: encoding detection, column mapping, streaming parse, dedupe, reconciliation
- Contacts: search, six filter axes, pagination, one-click exclude
- Exclusions, Verification, Activity Log, Settings, Sending Server pages

## Not built yet (sprint 2 and 3)

Campaign builder, template editor, send worker, Postfix integration.
The schema and queue logic for all three are already in place and tested.

## Local development

    cp .env.example .env      # fill in DATABASE_URL and SESSION_SECRET
    npm install
    npm run db:generate       # only if you changed src/db/schema.ts
    npm run db:migrate
    npm run admin:create
    npm run dev

## Verified behaviour

Eight safety guarantees are tested against a real Postgres:

1. A contact cannot be queued twice for the same campaign
2. Excluding cascades to every pending queue row in the same transaction
3. The claim query never returns a suppressed address
4. Daily usage increments on both the global and per-campaign counters
5. The global cap stops claiming even when a campaign has quota left
6. A crashed send is marked `unknown` and never auto-retried
7. A sent row cannot be moved back into the queue
8. A forced update to `processing` on a suppressed address is diverted by the trigger

