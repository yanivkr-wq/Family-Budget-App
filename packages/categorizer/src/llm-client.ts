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
