/**
 * RULES CATALOG — single source of truth for the business logic baked
 * into this app. Rendered at /admin/rules-catalog as a story-mode page
 * the admin can read to understand "what does the app actually do
 * automatically when I upload a file or browse transactions?".
 *
 * RULE FOR ME (Claude): every time you add or change a piece of import
 * / categorization / transaction-handling logic, append a matching
 * entry here. Don't let the catalog drift behind the code.
 *
 * Each entry has:
 *   • id        — stable slug for linking
 *   • title     — short imperative phrase ("Forex charges immediate")
 *   • category  — for grouping in the UI
 *   • story     — plain-Hebrew explanation; what the user would say
 *   • why       — the business reasoning (1-2 sentences)
 *   • example   — concrete scenario showing the rule in action
 *   • code      — file path(s) that implement the rule (for devs)
 */

export type RuleCategory =
  | 'import'         // file detection, parsing, date format
  | 'categorization' // rules engine, hint map, AI fallback
  | 'routing'        // file → account auto-routing
  | 'transactions'   // forex, transfers, dedup, CC settlement
  | 'installments'   // auto-create + projections
  | 'recurring'      // pattern matching + amount modes
  | 'ui';            // visual conventions (badges, columns, etc.)

export interface RuleEntry {
  id:       string;
  title:    string;
  category: RuleCategory;
  story:    string;
  why:      string;
  example?: string;
  code?:    string[];
}

export const RULE_CATEGORIES: Record<RuleCategory, { label: string; emoji: string; description: string }> = {
  import: {
    label: 'ייבוא וניתוח קבצים',
    emoji: '📂',
    description: 'איך האפליקציה קוראת את קבצי הבנק/אשראי שאתה מעלה — זיהוי תבנית, פורמט תאריכים, מבנה עמודות.',
  },
  routing: {
    label: 'ניתוב אוטומטי לחשבונות',
    emoji: '🎯',
    description: 'איך כל קובץ מוצא את החשבון שלו בלי שתצטרך לבחור ידנית.',
  },
  categorization: {
    label: 'תיוג קטגוריות אוטומטי',
    emoji: '🏷️',
    description: 'מי מחליט לאיזו קטגוריה כל תנועה שייכת — שרשרת של 5 שלבים.',
  },
  transactions: {
    label: 'עיבוד תנועות',
    emoji: '💸',
    description: 'מה עושים עם חיובים מיוחדים: מט"ח, העברות, חיובי כרטיס אשראי שמופיעים גם בעו"ש, כפילויות.',
  },
  installments: {
    label: 'תוכניות תשלומים',
    emoji: '📊',
    description: 'איך תשלומים מתפרסים על פני חודשים, ואיך תחזית של תשלומים עתידיים מופיעה בלוח השנה.',
  },
  recurring: {
    label: 'הוצאות קבועות',
    emoji: '🔁',
    description: 'מתי ואיך תנועה מסומנת כקבועה, ואיך מטפלים בסכומים שמשתנים מחודש לחודש.',
  },
  ui: {
    label: 'תצוגה וחוויה',
    emoji: '🎨',
    description: 'מה כל תג צבעוני אומר, ואיך לקרוא את הטבלה.',
  },
};

