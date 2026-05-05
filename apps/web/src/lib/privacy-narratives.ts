// Plain-language explainers for privacy-ledger entries.
//
// We have two log tables that record everything ever sent to Anthropic:
//   - categorization_log  — every LLM categorization call (per transaction)
//   - chat_tool_call_log  — every tool the chatbot called inside a conversation
//
// For each row, we want a short Hebrew "story-mode" explanation alongside the
// technical detail. Non-technical people can read the story and understand
// exactly what happened without having to parse JSON.

import { formatIls } from '@fba/shared';

export interface CategorizationLogStory {
  title: string;
  body: string;
  whatLeft: string[];
  whatStayed: string[];
}

export interface ChatToolCallStory {
  title: string;
  body: string;
  whatLeft: string[];
  whatStayed: string[];
}

const TOOL_NARRATIVES: Record<string, { name: string; describe: (args: any, rows: number | null) => string }> = {
  query_transactions: {
    name: 'חיפוש תנועות',
    describe: (args, rows) => {
      const filters: string[] = [];
      if (args.billing_month) filters.push(`חודש ${args.billing_month}`);
      if (args.date_from) filters.push(`מ-${args.date_from}`);
      if (args.date_to) filters.push(`עד-${args.date_to}`);
      if (args.merchant_pattern) filters.push(`מכיל "${args.merchant_pattern}"`);
      if (args.category_ids?.length) filters.push(`${args.category_ids.length} קטגוריות`);
      if (args.only_recurring) filters.push('רק קבועות');
      if (args.only_installments) filters.push('רק תשלומים');
      const filterStr = filters.length > 0 ? ` (${filters.join(', ')})` : '';
      return `העוזר חיפש תנועות במאגר${filterStr} וקיבל ${rows ?? 0} תוצאות.`;
    },
  },
  get_category_summary: {
    name: 'סיכום קטגוריות',
    describe: (args, rows) =>
      `העוזר ביקש סיכום הוצאות לפי ${args.level === 'sub' ? 'תת-קטגוריה' : 'קטגוריה'} עבור חודש ${args.month}. קיבל ${rows ?? 0} שורות.`,
  },
  compare_months: {
    name: 'השוואת חודשים',
    describe: (args) =>
      `העוזר השווה בין ${args.month_a} לבין ${args.month_b} כדי למצוא שינויים בהוצאות לפי קטגוריה.`,
  },
  get_recurring_patterns: {
    name: 'תבניות חוזרות',
    describe: (_args, rows) => `העוזר ביקש את רשימת ההוצאות הקבועות שזוהו עד כה (${rows ?? 0} תבניות).`,
  },
  get_installment_plans: {
    name: 'תכניות תשלומים',
    describe: (_args, rows) => `העוזר ביקש את רשימת תכניות התשלומים הפעילות (${rows ?? 0} תכניות).`,
  },
  get_anomalies: {
    name: 'אנומליות',
    describe: (_args, rows) =>
      `העוזר ביקש את רשימת ההתנהגויות החריגות שהמערכת זיהתה (${rows ?? 0} ממצאים).`,
  },
  get_predicted_balance: {
    name: 'חיזוי יתרה',
    describe: () =>
      'העוזר ביקש את תחזית היתרה לסוף החודש הנוכחי כדי לענות על שאלה לגבי הכסף שנשאר.',
  },
  find_subscription_candidates: {
    name: 'מועמדים לביטול',
    describe: (_args, rows) =>
      `העוזר חיפש מנויים חודשיים קטנים שאולי כדאי לבטל (${rows ?? 0} מועמדים).`,
  },
  search_merchants: {
    name: 'חיפוש בית עסק',
    describe: (args, rows) =>
      `העוזר חיפש בתי עסק ששמם מכיל "${args.query}" וקיבל ${rows ?? 0} תוצאות.`,
  },
};

export function describeCategorization(row: {
  merchantNormalized: string;
  amountIls: string;
  model: string;
  responseCategoryId: string | null;
  durationMs: string | null;
  createdAt: Date;
}): CategorizationLogStory {
  const time = row.createdAt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const date = row.createdAt.toLocaleDateString('he-IL');
  const amt = formatIls(Number(row.amountIls));
  return {
    title: `קטגוריזציה אוטומטית — ${row.merchantNormalized}`,
    body: `ב-${date} בשעה ${time}, האפליקציה שלחה ל-Claude (מודל ${row.model}) את שם בית העסק "${row.merchantNormalized}" ואת הסכום ${amt}, וביקשה לסווג לקטגוריה. ${row.responseCategoryId ? 'קיבלה תשובה והשתמשה בה כדי לתייג את התנועה.' : 'לא קיבלה תשובה תקפה.'}`,
    whatLeft: [
      `שם בית עסק: "${row.merchantNormalized}"`,
      `סכום: ${amt}`,
      'רשימת הקטגוריות הזמינות (לבחירה)',
    ],
    whatStayed: [
      'שמך, אימייל, מספר חשבון',
      'יתרה כללית',
      'תנועות אחרות מאותו חשבון',
      'מזהי משתמש פנימיים',
    ],
  };
}

export function describeChatToolCall(row: {
  toolName: string;
  argsJson: any;
  rowsReturned: number | null;
  durationMs: number | null;
  createdAt: Date;
  error: string | null;
}): ChatToolCallStory {
  const time = row.createdAt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const date = row.createdAt.toLocaleDateString('he-IL');
  const meta = TOOL_NARRATIVES[row.toolName];
  const toolName = meta?.name ?? row.toolName;
  const desc = meta ? meta.describe(row.argsJson, row.rowsReturned) : `Claude השתמש בכלי ${row.toolName}.`;

  return {
    title: `${toolName} (${date} ${time})`,
    body: row.error
      ? `${desc} הכלי החזיר שגיאה: ${row.error}`
      : `${desc} הכלי הוא קריאה-בלבד — הוא לא משנה נתונים.`,
    whatLeft: [
      'תיאור השאלה (טקסט) שכתבת',
      'תוצאות הכלי שרצו על המאגר שלך — כפי שהן מופיעות בלוג הטכני',
    ],
    whatStayed: [
      'סיסמה, אימייל, מספר טלפון',
      'מספרי חשבון אמיתיים (כל החשבונות מוסווים ל-Account 1, Account 2 וכו׳)',
      'יתרות בנק',
      'גישת כתיבה — לכלי הזה אין יכולת לשנות נתונים',
    ],
  };
}
