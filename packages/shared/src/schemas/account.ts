import { z } from 'zod';

export const israeliBankProvider = z.enum([
  'hapoalim',
  'leumi',
  'discount',
  'mizrahi',
  'otsarHahayal',
  'massad',
  'yahav',
  'unionBank',
  // Credit cards
  'visaCal',
  'isracard',
  'max',
  'leumiCard',
  // Manual / unsupported
  'manual',
]);
export type IsraeliBankProvider = z.infer<typeof israeliBankProvider>;

export const newAccount = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['bank', 'credit_card']),
  institution: z.string().min(1).max(60),
  scraperProvider: israeliBankProvider.optional(),
  cutoffDay: z.number().int().min(0).max(28).default(10),
  accountNumberMasked: z
    .string()
    .regex(/^\d{4}$/, 'Last 4 digits only')
    .optional(),
  // Credentials, plain text — encrypted before insert.
  // Shape varies by provider; israeli-bank-scrapers documents required fields per provider.
  credentials: z.record(z.string(), z.string()).optional(),
});
export type NewAccountInput = z.infer<typeof newAccount>;