export const RULES_CATALOG: RuleEntry[] = [

  // ── IMPORT ─────────────────────────────────────────────────────────
  {
    id: 'filename-agnostic',
    title: 'הקובץ לא תלוי בשם הקובץ',
    category: 'import',
    story:
      'בכל חודש הבנק שולח לך קובץ בשם שונה — תאריך אחר, מספר סידורי אחר. ' +
      'האפליקציה לא מסתכלת על שם הקובץ בכלל. היא קוראת את התוכן עצמו ומסיקה ' +
      'מה הפורמט (ויזה? כאל? עו"ש דיסקונט?) ולאיזה חשבון הוא שייך.',
    why: 'שינויי שם קובץ הם המקור הכי שכיח לשגיאות ייבוא. מתעלמים מהם.',
    example: '"transaction-details_export_1778061938343.xlsx" ו-"visa_lily_jun.xlsx" ייקראו אותו דבר אם התוכן זהה.',
    code: ['apps/web/src/lib/smart-importer.ts'],
  },
  {
    id: 'template-detection',
    title: 'זיהוי תבנית אוטומטי',
    category: 'import',
    story:
      'יש 8 תבניות נתמכות (מפתח דיסקונט, ייצוא ישיר מחברת אשראי, עו"ש לאומי/דיסקונט, ' +
      'לאומי עסקי HTML וכו׳). לכל תבנית יש מילות מפתח ייחודיות בכותרות הקובץ. ' +
      'ה-importer סורק את שורות הכותרת, סופר התאמות, וזה שמשיג את הציון הכי גבוה — מנצח.',
    why: 'מאפשר תמיכה במספר ספקים ופורמטים בלי שהמשתמש יצטרך לסווג את הקובץ ידנית.',
    example: 'קובץ עם הכותרת "מזהה כרטיס בארנק דיגילטי" מזוהה אוטומטית כייצוא ישיר מחברת אשראי.',
    code: ['apps/web/src/lib/institution-templates.ts'],
  },
  {
    id: 'whitespace-normalization',
    title: 'נירמול רווחים בכותרות',
    category: 'import',
    story:
      'בנקים ישראלים נוטים לשבור כותרות לעמודות מרובות שורות בתוך תא בודד ' +
      '("סכום\\nבש"ח" במקום "סכום בש"ח"). לפני זיהוי תבנית, כל הרווחים — כולל ' +
      'מעברי שורה ורווחים לא-שוברים — נדחסים לרווח אחד.',
    why: 'בלי הנירמול הזה, מילות מפתח רב-מילוליות לא היו מוצאות התאמה והקובץ היה ' +
         'נופל לתבנית הלא נכונה (חוויה עברו עליה דיינרס + כאל).',
    code: ['apps/web/src/lib/smart-importer.ts'],
  },
  {
    id: 'date-format-autodetect',
    title: 'זיהוי פורמט תאריך אוטומטי (M/D/Y מול D/M/Y)',
    category: 'import',
    story:
      'חלק מהבנקים שולחים תאריכים בפורמט אמריקאי (M/D/Y), אחרים בפורמט ישראלי ' +
      '(D/M/Y). לפני שאני מנתח שורות, אני סורק את כל ערכי התאריך בקובץ: אם יש שורה ' +
      'שבה החלק הראשון > 12, חייב להיות D/M. אם יש שורה שבה החלק השני > 12, ' +
      'חייב להיות M/D. אם הכל אמביוולנטי, מסתמך על ברירת המחדל של התבנית.',
    why: 'בלי זה, "4/30/26" היה מתפרש כ-30 באפריל לפעמים וכשגיאה לפעמים.',
    example: 'קובץ Discount עו"ש מגיע ב-M/D/Y ("4/30/26" = 30 באפריל). ' +
             'קובץ דיינרס מגיע ב-D/M/Y ("27/4/26" = 27 באפריל).',
    code: ['apps/web/src/lib/smart-importer.ts'],
  },
  {
    id: 'html-as-xls',
    title: 'תמיכה בקבצי HTML מסווים כ-.xls',
    category: 'import',
    story:
      'הפורטל של לאומי עסקי לא נותן XLSX אמיתי — הוא נותן קובץ HTML עם סיומת .xls. ' +
      'אקסל פותח אותו עם אזהרה ("הפורמט לא תואם את הסיומת"). האפליקציה מזהה את ' +
      'התופעה לפי הבייטים הראשונים של הקובץ ומפעילה parser HTML פנימי שמחלץ את ' +
      'שורות הטבלה ישירות.',
    why: 'בלי זה, המשתמש היה צריך לפתוח את הקובץ באקסל ולשמור מחדש כ-XLSX לפני ייבוא.',
    code: ['apps/web/src/lib/smart-importer.ts'],
  },
  {
    id: 'pending-rows-skipped',
    title: 'דילוג שקט על שורות בקליטה',
    category: 'import',
    story:
      'כרטיסי אשראי לפעמים מציגים שורות בסטטוס "עסקה בקליטה" (טרם הסתיימה). ' +
      'אלו עדיין יכולות להשתנות (לזכות, לבוטל, להשתנות בסכום). האפליקציה ' +
      'מדלגת עליהן בלי לדווח על שגיאה — נמתין שיגמרו ויופיעו בייבוא הבא.',
    why: 'כדי לא להכניס שורות שעלולות להתחלף או להעלם בייבוא הבא וליצור כפילויות.',
    code: ['apps/web/src/lib/smart-importer.ts'],
  },

  // ── ROUTING ────────────────────────────────────────────────────────
  {
    id: 'auto-route-by-external-key',
    title: 'ניתוב אוטומטי לפי מזהה חיצוני',
    category: 'routing',
    story:
      'לכל חשבון יש "מזהה חיצוני" שאתה מגדיר פעם אחת ב-/admin/accounts (4 ספרות ' +
      'כרטיס אשראי, או מספר חשבון בנק). כשאתה מעלה קובץ בלי לבחור חשבון, ' +
      'ה-importer מחלץ את המזהה מהקובץ עצמו ומוצא את החשבון התואם.',
    why: 'מבטל את הצורך לבחור חשבון ידנית כל חודש. תגדיר פעם אחת — וזהו.',
    example: 'קובץ Visa עם 7627 בעמודת "4 ספרות אחרונות" → מנותב לחשבון ' +
             '"ויזה כ.א.ל לילי (דיסקונט)" שהוגדר לו externalKey="7627".',
    code: ['apps/web/src/app/(app)/import/actions.ts'],
  },
  {
    id: 'route-type-filter',
    title: 'סינון לפי סוג חשבון בניתוב',
    category: 'routing',
    story:
      'קובץ אשראי יכול להזכיר את מספר חשבון הבנק שאליו הוא קשור (בכותרת ' +
      '"חשבון לאומי 4703428"). בלי סינון, החשבון שמקבל את החיוב היה גם מתאים. ' +
      'הניתוב מסנן: קובץ אשראי → רק חשבונות מסוג credit_card. קובץ בנק → רק ' +
      'חשבונות מסוג bank.',
    why: 'מונע התאמה דו-משמעית כשאותו מזהה מופיע בקובץ אשראי ובקובץ בנק.',
    code: ['apps/web/src/app/(app)/import/actions.ts'],
  },
  {
    id: 'multi-identifier-matching',
    title: 'התאמה לפי כל מזהה אפשרי בקובץ',
    category: 'routing',
    story:
      'קבצי אשראי מציגים כמה זיהויים שונים לאותו כרטיס: 4 ספרות פיזיות בכותרת ' +
      '("ויזה 2067"), טוקן Google Pay ("GooglePay 9648"), מזהה רכישה אונליין ' +
      '("אינטרנט 1939"). ה-importer מחלץ את כולם, ומחפש האם המזהה החיצוני שהגדרת ' +
      'מופיע בכל אחד מהם.',
    why: 'אתה יכול להגדיר את ה-externalKey לכל אחד מהמזהים — מה שיותר נוח לך לזכור.',
    code: ['apps/web/src/lib/smart-importer.ts'],
  },

  // ── CATEGORIZATION ─────────────────────────────────────────────────
  {
    id: 'categorization-waterfall',
    title: 'שרשרת תיוג קטגוריה (5 שלבים)',
    category: 'categorization',
    story:
      'כל תנועה עוברת דרך 5 שלבים בסדר עדיפות. הראשון שמתאים — מנצח. ' +
      'אם אף אחד לא מתאים, התנועה נשארת ללא קטגוריה.',
    why: 'מבחין בין כוונה מפורשת של המשתמש (כללים) לבין ניחוש (AI). ' +
         'אופטימליזציה: כל ניחוש שעבד נשמר ככלל לקראת הפעם הבאה.',
    example:
      '1. כללים שאתה יצרת ידנית → צבע כחול "כלל"\n' +
      '2. תיוג ידני בקובץ עצמו (אקסל מתויג) → תג ירוק "תיוג"\n' +
      '3. עמודת ענף בקובץ הבנק/אשראי (ענף → קטגוריה במפה פנימית)\n' +
      '4. סריקת מילות מפתח בשם בית העסק\n' +
      '5. AI (Claude Haiku) — נוצר כלל אוטומטי לעתיד → סגול "AI"',
    code: ['apps/web/src/app/(app)/import/actions.ts'],
  },
  {
    id: 'multi-pattern-rules',
    title: 'כללים עם מספר ביטויים',
    category: 'categorization',
    story:
      'כלל יכול לכלול כמה ביטויים מופרדים ב-| (למשל: "חניה|חניון|חניוני|חניוני הבירה"). ' +
      'הכלל מתאים אם מילה אחת מהן מופיעה בשם בית העסק.',
    why: 'מבטל את הצורך ב-3-4 כללים נפרדים לכל וריאציה של אותה קטגוריה.',
    example: 'כלל אחד עם "חניה|חניון|חניוני" יתאים גם ל-"חניה אחוזת הוף", ' +
             'גם ל-"חניון אזרחי", וגם ל-"חניוני הבירה".',
    code: ['packages/categorizer/src/rules-engine.ts'],
  },
  {
    id: 'auto-ai-categorization',
    title: 'תיוג AI אוטומטי בסוף כל ייבוא',
    category: 'categorization',
    story:
      'אחרי שכל שאר השלבים סיימו, אם יש תנועות בקובץ הזה שעדיין ללא קטגוריה — ' +
      'הן נשלחות אוטומטית ל-Claude Haiku בקריאה אחת. עבור כל תוצאה בביטחון ≥0.6, ' +
      'נוצר contains-rule אוטומטי, ושאר התנועות בחשבון עם אותו merchant מתויגות.',
    why: 'מבטל את הצורך ללחוץ ידנית על כפתור "תיוג AI" אחרי כל ייבוא. ' +
         'הכלל שנוצר חוסך קריאת AI נוספת בייבואים הבאים.',
    code: ['apps/web/src/app/(app)/import/actions.ts'],
  },
  {
    id: 'auto-create-categories',
    title: 'יצירה אוטומטית של קטגוריות מקובץ מתויג',
    category: 'categorization',
    story:
      'אם הקובץ מגיע עם קטגוריה משלו (למשל אקסל ידני שלך עם עמודת "קטגוריה"), ' +
      'והקטגוריה הזו עדיין לא קיימת אצלך — היא נוצרת אוטומטית. כך גם תת-קטגוריות.',
    why: 'מאפשר לייבא קובץ עם מבנה קטגוריות חדש בלי הגדרה מוקדמת.',
    code: ['apps/web/src/app/(app)/import/actions.ts'],
  },

  // ── TRANSACTIONS ───────────────────────────────────────────────────
  {
    id: 'forex-immediate-charge',
    title: 'מט"ח תמיד חיוב מיידי',
    category: 'transactions',
    story:
      'כל עסקה במט"ח (לא בש"ח) מקבלת chargeDate = transactionDate, גם אם הקובץ ' +
      'מציג תאריך חיוב חודשי (10 בחודש). חברות אשראי מחייבות עסקאות מט"ח מיידית ' +
      'מהחשבון הבנקאי הקשור — לא ממתינות למחזור החיוב החודשי. בנוסף, בעמוד ' +
      'תנועות, שורות מט"ח מקובצות יחד עם חיובי בנק וההוראות-קבע מתחת לכותרת ' +
      '"חיובים מיידיים — בנק / מט״ח / הוראות קבע" (לא במחזור האשראי החודשי).',
    why: 'תזרים המזומנים בלוח שנה צריך להציג את היום שבו הכסף באמת יצא. ' +
         'גם הקיבוץ הויזואלי בעמוד תנועות צריך לשקף את זה — לא לערבב מט"ח עם ' +
         'חיובי הקבוצה החודשית של ה-10 בחודש.',
    example: 'OpenAI ChatGPT $20 ב-4 במאי → chargeDate = 4 במאי, billing_month = ' +
             'מאי, מופיע תחת "חיובים מיידיים" בעמוד תנועות.',
    code: ['apps/web/src/lib/smart-importer.ts', 'apps/web/src/app/(app)/transactions/transactions-list.tsx'],
  },
  {
    id: 'cc-settlement-detection',
    title: 'זיהוי חיובי כרטיס אשראי בעו"ש',
    category: 'transactions',
    story:
      'כשמעלים קובץ של עו"ש בנק, מופיעות בו שורות מסוג "כ.א.ל חיוב 1,500₪" — ' +
      'אלה החיובים המאוחדים של חברת האשראי. אם נספור אותן כהוצאה רגילה, נספור פעמיים ' +
      '(הפירוט המפורט מגיע מקובץ האשראי). האפליקציה מזהה דפוסים כאלה אוטומטית ' +
      '(כ.א.ל / דיינרס / ויזה / מקס איט / מאסטר / ישראכרט / AMEX) ומסמנת אותן ' +
      'כ-is_transfer=true → מוסרות מסיכום ההוצאות.',
    why: 'מונע ספירה כפולה של אותו כסף.',
    code: ['apps/web/src/app/(app)/import/actions.ts'],
  },
  {
    id: 'cross-account-transfer-pairing',
    title: 'זיווג העברות בין חשבונות',
    category: 'transactions',
    story:
      'אחרי כל ייבוא, האפליקציה סורקת את כל ה-transfers הלא-מזוּוגים במשק הבית. ' +
      'אם מוצאת זוג עם סימן הפוך, סכום זהה (±0.01₪), חשבונות שונים, ותאריכים תוך ' +
      '±2 ימים — היא מקשרת ביניהם דרך transfer_pair_id.',
    why: 'העברה מ-Leumi עסקי ל-Discount פרטי לא צריכה להיחשב כהוצאה בעסקי + הכנסה ' +
         'בפרטי. זה אותו כסף — מקזזים.',
    code: ['apps/web/src/app/(app)/import/actions.ts'],
  },
  {
    id: 'idempotent-import-dedup',
    title: 'ייבוא חוזר של אותו קובץ — אידמפוטנטי',
    category: 'transactions',
    story:
      'כל תנועה מקבלת external_id = SHA1 של (תאריך + תאריך חיוב + סכום + שם עסק + ' +
      'הערות). אם תעלה את אותו קובץ פעמיים — לא נוצרות כפילויות. במקום זאת, אם ' +
      'התנועה הקיימת היתה ללא קטגוריה והעלאה החוזרת עכשיו מוסיפה קטגוריה (אחרי שיפור ' +
      'במפה הפנימית), הקטגוריה תתעדכן (ON CONFLICT DO UPDATE עם COALESCE).',
    why: 'מאפשר העלאה מחדש בטוחה אחרי תיקון לוגיקה, בלי למחוק נתונים ידנית.',
    code: ['apps/web/src/app/(app)/import/actions.ts'],
  },
  {
    id: 'sign-by-account-type',
    title: 'סימן הסכום לפי סוג חשבון',
    category: 'transactions',
    story:
      'בקבצי בנק (עו"ש), הסימן בקובץ זהה לאמת — חיוב (-), זיכוי (+). ' +
      'בקבצי אשראי, ההפך — חיוב הוא חיובי (₪59.94), זיכוי הוא שלילי (-₪177.57). ' +
      'ה-importer מסיק את סוג החשבון מהתבנית ומגדיר את isExpense בהתאם.',
    why: 'בלי זה, משכורת בקובץ עו"ש היתה מופיעה כהוצאה במקום הכנסה.',
    code: ['apps/web/src/lib/smart-importer.ts'],
  },
  {
    id: 'noise-notes-stripped',
    title: 'ניקוי "הוראת קבע" וכדומה משדה ההערות',
    category: 'transactions',
    story:
      'הבנקים נוטים להזריק תוויות סיסטם לעמודת ההערות ("הוראת קבע", "חיוב חודשי", ' +
      '"חיוב עסקת חו"ל בש"ח"). אלה לא הערות אישיות שלך — הן רעש. ה-importer מסיר ' +
      'אותן אוטומטית כדי שעמודת ההערות תכיל רק טקסט אמיתי (כמו תשלומים: ' +
      '"תשלום 4 מתוך 12").',
    why: '"הוראת קבע" לא אומר שהתנועה קבועה — זה רק אומר שלכרטיס יש הרשאה ' +
         'לחיוב אוטומטי. אסור להתבלבל.',
    code: ['apps/web/src/lib/smart-importer.ts'],
  },

  // ── INSTALLMENTS ───────────────────────────────────────────────────
  {
    id: 'installments-auto-create',
    title: 'תוכניות תשלומים נוצרות אוטומטית',
    category: 'installments',
    story:
      'כשתנועה מכילה "תשלום N מתוך Y" בעמודת ההערות, נוצרת אוטומטית תוכנית ' +
      'תשלומים בעמוד /installments עם תאריך התחלה (חודש התשלום הראשון, מחושב ' +
      'אחורה מ-N) ותאריך סיום צפוי. כל תנועה מאותה תוכנית מקושרת אליה.',
    why: 'בלי זה, היית צריך ליצור כל תוכנית ידנית.',
    example: 'KSP "תשלום 3 מתוך 12" → תוכנית עם 12 תשלומים, ' +
             'התחלה לפני 3 חודשים, סיום עוד 9 חודשים.',
    code: ['apps/web/src/app/(app)/import/actions.ts'],
  },
  {
    id: 'installments-projected-rows',
    title: 'תחזית תשלומים עתידיים בעמוד תנועות',
    category: 'installments',
    story:
      'לכל תוכנית פעילה שטרם הסתיימה, האפליקציה מציגה את התשלומים העתידיים ' +
      'כשורות "צפוי" בעמוד /transactions בחודש הרלוונטי. הן מסומנות בתג ' +
      '"צפוי" וצבע אפור-בהיר כדי להבחין מתנועות אמיתיות.',
    why: 'מאפשר לראות מראש את התחייבויות החודש לפני שהקובץ של החודש הזה הגיע.',
    example: 'תוכנית של 4 תשלומים שהתחילה בפברואר → תשלומים 2,3,4 (מרץ, אפריל, מאי) ' +
             'יופיעו כ"צפוי" בעמוד תנועות עד שיגיעו בקבצים של אותם חודשים.',
    code: ['apps/web/src/app/(app)/transactions/page.tsx'],
  },
  {
    id: 'installments-merge-on-import',
    title: 'תחזית מתחלפת אוטומטית בייבוא הבא',
    category: 'installments',
    story:
      'כשהתשלום האמיתי מגיע (למשל "תשלום 2 מתוך 4" בקובץ של חודש הבא), ' +
      'התחזית של אותו חודש נעלמת אוטומטית — מוחלפת בתנועה האמיתית.',
    why: 'שלא תראה גם את התחזית וגם את התנועה האמיתית באותו חודש (כפילות).',
    code: ['apps/web/src/app/(app)/transactions/page.tsx'],
  },

  // ── RECURRING ──────────────────────────────────────────────────────
  {
    id: 'recurring-merchant-join',
    title: 'תג "קבוע" באמצעות join על שם בית עסק',
    category: 'recurring',
    story:
      'הוצאות קבועות מוגדרות בעמוד /recurring (Spotify, ביטוח הראל, ארנונה ' +
      'וכו׳). תג "קבוע" בעמוד /transactions מופיע כשה-merchant_normalized של ' +
      'התנועה תואם בדיוק ל-merchant_normalized של פטרן קבוע פעיל.',
    why: 'אין צורך בתיוג ידני של כל תנועה — מספיק להגדיר את הקבוע פעם אחת ' +
         'וכל ייבוא עתידי יתקבל מסומן.',
    code: ['apps/web/src/app/(app)/transactions/page.tsx'],
  },
  {
    id: 'recurring-amount-modes',
    title: 'מצבי סכום: קבוע / טווח / דינמי',
    category: 'recurring',
    story:
      'כשאתה מגדיר הוצאה קבועה, אתה בוחר איך מטפלים בסכום:\n' +
      '• קבוע — סכום אחד צפוי בכל חודש (Spotify ₪21.90)\n' +
      '• טווח — סכום נע בין מינימום למקסימום (ביטוח הראל ₪194-₪197)\n' +
      '• דינמי — אין תחזית סכום, מה שיגיע בקובץ נחשב כצפוי (חשמל, מים)',
    why: 'הוצאות אמיתיות לא תמיד באותו סכום בדיוק. המודל הקבוע-בלבד היה גורם ' +
         'להזעקות שגיאה כל חודש.',
    code: ['apps/web/src/app/(app)/recurring/recurring-modal.tsx'],
  },
  {
    id: 'recurring-from-rule',
    title: 'יצירת הוצאה קבועה מתוך כלל',
    category: 'recurring',
    story:
      'בעריכת כלל ב-/admin/rules, יש checkbox "סמן בית עסק זה כהוצאה קבועה". ' +
      'אם תפעיל אותו, נוצר אוטומטית רישום בעמוד הוצאות קבועות. עבור כללי "מכיל" ' +
      'עם כמה ביטויים, נוצרים מספר רישומים — אחד לכל merchant ייחודי שכבר תאם.',
    why: 'מאפשר ליצור גם כלל קטגוריה וגם הוצאה קבועה בפעולה אחת.',
    code: ['apps/web/src/app/(app)/admin/rules/actions.ts'],
  },

  // ── CHAT ───────────────────────────────────────────────────────────
  {
    id: 'chat-history-block-splitting',
    title: 'פיצול בלוקים בהיסטוריית הצ\'אט (assistant ↔ user)',
    category: 'transactions',
    story:
      'כששיחה עם ה-AI כוללת קריאות לכלי (tool_use → tool_result), שמירת ' +
      'ההיסטוריה בקובץ אחד מסכמת את כל הבלוקים יחד. אבל ה-API של Anthropic ' +
      'דורש ש-tool_result יושב תמיד בהודעת USER, לא assistant. בטעינה מחדש ' +
      'מ-DB אני מפצל את הבלוקים השמורים: text + tool_use → assistant, ' +
      'tool_result → user. שומר על המבנה של API גם בשיחות ארוכות עם כלים.',
    why: 'בלי פיצול, קריאת ה-API השנייה בכל שיחה נכשלה עם 400 ' +
         '"tool_result blocks can only be in user messages".',
    code: ['apps/worker/src/routes/chat.ts'],
  },

  // ── DASHBOARD ──────────────────────────────────────────────────────
  {
    id: 'dashboard-view-scoping',
    title: 'תובנות בלוח המחוונים מסתננות לפי הטאב הפעיל',
    category: 'transactions',
    story:
      'בלוח המחוונים יש 3 טאבים — אישי / עסקי / משולב. כשאתה מחליף ביניהם, ' +
      'כל המספרים והתובנות (סך הוצאות, מאזן, השוואה לחודש קודם, תוכניות ' +
      'תשלומים פעילות, "מסתיים החודש" וכו׳) מחושבים מחדש רק על החשבונות ' +
      'הרלוונטיים לטאב.',
    why: 'כשאתה מסתכל על "עסקי" אתה לא רוצה לראות תובנות מהחיים האישיים — ' +
         'זה מבלבל בין שתי תזרימי הוצאות נפרדים.',
    example: 'תוכנית תשלומים של ג\'ון ברייס (ויזה לילי דיסקונט = אישי) ' +
             'תופיע ב"מסתיים החודש" רק בטאב אישי או משולב, לא בטאב עסקי.',
    code: ['apps/web/src/app/(app)/page.tsx'],
  },
  {
    id: 'forecast-eom-formula',
    title: 'תחזית מאזן סוף חודש — איך מחושבת',
    category: 'transactions',
    story:
      'בכרטיס "תחזית סוף חודש" החישוב הוא:\n' +
      '1. ממוצע יומי = הוצאות החודש עד היום ÷ הימים שעברו\n' +
      '2. תחזית הוצאות = הוצאות עד עכשיו + (ממוצע יומי × ימים שנותרו)\n' +
      '3. תחזית מאזן = הכנסות החודש − תחזית הוצאות',
    why: 'אקסטרפולציה לינארית פשוטה ושקופה. לא ML, לא ניחוש. הסכום מתעדכן ' +
         'בזמן אמת כשנוספות תנועות. מציגים תחזית רק אם עברו ≥5 ימים בחודש ' +
         'ויש ≥3 תנועות — אחרת הדגימה קטנה מדי וזה מטעה.',
    example: 'יום 12 בחודש, הוצאות עד עכשיו ₪3,600, הכנסות ₪15,000 → ' +
             'ממוצע יומי = ₪300, ימים שנותרו = 19 → תחזית הוצאות = ₪9,300, ' +
             'תחזית מאזן = ₪5,700.',
    code: ['apps/web/src/app/(app)/page.tsx'],
  },

  // ── UI ─────────────────────────────────────────────────────────────
  {
    id: 'badge-color-meanings',
    title: 'משמעות צבעי התגים בעמוד תנועות',
    category: 'ui',
    story:
      'התגים ליד הקטגוריה מספרים מי קיבל את ההחלטה:\n' +
      '🟦 כחול "כלל" — כלל שאתה יצרת ידנית. לחיצה → עריכת הכלל.\n' +
      '🟢 ירוק "תיוג" — הקובץ עצמו הגיע מתויג (אקסל ידני).\n' +
      '🟣 סגול "AI" — Claude תייג בייבוא (או כלל שנוצר אוטומטית ע"י AI). לחיצה → עריכת הכלל האוטומטי.\n' +
      '🟠 כתום "צפוי" — שורה תחזית של תוכנית תשלומים, לא חיוב אמיתי.\n' +
      '🟦 אינדיגו "$" — עסקה במט"ח, חיוב מיידי.\n' +
      '⬜ אפור "↔ העברה" — חצי של זוג העברה בין חשבונות.',
    why: 'שקיפות: תמיד תדע מאיפה הגיעה הקטגוריה / איזה סוג תנועה זו.',
    code: ['apps/web/src/app/(app)/transactions/transactions-columns.tsx'],
  },
  {
    id: 'sticky-header-and-actions',
    title: 'כותרות ועמודת פעולות נשארות גלויות בגלילה',
    category: 'ui',
    story:
      'בטבלת תנועות, הכותרות הראשונות (תאריך / בית עסק / וכו׳) נשארות מודבקות ' +
      'בראש הטבלה כשגוללים מטה. עמודת הפעולות (עיפרון / רכש / מחק) נשארת ' +
      'מודבקת בקצה הקדמי בגלילה אופקית.',
    why: 'ב-table של מאות שורות, שלא תאבד את ההקשר.',
    code: ['apps/web/src/app/(app)/transactions/transactions-list.tsx'],
  },
  {
    id: 'wide-screen-no-wrap',
    title: 'בלי שבירת שורות במסכים רחבים',
    category: 'ui',
    story:
      'בלגאן עברית במסך נייד — שבירת שורה היא חיונית. במסך רחב (>=1024px) — היא ' +
      'מציקה. הטבלה מפעילה whitespace-nowrap רק במסכים גדולים.',
    why: 'משתמש במלוא הרזולוציה כשיש, נשמר נגיש כשאין.',
    code: ['apps/web/src/app/(app)/transactions/transactions-list.tsx'],
  },
];
