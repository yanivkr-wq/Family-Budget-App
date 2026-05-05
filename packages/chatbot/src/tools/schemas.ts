import { z } from 'zod';

// All tools are read-only. Mutations are intentionally absent from this surface.

export const queryTransactionsArgs = z
  .object({
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    billing_month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    category_ids: z.array(z.string().uuid()).optional(),
    sub_category_ids: z.array(z.string().uuid()).optional(),
    account_ids: z.array(z.string().uuid()).optional(),
    merchant_pattern: z.string().max(200).optional(),
    min_amount: z.number().optional(),
    max_amount: z.number().optional(),
    only_recurring: z.boolean().optional(),
    only_installments: z.boolean().optional(),
    limit: z.number().int().positive().max(200).default(50),
  })
  .strict();

export const getCategorySummaryArgs = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    level: z.enum(['category', 'sub']).default('category'),
  })
  .strict();

export const compareMonthsArgs = z
  .object({
    month_a: z.string().regex(/^\d{4}-\d{2}$/),
    month_b: z.string().regex(/^\d{4}-\d{2}$/),
  })
  .strict();

export const getRecurringPatternsArgs = z
  .object({
    status: z.enum(['active', 'paused', 'ended']).optional(),
  })
  .strict();

export const getInstallmentPlansArgs = z
  .object({
    status: z.enum(['active', 'complete', 'cancelled']).optional(),
  })
  .strict();

export const getAnomaliesArgs = z
  .object({
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

export const getPredictedBalanceArgs = z.object({}).strict();

export const findSubscriptionCandidatesArgs = z
  .object({
    max_monthly_amount: z.number().positive().default(200),
  })
  .strict();

export const searchMerchantsArgs = z
  .object({
    query: z.string().min(1).max(100),
    limit: z.number().int().positive().max(50).default(20),
  })
  .strict();

export type QueryTransactionsArgs = z.infer<typeof queryTransactionsArgs>;
export type GetCategorySummaryArgs = z.infer<typeof getCategorySummaryArgs>;
export type CompareMonthsArgs = z.infer<typeof compareMonthsArgs>;
export type GetRecurringPatternsArgs = z.infer<typeof getRecurringPatternsArgs>;
export type GetInstallmentPlansArgs = z.infer<typeof getInstallmentPlansArgs>;
export type GetAnomaliesArgs = z.infer<typeof getAnomaliesArgs>;
export type GetPredictedBalanceArgs = z.infer<typeof getPredictedBalanceArgs>;
export type FindSubscriptionCandidatesArgs = z.infer<typeof findSubscriptionCandidatesArgs>;
export type SearchMerchantsArgs = z.infer<typeof searchMerchantsArgs>;
