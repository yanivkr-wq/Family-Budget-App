import type { CategoryRule } from '@fba/db';
import { applyRules, type RuleMatchInput } from './rules-engine';
import { CategorizerClient, type CategorizationContext } from './llm-client';

export type CategorizationSource = 'rule' | 'llm' | 'unknown';

export interface CategorizationOutcome {
  source: CategorizationSource;
  categoryId: string | null;
  subCategoryId: string | null;
  confidence: number;
  reasoning: string;
  matchedRuleId?: string;
  // LLM telemetry, only populated when source = 'llm'
  llm?: {
    tokensIn: number;
    tokensOut: number;
    durationMs: number;
  };
}

export interface CategorizePipelineDeps {
  rules: CategoryRule[];
  categories: CategorizationContext['categories'];
  llm?: CategorizerClient; // optional — if omitted, unmatched returns 'unknown'
}

export async function categorizeOne(
  txn: {
    merchantNormalized: string;
    merchantRaw: string;
    amountIls: number;
    accountId: string;
    accountType: 'bank' | 'credit_card';
  },
  deps: CategorizePipelineDeps,
): Promise<CategorizationOutcome> {
  const ruleInput: RuleMatchInput = {
    merchantNormalized: txn.merchantNormalized,
    merchantRaw: txn.merchantRaw,
    accountId: txn.accountId,
  };

  const ruleHit = applyRules(deps.rules, ruleInput);
  if (ruleHit) {
    return {
      source: 'rule',
      categoryId: ruleHit.categoryId,
      subCategoryId: ruleHit.subCategoryId,
      confidence: 1,
      reasoning: `Matched rule "${ruleHit.rule.pattern}"`,
      matchedRuleId: ruleHit.rule.id,
    };
  }

  if (!deps.llm) {
    return {
      source: 'unknown',
      categoryId: null,
      subCategoryId: null,
      confidence: 0,
      reasoning: 'No rule matched; LLM disabled',
    };
  }

  try {
    const llmResult = await deps.llm.categorize({
      merchantNormalized: txn.merchantNormalized,
      merchantRaw: txn.merchantRaw,
      amountIls: txn.amountIls,
      accountType: txn.accountType,
      categories: deps.categories,
    });
    return {
      source: 'llm',
      categoryId: llmResult.categoryId,
      subCategoryId: llmResult.subCategoryId,
      confidence: llmResult.confidence,
      reasoning: llmResult.reasoning,
      llm: {
        tokensIn: llmResult.tokensIn,
        tokensOut: llmResult.tokensOut,
        durationMs: llmResult.durationMs,
      },
    };
  } catch (err) {
    return {
      source: 'unknown',
      categoryId: null,
      subCategoryId: null,
      confidence: 0,
      reasoning: `LLM error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
