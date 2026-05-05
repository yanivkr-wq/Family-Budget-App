import Anthropic from '@anthropic-ai/sdk';

export interface CategorizationContext {
  merchantNormalized: string;
  merchantRaw: string;
  amountIls: number;
  accountType: 'bank' | 'credit_card';
  // Categories surfaced to the LLM for selection.
  categories: Array<{
    id: string;
    nameHe: string;
    nameEn?: string | null;
    isIncome: boolean;
    children?: Array<{ id: string; nameHe: string; nameEn?: string | null }>;
  }>;
}

export interface CategorizationResult {
  categoryId: string;
  subCategoryId: string | null;
  confidence: number;
  reasoning: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

// We send one cached system block (the category list) so repeat calls hit cache.
function buildCachedCategorySystem(categories: CategorizationContext['categories']): string {
  const lines: string[] = [
    'You are a Hebrew-aware transaction categorizer for an Israeli family budget app.',
    'Pick the best category (and optional sub-category) for a single transaction.',
    'Respond ONLY in JSON matching the response schema.',
    '',
    'Available categories (id | name_he | name_en):',
  ];
  for (const cat of categories) {
    lines.push(`- ${cat.id} | ${cat.nameHe} | ${cat.nameEn ?? ''} ${cat.isIncome ? '[INCOME]' : ''}`);
    if (cat.children?.length) {
      for (const sub of cat.children) {
        lines.push(`    └ ${sub.id} | ${sub.nameHe} | ${sub.nameEn ?? ''}`);
      }
    }
  }
  lines.push('');
  lines.push('Rules:');
  lines.push('- Use only the IDs above. Never invent IDs.');
  lines.push('- If unsure, pick the closest top-level category and set sub_category_id to null.');
  lines.push('- Income transactions (positive amounts) go to income categories only.');
  lines.push('- ATM withdrawals go to "כספומט" / "ATM Cash".');
  lines.push('- confidence is 0..1; below 0.6 means "I am guessing".');
  return lines.join('\n');
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    category_id: { type: 'string', description: 'UUID of the chosen top-level category' },
    sub_category_id: {
      type: ['string', 'null'],
      description: 'UUID of sub-category, or null',
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: 'string', maxLength: 200 },
  },
  required: ['category_id', 'sub_category_id', 'confidence', 'reasoning'],
} as const;

export class CategorizerClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for the categorizer');
    this.client = new Anthropic({ apiKey });
    this.model = opts?.model ?? process.env.ANTHROPIC_MODEL_CATEGORIZER ?? DEFAULT_MODEL;
  }

  async categorize(ctx: CategorizationContext): Promise<CategorizationResult> {
    const systemPrompt = buildCachedCategorySystem(ctx.categories);
    const userPrompt = [
      `Merchant (raw): ${ctx.merchantRaw}`,
      `Merchant (normalized): ${ctx.merchantNormalized}`,
      `Amount: ${ctx.amountIls} ILS (${ctx.amountIls < 0 ? 'expense' : 'income'})`,
      `Account type: ${ctx.accountType}`,
      '',
      'Return JSON matching the schema. No prose outside JSON.',
    ].join('\n');

    const start = Date.now();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 200,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: userPrompt,
            },
          ],
        },
      ],
    });

    const durationMs = Date.now() - start;

    let text = '';
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
    }

    const parsed = parseJsonResponse(text);

    return {
      categoryId: parsed.category_id,
      subCategoryId: parsed.sub_category_id,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      tokensIn: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0),
      tokensOut: response.usage.output_tokens,
      durationMs,
    };
  }
}

function parseJsonResponse(text: string): {
  category_id: string;
  sub_category_id: string | null;
  confidence: number;
  reasoning: string;
} {
  // The model occasionally wraps JSON in ```json ... ``` even when told not to.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const obj = JSON.parse(cleaned) as unknown;
  if (typeof obj !== 'object' || obj === null) {
    throw new Error('Categorizer LLM returned non-object response');
  }
  const o = obj as Record<string, unknown>;
  return {
    category_id: String(o.category_id ?? ''),
    sub_category_id:
      o.sub_category_id === null || o.sub_category_id === undefined
        ? null
        : String(o.sub_category_id),
    confidence: Number(o.confidence ?? 0),
    reasoning: String(o.reasoning ?? ''),
  };
}

export { RESPONSE_SCHEMA };

// ─── Batch categorization ────────────────────────────────────────────────────
// Used by the "auto-tag everything" admin action: takes N unique merchants and
// returns N classifications in a SINGLE Claude call. Much cheaper + faster than
// calling categorize() per merchant when you have 50+ uncategorized rows.
//
// The model gets latitude here that the per-row categorize() doesn't:
//   • Use general knowledge of Israeli businesses to identify merchants
//     ("רמי לוי" = supermarket chain, "ארומה" = café chain, "באג" = electronics)
//   • Strip location suffixes ("ארומה בילו" → ארומה café)
//   • Skip uncertain merchants (low confidence ⇒ caller can leave them
//     uncategorized for the user to handle manually)

export interface BatchCategorizationItem {
  merchantNormalized: string;
  /** Sample amounts for context — sometimes a merchant is "supermarket OR
   *  pharmacy" and the typical amount distinguishes (₪5 = pharmacy, ₪500 =
   *  supermarket). Optional — pass an empty array if unknown. */
  sampleAmounts?: number[];
}

