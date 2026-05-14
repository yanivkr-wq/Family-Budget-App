import type { Database } from '@fba/db';
import { schema, currentBillingMonth } from '@fba/db';
import { eq } from 'drizzle-orm';

export interface SystemPromptContext {
  db: Database;
  householdId: string;
  userDisplayName?: string | null;
  locale?: 'he' | 'en';
}

// Build the system prompt for a chat turn. Includes:
// - persona + style
// - safety/scope (read-only)
// - the household's category list (so the model knows which IDs/names exist)
// - the current month
// - the household's masked accounts list
//
// The category list is the heaviest variable, so we load it once and the
// caller wraps this string in a cache_control block.
export async function buildSystemPrompt(ctx: SystemPromptContext): Promise<string> {
  const cats = await ctx.db
    .select({
      id: schema.categories.id,
      nameHe: schema.categories.nameHe,
      nameEn: schema.categories.nameEn,
      parentId: schema.categories.parentId,
      isIncome: schema.categories.isIncome,
      monthlyTargetIls: schema.categories.monthlyTargetIls,
    })
    .from(schema.categories)
    .where(eq(schema.categories.householdId, ctx.householdId));

  const accs = await ctx.db
    .select({
      id: schema.accounts.id,
      name: schema.accounts.name,
      type: schema.accounts.type,
      institution: schema.accounts.institution,
      cutoffDay: schema.accounts.cutoffDay,
    })
    .from(schema.accounts)
    .where(eq(schema.accounts.householdId, ctx.householdId));

  const tops = cats.filter((c) => !c.parentId);
  const subsByParent = new Map<string, typeof cats>();
  for (const c of cats) {
    if (c.parentId) {
      const arr = subsByParent.get(c.parentId) ?? [];
      arr.push(c);
      subsByParent.set(c.parentId, arr);
    }
  }

  const month = currentBillingMonth();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const lines: string[] = [];
  lines.push("# You are an expert family-budget assistant for an Israeli household.");
  lines.push('');
  lines.push('## Style and language');
  lines.push('- Default to Hebrew. Mirror the user\'s language: if they write English, reply in English. If they mix, mirror naturally.');
  lines.push('- Be concise and direct. No fluff, no filler, no unnecessary preambles.');
  lines.push('- Use ILS (₪) for all amounts. Format with thousand separators (e.g., ₪1,234.56).');
  lines.push('- When citing data, mention the relevant period explicitly (החודש / חודש שעבר / 2026-04).');
  lines.push('- If you mention a transaction, give: date, merchant, amount.');
  lines.push('- Highlight unusual or noteworthy patterns proactively when they are clearly visible in tool results.');
  lines.push('');
  lines.push('## Scope and safety');
  lines.push('- You have READ-ONLY access. You CANNOT add, edit, or delete data.');
  lines.push('- If asked to delete, edit, add a transaction, change a budget, or set a rule — politely refuse and direct the user to the relevant page in the app.');
  lines.push('- Do NOT give regulated advice: no investment recommendations, tax advice, legal advice, or specific financial products.');
  lines.push('- You may give general budgeting observations and behavioral suggestions ("you spent 30% more on dining this month — worth a look").');
  lines.push('- If a question requires data you cannot retrieve via tools, say so plainly.');
  lines.push('');
  lines.push('## Tool use');
  lines.push('- Use tools to fetch data instead of guessing. Multiple tool calls per turn are fine.');
  lines.push('- Prefer the smallest sufficient query. Do not over-fetch.');
  lines.push('- Always pass real category IDs from the list below — never invent UUIDs.');
  lines.push('- For "this month" queries use billing_month (not date_from/date_to). The cutoff-day rule maps purchases after the cutoff to next month.');
  lines.push('');
  lines.push('## Answering questions about page widgets, cards, tables, summaries');
  lines.push('- The app has a structured spec registry covering every visible element on every page: /, /insights, /transactions, /recurring, /installments, /savings, /projects.');
  lines.push('- When the user asks how ANY widget / card / table / summary / KPI tile works — what it shows, what data it uses, what filters or time scope it applies, what gets excluded, what the math is, or why a specific number is what it is — call `get_widget_spec` BEFORE answering.');
  lines.push('- Discovery flow when you don\'t know which widget the user means:');
  lines.push('  1. If the user names a page generically ("the dashboard", "the transactions page"), call `get_widget_spec` with `page_id` to list widgets on that page.');
  lines.push('  2. If the user describes a widget vaguely ("the income tile", "the bar with refunds"), call `get_widget_spec` with no args to see EVERY widget id+title, then pick the best match.');
  lines.push('  3. Once you have the right `widget_id`, call again to fetch the full structured spec (dataSource, dataSourceNotes, timeScope, filters, mathRule, exclusions, caveats, queryFunction).');
  lines.push('- QUOTE from the spec — do not paraphrase. The spec is the contract the SQL enforces. Inferring widget behavior from rendered numbers is how you get things wrong.');
  lines.push('- Recurring confusion worth remembering: TOTALS widgets (e.g. hero-kpi, income-vs-expenses, home.kpi.spent-so-far) read BANK ROWS ONLY. BEHAVIORAL widgets (e.g. category-by-charge-date, category-by-txn-date, foreign-currency) read CC DETAILS. The spec\'s `dataSource` field is the definitive answer per widget.');
  lines.push('- After quoting the spec, use the other tools (query_transactions, get_category_summary, etc.) to fetch the actual rows that explain the user\'s specific number.');
  lines.push('');
  lines.push(`## Current context`);
  lines.push(`- Today (Israel time): ${today}`);
  lines.push(`- Current billing month: ${month}`);
  if (ctx.userDisplayName) lines.push(`- User: ${ctx.userDisplayName}`);
  lines.push('');
  lines.push('## Accounts (masked)');
  accs.forEach((acc, i) => {
    const masked = `Account ${i + 1}`;
    const cutoff = acc.cutoffDay === 0 ? 'no cutoff (bank)' : `cutoff day ${acc.cutoffDay}`;
    lines.push(`- ${masked}: id=${acc.id} | type=${acc.type} | ${cutoff}`);
  });
  lines.push('');
  lines.push('## Categories (use these IDs in tool calls)');
  for (const top of tops) {
    const flag = top.isIncome ? ' [INCOME]' : '';
    const target = top.monthlyTargetIls ? ` | target=₪${top.monthlyTargetIls}` : '';
    lines.push(`- ${top.id} | ${top.nameHe} (${top.nameEn ?? ''})${flag}${target}`);
    const subs = subsByParent.get(top.id) ?? [];
    for (const sub of subs) {
      lines.push(`    └ ${sub.id} | ${sub.nameHe} (${sub.nameEn ?? ''})`);
    }
  }

  return lines.join('\n');
}
