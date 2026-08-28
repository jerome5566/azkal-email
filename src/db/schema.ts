import {
  pgTable,
  serial,
  bigserial,
  bigint,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  date,
  numeric,
  index,
  uniqueIndex,
  primaryKey,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/* ------------------------------------------------------------------ enums */

export const providerTypeEnum = pgEnum("provider_type", [
  "gmail",
  "outlook",
  "yahoo",
  "other_free",
  "company",
  "unknown",
]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "valid",
  "invalid",
  "risky",
  "unknown",
]);

export const sourceTypeEnum = pgEnum("source_type", ["broker", "agency"]);

export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "scheduled",
  "running",
  "paused",
  "stopped",
  "completed",
]);

export const recipientStatusEnum = pgEnum("recipient_status", [
  "pending",
  "processing",
  "sent",
  "delivered",
  "bounced",
  "failed",
  "unknown",
  "excluded",
  "suppressed",
]);

export const suppressionReasonEnum = pgEnum("suppression_reason", [
  "manual",
  "unsubscribe",
  "hard_bounce",
  "repeated_soft_bounce",
  "complaint",
  "invalid_address",
]);

export const eventTypeEnum = pgEnum("event_type", [
  "queued",
  "claimed",
  "sent",
  "delivered",
  "hard_bounce",
  "soft_bounce",
  "complaint",
  "unsubscribe",
  "failed",
  "unknown",
]);

export const importStatusEnum = pgEnum("import_status", [
  "uploaded",
  "mapping",
  "processing",
  "completed",
  "failed",
]);

/* ------------------------------------------------------------------ users */

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  totpSecret: text("totp_secret"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

/* -------------------------------------------------------- email identities */
/* The canonical unit. One row per real mailbox, no matter how many broker or
   agency rows point at it. Everything else in the system references this.    */

export const emailIdentities = pgTable(
  "email_identities",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    emailRaw: text("email_raw").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    localPart: text("local_part").notNull(),
    domain: text("domain").notNull(),
    providerType: providerTypeEnum("provider_type").default("unknown").notNull(),
    isRoleAccount: boolean("is_role_account").default(false).notNull(),
    hasMx: boolean("has_mx"),
    mxCheckedAt: timestamp("mx_checked_at", { withTimezone: true }),
    verificationStatus: verificationStatusEnum("verification_status"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    // Denormalised mirror of suppression_list, kept in sync by trigger.
    // Convenience for filtering only. The trigger and the claim query are
    // what actually enforce suppression.
    isSuppressed: boolean("is_suppressed").default(false).notNull(),
    contactedCount: integer("contacted_count").default(0).notNull(),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    normUnique: uniqueIndex("email_identities_normalized_key").on(t.emailNormalized),
    domainIdx: index("email_identities_domain_idx").on(t.domain),
    providerIdx: index("email_identities_provider_idx").on(t.providerType),
    suppressedIdx: index("email_identities_suppressed_idx").on(t.isSuppressed),
    verificationIdx: index("email_identities_verification_idx").on(t.verificationStatus),
  })
);

/* -------------------------------------------------------- source records */

export const brokers = pgTable(
  "brokers",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    emailIdentityId: bigint("email_identity_id", { mode: "number" })
      .notNull()
      .references(() => emailIdentities.id, { onDelete: "cascade" }),
    brokerNumber: text("broker_number"),
    nameEn: text("name_en"),
    nameAr: text("name_ar"),
    officeNameEn: text("office_name_en"),
    officeNameAr: text("office_name_ar"),
    phone: text("phone"),
    importBatchId: integer("import_batch_id"),
    rawRow: jsonb("raw_row"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    identityIdx: index("brokers_identity_idx").on(t.emailIdentityId),
    numberIdx: index("brokers_number_idx").on(t.brokerNumber),
  })
);

export const agencies = pgTable(
  "agencies",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    emailIdentityId: bigint("email_identity_id", { mode: "number" })
      .notNull()
      .references(() => emailIdentities.id, { onDelete: "cascade" }),
    officeNumber: text("office_number"),
    nameEn: text("name_en"),
    nameAr: text("name_ar"),
    website: text("website"),
    phone: text("phone"),
    importBatchId: integer("import_batch_id"),
    rawRow: jsonb("raw_row"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    identityIdx: index("agencies_identity_idx").on(t.emailIdentityId),
    numberIdx: index("agencies_number_idx").on(t.officeNumber),
  })
);

/* --------------------------------------------------------- verification */
/* Append-only. Never overwrites the imported source data.                 */

export const verificationResults = pgTable(
  "verification_results",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    emailIdentityId: bigint("email_identity_id", { mode: "number" })
      .notNull()
      .references(() => emailIdentities.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // "local_mx", "zerobounce", ...
    status: verificationStatusEnum("status").notNull(),
    reason: text("reason"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
    raw: jsonb("raw"),
  },
  (t) => ({
    identityIdx: index("verification_identity_idx").on(t.emailIdentityId),
  })
);

/* ---------------------------------------------------------- suppression */

export const suppressionList = pgTable(
  "suppression_list",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    emailNormalized: text("email_normalized").notNull(),
    reason: suppressionReasonEnum("reason").notNull(),
    note: text("note"),
    sourceCampaignId: integer("source_campaign_id"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailUnique: uniqueIndex("suppression_email_key").on(t.emailNormalized),
  })
);

/* ------------------------------------------------------------ templates */

