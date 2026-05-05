import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@fba/db';
import { eq } from 'drizzle-orm';
import { CategoriesClient } from './client';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const db = getDb();
  const categories = await db
    .select({
      id: schema.categories.id,
      nameHe: schema.categories.nameHe,
      color: schema.categories.color,
      icon: schema.categories.icon,
      isIncome: schema.categories.isIncome,
      isSavings: schema.categories.isSavings,
      isArchived: schema.categories.isArchived,
      sortOrder: schema.categories.sortOrder,
      monthlyTargetIls: schema.categories.monthlyTargetIls,
      parentId: schema.categories.parentId,
    })
    .from(schema.categories)
    .where(eq(schema.categories.householdId, session.user.householdId))
    .orderBy(schema.categories.sortOrder, schema.categories.nameHe);

  return <CategoriesClient categories={categories} />;
}
