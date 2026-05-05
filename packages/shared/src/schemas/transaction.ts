import { z } from 'zod';

export const ymdDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const yearMonth = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM');

export const ilsAmount = z.coerce.number().finite();

export const accountType = z.enum(['bank', 'credit_card']);
export const txnSign = z.enum(['expense', 'income']);

export const newManualTransaction = z.object({
  accountId: z.string().uuid(),
  transactionDate: ymdDate,
  amountIls: ilsAmount.refine((n) => n !== 0, 'Amount cannot be zero'),
  merchantRaw: z.string().min(1).max(500),
  categoryId: z.string().uuid().nullable().optional(),
  subCategoryId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).optional(),
});
export type NewManualTransactionInput = z.infer<typeof newManualTransaction>;

export const updateTransaction = newManualTransaction.partial().extend({
  id: z.string().uuid(),
});
export type UpdateTransactionInput = z.infer<typeof updateTransaction>;

export const transactionFilters = z
  .object({
    dateFrom: ymdDate.optional(),
    dateTo: ymdDate.optional(),
    billingMonth: yearMonth.optional(),
    accountIds: z.array(z.string().uuid()).optional(),
    categoryIds: z.array(z.string().uuid()).optional(),
    subCategoryIds: z.array(z.string().uuid()).optional(),
    merchantPattern: z.string().max(200).optional(),
    minAmount: ilsAmount.optional(),
    maxAmount: ilsAmount.optional(),
    onlyRecurring: z.boolean().optional(),
    onlyInstallments: z.boolean().optional(),
    includeProjected: z.boolean().default(false).optional(),
    limit: z.number().int().positive().max(500).default(100).optional(),
    offset: z.number().int().min(0).default(0).optional(),
  })
  .strict();
export type TransactionFilters = z.infer<typeof transactionFilters>;
