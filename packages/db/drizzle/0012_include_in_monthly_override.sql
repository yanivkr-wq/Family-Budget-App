-- Per-transaction "include in monthly summaries" override.
-- When projectId is set AND the project's exclude_from_monthly_totals=true,
-- this column lets the user override on a per-row basis to bring back specific
-- transactions into the monthly cash flow (capex/opex split).
ALTER TABLE "transaction" ADD COLUMN "include_in_monthly_override" boolean DEFAULT false NOT NULL;
