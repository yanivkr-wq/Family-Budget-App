import type { CategoryRule } from '@fba/db';

export interface RuleMatchInput {
  merchantNormalized: string;
  merchantRaw: string;
  accountId: string;
  /** Absolute value of the transaction amount (positive number). Used for amount-based conditions. */
  amountAbs?: number;
  /** Transaction notes field — used when the rule has a notesPattern AND-condition. */
  notes?: string | null;
}

export interface RuleMatchResult {
  rule: CategoryRule;
  categoryId: string;
  subCategoryId: string | null;
}

// Apply ordered rules; return the first match. Rules are pre-sorted by:
//   - source priority: user > llm_confirmed > pending
//   - explicit priority field (lower = higher priority)
//   - account specificity: account-specific > all-accounts
export function sortRules(rules: CategoryRule[]): CategoryRule[] {
  const sourcePriority: Record<string, number> = {
    user: 0,
    llm_confirmed: 1,
    pending: 2,
  };
  return [...rules].sort((a, b) => {
    if (a.source !== b.source) {
      return (sourcePriority[a.source] ?? 99) - (sourcePriority[b.source] ?? 99);
    }
    if (a.priority !== b.priority) return a.priority - b.priority;
    // Account-specific rules win over all-accounts (null) ones at same priority
    if (a.appliesToAccountId && !b.appliesToAccountId) return -1;
    if (!a.appliesToAccountId && b.appliesToAccountId) return 1;
    return 0;
  });
}

export function matchRule(rule: CategoryRule, input: RuleMatchInput): boolean {
  if (!rule.isActive) return false;
  if (rule.appliesToAccountId && rule.appliesToAccountId !== input.accountId) return false;

  // Amount conditions (only apply if both rule and input have amounts)
  if (input.amountAbs !== undefined) {
    if (rule.minAmountIls !== null && rule.minAmountIls !== undefined) {
      if (input.amountAbs < Number(rule.minAmountIls)) return false;
    }
    if (rule.maxAmountIls !== null && rule.maxAmountIls !== undefined) {
      if (input.amountAbs > Number(rule.maxAmountIls)) return false;
    }
  }

  const haystack = input.merchantNormalized;
  const pattern = rule.pattern.toLowerCase();

  // Primary match (merchant)
  let merchantMatch: boolean;
  switch (rule.matchType) {
    case 'contains':
      merchantMatch = haystack.includes(pattern);
      break;
    case 'starts_with':
      merchantMatch = haystack.startsWith(pattern);
      break;
    case 'exact':
      merchantMatch = haystack === pattern;
      break;
    case 'regex':
      try {
        merchantMatch = new RegExp(rule.pattern, 'i').test(input.merchantRaw);
      } catch {
        merchantMatch = false;
      }
      break;
    default:
      merchantMatch = false;
  }
  if (!merchantMatch) return false;

  // Secondary AND-condition: notes must ALSO match (if notesPattern is set)
  if (rule.notesPattern) {
    const notesHaystack = (input.notes ?? '').toLowerCase();
    const notesPattern = rule.notesPattern.toLowerCase();
    const notesMatchType = rule.notesMatchType ?? 'contains';
    let notesMatch: boolean;
    switch (notesMatchType) {
      case 'contains':
        notesMatch = notesHaystack.includes(notesPattern);
        break;
      case 'starts_with':
        notesMatch = notesHaystack.startsWith(notesPattern);
        break;
      case 'exact':
        notesMatch = notesHaystack === notesPattern;
        break;
      case 'regex':
        try {
          notesMatch = new RegExp(rule.notesPattern, 'i').test(input.notes ?? '');
        } catch {
          notesMatch = false;
        }
        break;
      default:
        notesMatch = false;
    }
    if (!notesMatch) return false;
  }

  return true;
}

export function applyRules(
  rules: CategoryRule[],
  input: RuleMatchInput,
): RuleMatchResult | null {
  const sorted = sortRules(rules);
  for (const rule of sorted) {
    if (matchRule(rule, input)) {
      return {
        rule,
        categoryId: rule.categoryId,
        subCategoryId: rule.subCategoryId,
      };
    }
  }
  return null;
}
