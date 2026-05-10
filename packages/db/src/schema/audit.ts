import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { households, users } from './identity';

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: text().notNull(), // 'create' | 'update' | 'delete' | 'restore' | 'scrape' | 'login' | ...
    entityType: text().notNull(), // 'transaction' | 'category' | 'rule' | 'account' | 'auth' | ...
    entityId: text(),
    beforeJson: jsonb(),
    afterJson: jsonb(),
    ip: text(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    householdIdx: index().on(t.householdId, t.createdAt),
    entityIdx: index().on(t.entityType, t.entityId),
    actorIdx: index().on(t.actorUserId, t.createdAt),
  }),
);

/**
 * In-app feedback the admin captures while using the app — bugs, UX
 * complaints, feature ideas, anything they want to remember to fix
 * later. Exported as Markdown from /admin/feedback so the next dev
 * session (e.g., handed to Claude Code) can act on the list.
 */
export const feedback = pgTable(
  'feedback',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** Free taxonomy — drives the badge color in the list. */
    category: text({ enum: ['bug', 'ux', 'feature', 'other'] })
      .notNull()
      .default('other'),
    message: text().notNull(),
    /** URL pathname when the feedback was submitted (best-effort context
     *  for "this page is confusing" type notes). */
    pagePath: text(),
    /** Browser UA — useful for "this only happens on mobile" repros. */
    userAgent: text(),
    status: text({ enum: ['open', 'in_progress', 'pending_validation', 'resolved', 'dismissed'] })
      .notNull()
      .default('open'),
    /** Optional inline base64 PNG (with data: URI prefix) captured via the
     *  camera button in the feedback widget. NULL for text-only feedback. */
    screenshotData: text(),
    resolvedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    householdIdx: index().on(t.householdId, t.createdAt),
    statusIdx:    index().on(t.householdId, t.status),
  }),
);

export const undoStack = pgTable(
  'undo_stack',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    action: text().notNull(), // 'transaction.delete' | 'transaction.update' | 'category.delete' | ...
    payload: jsonb().notNull(), // enough info to reverse the action
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index().on(t.userId, t.expiresAt),
  }),
);

// LLM/categorizer payload audit — records what was sent to Anthropic.
export const categorizationLog = pgTable(
  'categorization_log',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    transactionId: uuid(),
    merchantNormalized: text().notNull(),
    amountIls: text().notNull(),
    requestPayload: jsonb().notNull(), // exact payload sent to Anthropic
    responseCategoryId: uuid(),
    responseSubCategoryId: uuid(),
    confidence: text(), // 0..1 as text
    model: text().notNull(),
    tokensIn: text(),
    tokensOut: text(),
    durationMs: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    householdIdx: index().on(t.householdId, t.createdAt),
    txnIdx: index().on(t.transactionId),
  }),
);
