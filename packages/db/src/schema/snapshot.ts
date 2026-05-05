import { index, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { households } from './identity';

// Frozen month-end summaries for fast historical browsing without re-aggregating
// every transaction. Written when a month closes (or recomputed on demand).
export const monthlySnapshots = pgTable(
  'monthly_snapshot',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    yearMonth: text().notNull(), // 'YYYY-MM'
    totalIncomeIls: numeric({ precision: 12, scale: 2 }).notNull(),
    totalSpentIls: numeric({ precision: 12, scale: 2 }).notNull(),
    netIls: numeric({ precision: 12, scale: 2 }).notNull(),
    byCategoryJson: jsonb().notNull(), // [{ categoryId, total, target, deltaPct }]
    byAccountJson: jsonb().notNull(),
    predictedEomBalanceIls: numeric({ precision: 12, scale: 2 }),
    anomaliesJson: jsonb(),
    closedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    householdMonthUnique: unique().on(t.householdId, t.yearMonth),
    monthIdx: index().on(t.householdId, t.yearMonth),
  }),
);

// Anomalies surfaced from detection runs — keep them as first-class rows so the
// chatbot, dashboard, and notifications can all reference the same list.
export const anomalies = pgTable(
  'anomaly',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    yearMonth: text().notNull(),
    kind: text({
      enum: ['category_overspend', 'recurring_jump', 'income_drop', 'unusual_merchant'],
    }).notNull(),
    severity: text({ enum: ['low', 'medium', 'high'] })
      .notNull()
      .default('medium'),
    summaryHe: text().notNull(),
    detailJson: jsonb().notNull(), // category_id, expected, actual, stdev, etc.
    relatedTransactionIds: jsonb(), // string[]
    acknowledgedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    householdMonthIdx: index().on(t.householdId, t.yearMonth),
    kindIdx: index().on(t.householdId, t.kind),
  }),
);
