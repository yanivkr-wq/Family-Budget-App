import { closeDb, getDb } from './client';
import { households, users, categories } from './schema/index';
import { encryptString } from './helpers/encryption';
import { eq } from 'drizzle-orm';
import { hash as argonHash } from 'node:crypto';

// Default Hebrew categories — derived from common Israeli household budgets and
// the patterns described in the user's Excel. Extend / rename in the admin UI later.
const DEFAULT_CATEGORIES: Array<{
  he: string;
  en: string;
  icon?: string;
  color?: string;
  isIncome?: boolean;
  children?: Array<{ he: string; en: string }>;
}> = [
  {
    he: 'הכנסות',
    en: 'Income',
    icon: 'TrendingUp',
    color: '#16a34a',
    isIncome: true,
    children: [
      { he: 'משכורת', en: 'Salary' },
      { he: 'קצבה', en: 'Pension' },
      { he: 'זיכוי מהעסק', en: 'Business credit' },
      { he: 'הכנסה אחרת', en: 'Other income' },
    ],
  },
  {
    he: 'מכולת ומזון',
    en: 'Groceries & Food',
    icon: 'ShoppingCart',
    color: '#f97316',
    children: [
      { he: 'סופרמרקט', en: 'Supermarket' },
      { he: 'ירקן וקצב', en: 'Greengrocer & Butcher' },
      { he: 'משלוחי מזון', en: 'Food delivery' },
    ],
  },
  {
    he: 'מסעדות וקפה',
    en: 'Restaurants & Cafes',
    icon: 'UtensilsCrossed',
    color: '#ef4444',
  },
  {
    he: 'תחבורה',
    en: 'Transportation',
    icon: 'Car',
    color: '#3b82f6',
    children: [
      { he: 'דלק', en: 'Fuel' },
      { he: 'תחבורה ציבורית', en: 'Public transport' },
      { he: 'מוסך וביטוח רכב', en: 'Car maintenance & insurance' },
      { he: 'חניה וכבישים', en: 'Parking & tolls' },
    ],
  },
  {
    he: 'בית ומשק',
    en: 'Home & Utilities',
    icon: 'Home',
    color: '#8b5cf6',
    children: [
      { he: 'משכנתא', en: 'Mortgage' },
      { he: 'חשמל', en: 'Electricity' },
      { he: 'מים', en: 'Water' },
      { he: 'גז', en: 'Gas' },
      { he: 'ארנונה', en: 'Property tax' },
      { he: 'ועד בית', en: 'Building fees' },
      { he: 'ריהוט וציוד', en: 'Furniture & equipment' },
    ],
  },
  {
    he: 'תקשורת',
    en: 'Communications',
    icon: 'Wifi',
    color: '#06b6d4',
    children: [
      { he: 'אינטרנט', en: 'Internet' },
      { he: 'סלולר', en: 'Mobile' },
      { he: 'טלוויזיה ומנויים', en: 'TV & subscriptions' },
    ],
  },
  {
    he: 'בריאות',
    en: 'Health',
    icon: 'Heart',
    color: '#ec4899',
    children: [
      { he: 'ביטוח בריאות', en: 'Health insurance' },
      { he: 'תרופות', en: 'Medicines' },
      { he: 'רפואה פרטית', en: 'Private medical' },
      { he: 'דנטלי', en: 'Dental' },
    ],
  },
  {
    he: 'ילדים וחינוך',
    en: 'Kids & Education',
    icon: 'GraduationCap',
    color: '#a855f7',
    children: [
      { he: 'גן וצהרון', en: 'Daycare' },
      { he: 'חוגים', en: 'Activities' },
      { he: 'בית ספר', en: 'School' },
      { he: 'בייביסיטר', en: 'Babysitter' },
    ],
  },
  {
    he: 'בילוי ופנאי',
    en: 'Leisure & Entertainment',
    icon: 'Sparkles',
    color: '#eab308',
    children: [
      { he: 'מנויים דיגיטליים', en: 'Digital subscriptions' },
      { he: 'ספרים וסרטים', en: 'Books & movies' },
      { he: 'בילויים בחוץ', en: 'Outings' },
    ],
  },
  {
    he: 'נסיעות וחופשות',
    en: 'Travel',
    icon: 'Plane',
    color: '#0ea5e9',
  },
  {
    he: 'הלוואות וחיסכון',
    en: 'Loans & Savings',
    icon: 'PiggyBank',
    color: '#64748b',
    children: [
      { he: 'הלוואה', en: 'Loan' },
      { he: 'הפקדה לפיקדון', en: 'Deposit' },
      { he: 'משיכה מפיקדון', en: 'Withdrawal from deposit' },
    ],
  },
  {
    he: 'כספומט',
    en: 'ATM Cash',
    icon: 'Banknote',
    color: '#94a3b8',
  },
  {
    he: 'אחר',
    en: 'Other',
    icon: 'MoreHorizontal',
    color: '#6b7280',
  },
];

async function main() {
  const db = getDb();

  console.log('Seeding default household + categories...');

  const householdName = process.env.SEED_HOUSEHOLD_NAME ?? 'Family';
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  let household = (await db.select().from(households).limit(1))[0];
  if (!household) {
    [household] = await db.insert(households).values({ name: householdName }).returning();
    console.log(`Created household: ${household!.id}`);
  } else {
    console.log(`Reusing existing household: ${household.id}`);
  }

  // Skip user creation if no admin env vars (dev convenience)
  if (adminEmail && adminPassword) {
    const existing = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
    if (existing.length === 0) {
      // Argon2id hash via @node-rs/argon2 is preferred; fall back to a simple
      // placeholder here so seeding doesn't require the dep at this stage.
      // The web app does the real argon2 hashing on signup.
      const placeholderHash = `seed:${encryptString(adminPassword)}`;
      await db.insert(users).values({
        householdId: household!.id,
        email: adminEmail,
        passwordHash: placeholderHash,
        role: 'admin',
      });
      console.log(`Created seed admin: ${adminEmail} (replace placeholder hash on first login)`);
    }
  }

  // Categories
  const existingCats = await db
    .select()
    .from(categories)
    .where(eq(categories.householdId, household!.id))
    .limit(1);

  if (existingCats.length > 0) {
    console.log('Categories already seeded — skipping.');
  } else {
    let order = 0;
    for (const cat of DEFAULT_CATEGORIES) {
      const [parent] = await db
        .insert(categories)
        .values({
          householdId: household!.id,
          nameHe: cat.he,
          nameEn: cat.en,
          icon: cat.icon,
          color: cat.color,
          isIncome: cat.isIncome ?? false,
          sortOrder: order++,
        })
        .returning();

      if (cat.children) {
        let subOrder = 0;
        for (const sub of cat.children) {
          await db.insert(categories).values({
            householdId: household!.id,
            parentId: parent!.id,
            nameHe: sub.he,
            nameEn: sub.en,
            isIncome: cat.isIncome ?? false,
            sortOrder: subOrder++,
          });
        }
      }
    }
    console.log(`Seeded ${DEFAULT_CATEGORIES.length} top-level categories.`);
  }

  await closeDb();
  console.log('Seed complete.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
