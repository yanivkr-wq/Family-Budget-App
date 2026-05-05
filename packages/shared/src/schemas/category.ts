import { z } from 'zod';

export const newCategory = z.object({
  nameHe: z.string().min(1).max(80),
  nameEn: z.string().max(80).optional(),
  parentId: z.string().uuid().nullable().optional(),
  icon: z.string().max(60).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB')
    .optional(),
  monthlyTargetIls: z.coerce.number().finite().nonnegative().nullable().optional(),
  isIncome: z.boolean().default(false).optional(),
  sortOrder: z.number().int().default(0).optional(),
});
export type NewCategoryInput = z.infer<typeof newCategory>;

export const updateCategory = newCategory.partial().extend({
  id: z.string().uuid(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategory>;
