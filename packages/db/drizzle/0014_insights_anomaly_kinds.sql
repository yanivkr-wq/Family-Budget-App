-- Add 5 new anomaly.kind enum values to support Data Integrity insights
-- (insights 8a-8e). Drizzle's text({ enum: [...] }) generates a CHECK
-- constraint, so the same DROP+ADD pattern as 0013 is required.

ALTER TABLE anomaly DROP CONSTRAINT IF EXISTS anomaly_kind_check;
ALTER TABLE anomaly ADD CONSTRAINT anomaly_kind_check
  CHECK (kind IN (
    'category_overspend',
    'recurring_jump',
    'income_drop',
    'unusual_merchant',
    'untagged',
    'low_confidence_categorization',
    'bad_installment',
    'unpaired_transfer_candidate',
    'bad_recurring_pattern'
  ));