export const templates = pgTable("templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  textBody: text("text_body").notNull(),
  requiredMergeFields: jsonb("required_merge_fields").$type<string[]>().default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------ campaigns */

export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: campaignStatusEnum("status").default("draft").notNull(),
  templateId: integer("template_id").references(() => templates.id),
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  replyTo: text("reply_to").notNull(),
  dailyLimit: integer("daily_limit").default(500).notNull(),
  sendWindowStart: text("send_window_start").default("08:00").notNull(),
  sendWindowEnd: text("send_window_end").default("18:00").notNull(),
  // 0 = Sunday .. 6 = Saturday. Default: every day.
  sendDays: jsonb("send_days").$type<number[]>().default([0, 1, 2, 3, 4, 5, 6]).notNull(),
  timezone: text("timezone").default("Asia/Dubai").notNull(),
  excludePreviouslyContacted: boolean("exclude_previously_contacted").default(true).notNull(),
  maxBounceRate: numeric("max_bounce_rate", { precision: 5, scale: 2 }).default("5.00").notNull(),
  maxFailureRate: numeric("max_failure_rate", { precision: 5, scale: 2 }).default("10.00").notNull(),
  pausedReason: text("paused_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
});

/* -------------------------------------------------- campaign recipients */
/* This table IS the queue. UNIQUE(campaign, identity) makes a contact
   physically incapable of being queued twice for the same campaign.       */

export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    emailIdentityId: bigint("email_identity_id", { mode: "number" })
      .notNull()
      .references(() => emailIdentities.id, { onDelete: "cascade" }),
    status: recipientStatusEnum("status").default("pending").notNull(),
    mergeData: jsonb("merge_data").$type<Record<string, string>>().default({}).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    messageId: text("message_id"),
    smtpQueueId: text("smtp_queue_id"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    lastSmtpCode: text("last_smtp_code"),
    lastError: text("last_error"),
    unsubToken: text("unsub_token"),
  },
  (t) => ({
    onePerCampaign: uniqueIndex("campaign_recipients_unique").on(t.campaignId, t.emailIdentityId),
    claimIdx: index("campaign_recipients_claim_idx").on(t.campaignId, t.status, t.id),
    identityIdx: index("campaign_recipients_identity_idx").on(t.emailIdentityId),
    tokenIdx: uniqueIndex("campaign_recipients_token_idx").on(t.unsubToken),
  })
);

/* -------------------------------------------------------- sending events */

export const sendingEvents = pgTable(
  "sending_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    campaignRecipientId: bigint("campaign_recipient_id", { mode: "number" }),
    campaignId: integer("campaign_id"),
    emailIdentityId: bigint("email_identity_id", { mode: "number" }),
    eventType: eventTypeEnum("event_type").notNull(),
    smtpCode: text("smtp_code"),
    smtpResponse: text("smtp_response"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    raw: jsonb("raw"),
  },
  (t) => ({
    campaignIdx: index("sending_events_campaign_idx").on(t.campaignId, t.occurredAt),
    typeIdx: index("sending_events_type_idx").on(t.eventType, t.occurredAt),
  })
);

/* ---------------------------------------------------- daily sending usage */
/* campaignId 0 is the reserved global counter row.                          */

export const dailySendingUsage = pgTable(
  "daily_sending_usage",
  {
    usageDate: date("usage_date").notNull(),
    campaignId: integer("campaign_id").notNull(),
    sentCount: integer("sent_count").default(0).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.usageDate, t.campaignId] }),
  })
);

/* ------------------------------------------------------------- settings */

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* --------------------------------------------------------------- import */

export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  sourceType: sourceTypeEnum("source_type").notNull(),
  status: importStatusEnum("status").default("uploaded").notNull(),
  encoding: text("encoding"),
  columnMap: jsonb("column_map").$type<Record<string, string>>(),
  totalRows: integer("total_rows").default(0).notNull(),
  uniqueEmails: integer("unique_emails").default(0).notNull(),
  newEmails: integer("new_emails").default(0).notNull(),
  existingEmails: integer("existing_emails").default(0).notNull(),
  invalidRows: integer("invalid_rows").default(0).notNull(),
  blankEmailRows: integer("blank_email_rows").default(0).notNull(),
  storagePath: text("storage_path"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const importRowErrors = pgTable(
  "import_row_errors",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    importBatchId: integer("import_batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    reason: text("reason").notNull(),
    rawRow: jsonb("raw_row"),
  },
  (t) => ({ batchIdx: index("import_row_errors_batch_idx").on(t.importBatchId) })
);

/* ---------------------------------------------------------- activity log */

export const activityLog = pgTable(
  "activity_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actor: text("actor"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    detail: jsonb("detail"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ createdIdx: index("activity_log_created_idx").on(t.createdAt) })
);

/* ------------------------------------------------------------- relations */

export const emailIdentityRelations = relations(emailIdentities, ({ many }) => ({
  brokers: many(brokers),
  agencies: many(agencies),
  verifications: many(verificationResults),
  recipients: many(campaignRecipients),
}));

export const brokerRelations = relations(brokers, ({ one }) => ({
  identity: one(emailIdentities, {
    fields: [brokers.emailIdentityId],
    references: [emailIdentities.id],
  }),
}));

export const agencyRelations = relations(agencies, ({ one }) => ({
  identity: one(emailIdentities, {
    fields: [agencies.emailIdentityId],
    references: [emailIdentities.id],
  }),
}));

export const campaignRelations = relations(campaigns, ({ one, many }) => ({
  template: one(templates, { fields: [campaigns.templateId], references: [templates.id] }),
  recipients: many(campaignRecipients),
}));

export const recipientRelations = relations(campaignRecipients, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignRecipients.campaignId],
    references: [campaigns.id],
  }),
  identity: one(emailIdentities, {
    fields: [campaignRecipients.emailIdentityId],
    references: [emailIdentities.id],
  }),
}));
