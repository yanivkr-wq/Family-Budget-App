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