export interface BatchCategorizationResult {
  merchantNormalized: string;
  categoryId:         string | null; // null when the model can't classify confidently
  subCategoryId:      string | null;
  confidence:         number;        // 0..1
  reasoning:          string;
}

export interface BatchCategorizationResponse {
  results:    BatchCategorizationResult[];
  tokensIn:   number;
  tokensOut:  number;
  durationMs: number;
}

export class CategorizerBatchClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for the categorizer');
    this.client = new Anthropic({ apiKey });
    this.model = opts?.model ?? process.env.ANTHROPIC_MODEL_CATEGORIZER ?? DEFAULT_MODEL;
  }

  async categorizeMany(
    items: BatchCategorizationItem[],
    categories: CategorizationContext['categories'],
  ): Promise<BatchCategorizationResponse> {
    if (items.length === 0) {
      return { results: [], tokensIn: 0, tokensOut: 0, durationMs: 0 };
    }

    const systemPrompt = [
      'You are a Hebrew-aware categorizer for an Israeli family-budget app.',
      'You will be given a list of merchants. Use your general knowledge of',
      'Israeli businesses (supermarket chains, café chains, gas stations,',
      'insurance companies, electronic stores, online subscriptions, etc.) to',
      'identify each merchant and pick the best top-level category for it.',
      '',
      'Available categories (id | name_he):',
      ...categories.map((c) =>
        `- ${c.id} | ${c.nameHe}${c.isIncome ? ' [INCOME — only for positive amounts]' : ''}`,
      ),
      '',
      'Heuristics:',
      '- "ארומה", "קפה", "רולדין", "סופט קוקיז", "המאפה" → cafés / bakeries → food',
      '- "סופר", "רמי לוי", "שופרסל", "יוחננוף", "מרכולבו", "יוניברס", "קשת טעמים" → supermarkets → groceries',
      '- "דלק", "פז", "סונול", "מנטה", "ספרינט מוטורס" → fuel/gas → transportation',
      '- "פנגו", "חניון", "סלופארק" → parking → transportation',
      '- "הראל", "כלל", "מנורה", "מגדל", "ביטוח" → insurance → finance/loans',
      '- "ביטוח לאומי", "מס הכנסה", "ארנונה", "עירייה" → government → home/utilities',
      '- "פלאפון", "סלקום", "פרטנר", "הוט", "בזק", "טלזר" → telecom → communications',
      '- "באג", "KSP", "אפל", "מחשב" → electronics → leisure or other',
      '- "OPENAI", "ANTHROPIC", "CHATGPT", "GitHub", "Spotify", "Netflix" → online subscriptions → leisure / communications (use your judgment)',
      '- "PAYPAL *X" → look at the X part for context, not the PAYPAL prefix',
      '- "BIT", "PAYBOX" → personal money transfer → use "אחר" (other) unless context tells otherwise',
      '',
      'Confidence:',
      '- 1.0 = obvious chain you recognize',
      '- 0.7-0.9 = strong heuristic match (Hebrew name pattern fits)',
      '- 0.5-0.7 = guess based on general context',
      '- < 0.5 = unknown, return category_id: null',
      '',
      'Return JSON only. No prose. Schema:',
      '{ "results": [{ "merchant": "...", "category_id": "uuid or null", "confidence": 0.0-1.0, "reasoning": "short explanation" }, ...] }',
    ].join('\n');

    const userPrompt = [
      'Classify these merchants:',
      '',
      ...items.map((it, i) => {
        const amtSample = it.sampleAmounts && it.sampleAmounts.length > 0
          ? ` (typical amounts: ${it.sampleAmounts.slice(0, 3).map((a) => `₪${Math.abs(a).toFixed(0)}`).join(', ')})`
          : '';
        return `${i + 1}. ${it.merchantNormalized}${amtSample}`;
      }),
      '',
      'Return JSON with one entry per merchant in the same order.',
    ].join('\n');

    const start = Date.now();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4000,
      system: [
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
    });
    const durationMs = Date.now() - start;

    let text = '';
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
    }

    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const obj = JSON.parse(cleaned) as { results?: Array<{ merchant?: string; category_id?: string | null; sub_category_id?: string | null; confidence?: number; reasoning?: string }> };
    const raw = Array.isArray(obj.results) ? obj.results : [];

    // Index by merchant for safe lookup (model sometimes drops trailing items
    // or returns them in a different order).
    const byMerchant = new Map<string, typeof raw[number]>();
    for (const r of raw) {
      if (typeof r.merchant === 'string') byMerchant.set(r.merchant.trim(), r);
    }

    const results: BatchCategorizationResult[] = items.map((it) => {
      const r = byMerchant.get(it.merchantNormalized.trim());
      if (!r) {
        return {
          merchantNormalized: it.merchantNormalized,
          categoryId:         null,
          subCategoryId:      null,
          confidence:         0,
          reasoning:          'no response from model',
        };
      }
      return {
        merchantNormalized: it.merchantNormalized,
        categoryId:         r.category_id && r.category_id !== 'null' ? r.category_id : null,
        subCategoryId:      r.sub_category_id && r.sub_category_id !== 'null' ? r.sub_category_id : null,
        confidence:         Number(r.confidence ?? 0),
        reasoning:          String(r.reasoning ?? ''),
      };
    });

    return {
      results,
      tokensIn:  response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0),
      tokensOut: response.usage.output_tokens,
      durationMs,
    };
  }
}
