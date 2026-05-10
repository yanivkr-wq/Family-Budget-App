import { relations } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const households = pgTable('household', {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  defaultCutoffDay: text().notNull().default('10'),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable(
  'user',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    email: text().notNull().unique(),
    passwordHash: text().notNull(),
    totpSecretEncrypted: text(),
    totpEnabled: boolean().notNull().default(false),
    role: text({ enum: ['admin'] }).notNull().default('admin'),
    displayName: text(),
    locale: text({ enum: ['he', 'en'] }).notNull().default('he'),
    /**
     * Phone number in E.164 format (e.g. +972501234567). Required for the
     * WhatsApp notification channel. Nullable so existing users (and users
     * who only want email/in-app delivery) aren't forced to provide it.
     *
     * Column name is hard-coded because Drizzle's auto snake_case converter
     * splits "phoneE164" into "phone_e_164" (extra underscore before the
     * digits), which doesn't match the migration column "phone_e164".
     */
    phoneE164: text('phone_e164'),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    lastLoginAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    householdIdx: index().on(t.householdId),
  }),
);

export const sessions = pgTable(
  'session',
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ip: text(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index().on(t.userId),
    expiresIdx: index().on(t.expiresAt),
  }),
);

export const householdsRelations = relations(households, ({ many }) => ({
  users: many(users),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  household: one(households, { fields: [users.householdId], references: [households.id] }),
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));
