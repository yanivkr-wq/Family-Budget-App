import { relations } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { households, users } from './identity';

export const chatSessions = pgTable(
  'chat_session',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text(), // auto-generated from first message
    startedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    lastMessageAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    userIdx: index().on(t.userId, t.lastMessageAt),
  }),
);

export const chatMessages = pgTable(
  'chat_message',
  {
    id: uuid().defaultRandom().primaryKey(),
    sessionId: uuid()
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: text({ enum: ['user', 'assistant', 'tool'] }).notNull(),
    // contentEncrypted holds the raw Anthropic content blocks (text, tool_use, tool_result)
    // as a JSON array, then encrypted with MASTER_KEY (libsodium secretbox), base64.
    contentEncrypted: text().notNull(),
    model: text(),
    tokensIn: integer(),
    tokensOut: integer(),
    stopReason: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sessionIdx: index().on(t.sessionId, t.createdAt),
  }),
);

export const chatToolCallLog = pgTable(
  'chat_tool_call_log',
  {
    id: uuid().defaultRandom().primaryKey(),
    messageId: uuid()
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    toolName: text().notNull(),
    argsJson: jsonb().notNull(),
    resultSummary: text(), // first ~500 chars of result, for quick scan
    rowsReturned: integer(),
    durationMs: integer(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    messageIdx: index().on(t.messageId),
    toolNameIdx: index().on(t.toolName, t.createdAt),
  }),
);

export const chatSessionsRelations = relations(chatSessions, ({ many, one }) => ({
  household: one(households, { fields: [chatSessions.householdId], references: [households.id] }),
  user: one(users, { fields: [chatSessions.userId], references: [users.id] }),
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one, many }) => ({
  session: one(chatSessions, { fields: [chatMessages.sessionId], references: [chatSessions.id] }),
  toolCalls: many(chatToolCallLog),
}));

export const chatToolCallLogRelations = relations(chatToolCallLog, ({ one }) => ({
  message: one(chatMessages, { fields: [chatToolCallLog.messageId], references: [chatMessages.id] }),
}));
