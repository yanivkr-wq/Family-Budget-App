import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@/lib/auth';
import { getDb, schema } from '@fba/db';
import { eq } from 'drizzle-orm';

/**
 * POST /api/parse-rule
 * Body: { text: string }
 * Returns a structured rule suggestion (pattern, matchType, category, amounts)
 * plus any follow-up questions the AI has.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });

  const body = await req.json();
  const text: string = (body.text ?? '').trim();
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 });

  // Load categories so Claude knows what's available
  const db = getDb();
  const categories = await db
    .select({ id: schema.categories.id, nameHe: schema.categories.nameHe, parentId: schema.categories.parentId })
    .from(schema.categories)
    .where(eq(schema.categories.householdId, session.user.householdId));

  const topCats = categories.filter((c) => !c.parentId);
  const subCats = categories.filter((c) => !!c.parentId);

  const catList = topCats
    .map((c) => {
      const subs = subCats.filter((s) => s.parentId === c.id);
      return `- ${c.nameHe} (id: ${c.id})${subs.length ? `\n  sub: ${subs.map((s) => `${s.nameHe} (id: ${s.id})`).join(', ')}` : ''}`;
    })
    .join('\n');

  const client = new Anthropic({ apiKey });

  const systemPrompt = `You are a budget-app rule-builder assistant for a Hebrew family budget app.
The user will describe a categorization rule in natural language (Hebrew or English).
Your job is to extract the rule fields and return a JSON object.

Available categories:
${catList}

RULE FIELDS:
- pattern: string — the merchant name pattern to match (Hebrew or English)
- matchType: "contains" | "exact" | "starts_with" | "regex"  — default "contains"
- notesPattern: string | null — OPTIONAL secondary AND-condition: the transaction's notes field must ALSO match this.
  Use this when the user says something like "only if the note contains X" or "only for payments to [person]".
  Example: merchant pattern="paybox", notesPattern="אורית מילוא" means: paybox transactions WHERE notes mention אורית מילוא.
  Leave null if no notes condition was mentioned.
- notesMatchType: "contains" | "exact" | "starts_with" | "regex" | null — match type for notesPattern, default "contains"
- categoryId: string | null — id from the list above (null if unclear)
- subCategoryId: string | null — id from the list above (null if not specified)
- minAmountIls: number | null — minimum charge amount in ILS (null if not mentioned)
- maxAmountIls: number | null — maximum charge amount in ILS (null if not mentioned)
- ruleName: string | null — a short Hebrew name for this rule (you can suggest one)
- notes: string | null — any extra context

RESPONSE FORMAT — return ONLY valid JSON, no markdown fences:
{
  "rule": {
    "pattern": "...",
    "matchType": "contains",
    "notesPattern": null,
    "notesMatchType": null,
    "categoryId": "...",
    "subCategoryId": null,
    "minAmountIls": null,
    "maxAmountIls": null,
    "ruleName": "...",
    "notes": null
  },
  "followUpQuestions": [],
  "confidence": 0.9,
  "explanation": "short Hebrew explanation of what you understood"
}

If something is ambiguous or you need more info to build the rule correctly, add questions to "followUpQuestions" array (in Hebrew).
Be helpful — make your best guess even if not 100% sure, and set confidence accordingly.`;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }],
    });

    const firstBlock = message.content[0];
    const raw = firstBlock && firstBlock.type === 'text' ? (firstBlock as { type: 'text'; text: string }).text : '';

    // Parse JSON — strip any accidental markdown if model adds it
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(jsonStr);

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('parse-rule error', err);
    return NextResponse.json(
      { error: 'Failed to parse rule', details: String(err) },
      { status: 500 },
    );
  }
}
