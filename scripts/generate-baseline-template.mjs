// Generate baseline-template.xlsx — a clean, minimal template for the user to fill in.
// 5 sheets: Accounts, Transactions, Construction, Categories (optional), README.
//
// Run: node scripts/generate-baseline-template.mjs
// Output: reference/baseline-template.xlsx

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const refDir = join(__dirname, '..', 'reference');
mkdirSync(refDir, { recursive: true });
const outPath = join(refDir, 'baseline-template.xlsx');

const wb = XLSX.utils.book_new();

// =========================================================================
// Sheet 1: Accounts
// =========================================================================
const accountsHeader = [
  'name',
  'type',
  'purpose',
  'institution',
  'initial_balance_ils',
  'notes',
];
const accountsSample = [
  ['חשבון לאומי משפחתי', 'bank', 'personal', 'leumi', 12000, 'חשבון עו"ש עיקרי'],
  ['חשבון דיסקונט', 'bank', 'personal', 'discount', 0, 'חשבון המשכנתא'],
  ['חשבון עסקי לאומי', 'bank', 'business', 'leumi', 8000, 'חשבון העסק העצמאי'],
  ['ויזה כאל יניב', 'credit_card', 'personal', 'cal', 0, ''],
  ['ישראכרט יניב', 'credit_card', 'personal', 'isracard', 0, ''],
  ['לאומי פיננס עסקי', 'credit_card', 'business', 'leumi-card', 0, 'מחויב לחשבון עסקי'],
  ['מזומן', 'bank', 'personal', 'manual', 500, 'קופה ומזומן בארנק'],
];
const accountsWs = XLSX.utils.aoa_to_sheet([accountsHeader, ...accountsSample]);
accountsWs['!cols'] = [
  { wch: 26 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 30 },
];
XLSX.utils.book_append_sheet(wb, accountsWs, 'Accounts');

// =========================================================================
// Sheet 2: Transactions (April 2026)
// =========================================================================
const txnsHeader = [
  'date',
  'account',
  'amount_ils',
  'merchant',
  'category',
  'sub_category',
  'is_recurring',
  'is_transfer',
  'notes',
];
const txnsSample = [
  // ----- Recurring fixed expenses -----
  ['2026-04-01', 'חשבון לאומי משפחתי', -4854, 'בנק לאומי משכנתא', 'בית ומשק', 'משכנתא', 'TRUE', 'FALSE', ''],
  ['2026-04-01', 'חשבון לאומי משפחתי', -710, 'עיריית רמת גן', 'בית ומשק', 'ארנונה', 'TRUE', 'FALSE', 'דו-חודשית'],
  ['2026-04-01', 'חשבון לאומי משפחתי', -1709, 'ועד בית', 'בית ומשק', 'ועד בית', 'TRUE', 'FALSE', ''],
  ['2026-04-01', 'חשבון לאומי משפחתי', -95, 'בזק אינטרנט', 'תקשורת', 'אינטרנט', 'TRUE', 'FALSE', ''],
  ['2026-04-01', 'חשבון לאומי משפחתי', -135, 'פלאפון', 'תקשורת', 'סלולר', 'TRUE', 'FALSE', ''],
  ['2026-04-01', 'חשבון לאומי משפחתי', -387, 'הראל בריאות', 'בריאות', 'ביטוח בריאות', 'TRUE', 'FALSE', ''],
  // ----- Variable spending -----
  ['2026-04-05', 'ויזה כאל יניב', -350, 'שופרסל', 'מכולת ומזון', 'סופרמרקט', 'FALSE', 'FALSE', ''],
  ['2026-04-12', 'ויזה כאל יניב', -180, 'משלוחי 10ביס', 'מסעדות וקפה', 'משלוחי מזון', 'FALSE', 'FALSE', ''],
  ['2026-04-15', 'ישראכרט יניב', -260, 'דלק פז', 'תחבורה', 'דלק', 'FALSE', 'FALSE', ''],
  ['2026-04-20', 'מזומן', -100, 'חוג בלט - ילדה', 'ילדים וחינוך', 'חוגים', 'FALSE', 'FALSE', ''],
  // ----- Personal income -----
  ['2026-04-01', 'חשבון לאומי משפחתי', 7500, 'משכורת בן/בת הזוג', 'הכנסות', 'משכורת בן זוג', 'TRUE', 'FALSE', 'מקור: מקום העבודה של בן/בת הזוג'],
  // ----- Business income (gross) -----
  ['2026-04-15', 'חשבון עסקי לאומי', 42000, 'הכנסות חודש אפריל', 'הכנסות', 'הכנסה עסקית', 'FALSE', 'FALSE', 'סיכום הכנסות מחשבוניות אפריל'],
  // ----- Business expenses -----
  ['2026-04-15', 'חשבון עסקי לאומי', -7180, 'מע"מ', 'עסק', 'מע"מ', 'TRUE', 'FALSE', '17% מההכנסות'],
  ['2026-04-15', 'חשבון עסקי לאומי', -5414, 'ביטוח לאומי', 'עסק', 'ביטוח לאומי', 'TRUE', 'FALSE', ''],
  ['2026-04-15', 'חשבון עסקי לאומי', -5626, 'פנסיה', 'עסק', 'פנסיה', 'TRUE', 'FALSE', ''],
  ['2026-04-30', 'חשבון עסקי לאומי', -1500, 'רואה חשבון', 'עסק', 'רואה חשבון', 'TRUE', 'FALSE', ''],
  // ----- Salary transfer (TWO rows, both is_transfer=TRUE) -----
  ['2026-04-01', 'חשבון עסקי לאומי', -15000, 'העברה לחשבון אישי', 'משכורת', 'העברה מעסקי', 'TRUE', 'TRUE', 'יוצא מעסקי'],
  ['2026-04-01', 'חשבון לאומי משפחתי', 15000, 'העברה מחשבון עסקי', 'משכורת', 'העברה מעסקי', 'TRUE', 'TRUE', 'נכנס לאישי'],
];
const txnsWs = XLSX.utils.aoa_to_sheet([txnsHeader, ...txnsSample]);
txnsWs['!cols'] = [
  { wch: 12 }, { wch: 26 }, { wch: 12 }, { wch: 30 }, { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 30 },
];
XLSX.utils.book_append_sheet(wb, txnsWs, 'Transactions');

// =========================================================================
// Sheet 3: Construction project
// =========================================================================
const constHeader = ['date', 'account', 'amount_ils', 'merchant', 'notes'];
const constSample = [
  ['2026-04-06', 'חשבון לאומי משפחתי', -141600, 'קבלן ראשי', 'תשלום 4 מתוך 8 — שלב גמר'],
  ['2026-04-29', 'חשבון לאומי משפחתי', -212400, 'קבלן ראשי', 'תשלום 5 מתוך 8'],
  ['2026-04-15', 'חשבון לאומי משפחתי', -3800, 'מהנדס פיקוח', 'פיקוח חודשי'],
  ['2026-04-22', 'ויזה כאל יניב', -1250, 'הום סנטר', 'חומרים נלווים'],
];
const constWs = XLSX.utils.aoa_to_sheet([constHeader, ...constSample]);
constWs['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 14 }, { wch: 26 }, { wch: 36 }];
XLSX.utils.book_append_sheet(wb, constWs, 'Construction');

// =========================================================================
// Sheet 4: Categories (OPTIONAL — leave empty for auto-create)
// =========================================================================
const catsHeader = ['name_he', 'parent', 'monthly_target_ils', 'color'];
const catsSample = [
  ['מכולת ומזון', '', 4000, '#f97316'],
  ['סופרמרקט', 'מכולת ומזון', '', ''],
  ['משלוחי מזון', 'מכולת ומזון', '', ''],
  ['בית ומשק', '', 9000, '#8b5cf6'],
  ['משכנתא', 'בית ומשק', '', ''],
  ['ארנונה', 'בית ומשק', '', ''],
  ['ועד בית', 'בית ומשק', '', ''],
];
const catsWs = XLSX.utils.aoa_to_sheet([catsHeader, ...catsSample]);
catsWs['!cols'] = [{ wch: 24 }, { wch: 22 }, { wch: 18 }, { wch: 10 }];
XLSX.utils.book_append_sheet(wb, catsWs, 'Categories');

// =========================================================================
// Sheet 5: README
// =========================================================================
const readmeRows = [
  ['Family Budget App — Baseline Template'],
  [''],
  ['מה הקובץ הזה?'],
  ['  קובץ אקסל אחד עם 4 גליונות שאת/ה ממלא/ת בנתונים אמיתיים, ולאחר מכן מעלה לאפליקציה.'],
  ['  המטרה: בייסליין נקי ומדויק במקום להתבסס על האקסל ההיסטורי המורכב.'],
  [''],
  ['גליון 1 — Accounts (חשבונות)'],
  ['  מילוי חד-פעמי של כל החשבונות והכרטיסים שלך.'],
  ['  עמודות:'],
  ['    name           — שם תצוגה (חופשי בעברית)'],
  ['    type           — bank / credit_card'],
  ['    purpose        — personal / business / shared'],
  ['    institution    — leumi / discount / hapoalim / cal / isracard / max / leumi-card / manual'],
  ['    initial_balance_ils — יתרה נכון לתחילת אפריל 2026 (מספר חיובי). רשות.'],
  ['    notes          — חופשי'],
  [''],
  ['גליון 2 — Transactions (תנועות)'],
  ['  כל התנועות לחודש אפריל 2026 (פרט לתנועות בנייה — אלו בגליון נפרד).'],
  ['  עמודות:'],
  ['    date          — בפורמט YYYY-MM-DD'],
  ['    account       — חייב להיות זהה בדיוק לשם בגליון Accounts'],
  ['    amount_ils    — חיובי = הכנסה, שלילי = הוצאה'],
  ['    merchant      — שם בית עסק / תיאור (חופשי)'],
  ['    category      — קטגוריית-על (חופשי, נוצרת אוטומטית אם לא קיימת)'],
  ['    sub_category  — תת-קטגוריה (רשות)'],
  ['    is_recurring  — TRUE אם זו הוצאה/הכנסה קבועה (משכנתא, משכורת)'],
  ['    is_transfer   — TRUE אם זו העברה בין שני חשבונות שלך (לא הכנסה/הוצאה אמיתית)'],
  ['    notes         — חופשי'],
  [''],
  ['  *** העברות (is_transfer) ***'],
  ['  כשאת/ה מעביר/ה כסף בין חשבונות שלך (למשל מעסקי לפרטי 15,000), הוסף שתי שורות:'],
  ['    1) באותו תאריך, מהחשבון שמעביר, אמאונט שלילי (-15000), is_transfer=TRUE'],
  ['    2) באותו תאריך, לחשבון שמקבל, אמאונט חיובי (+15000), is_transfer=TRUE'],
  ['  המערכת תזהה את שתי השורות לפי תאריך+סכום ותקשר אותן לזוג אחד.'],
  ['  בתצוגת "משולב" של לוח המחוונים, ההעברות לא יסופרו כדי לא להכפיל הכנסות.'],
  [''],
  ['גליון 3 — Construction (בנייה)'],
  ['  פרויקט הבנייה לפי תנועות. נוצר אוטומטית פרויקט בשם "בניית בית" וכל השורות יקושרו אליו.'],
  ['  התנועות האלה לא יופיעו בסיכום החודשי הרגיל בלוח המחוונים (אבל אפשר לראות אותן בתצוגת הפרויקט).'],
  [''],
  ['גליון 4 — Categories (אופציונלי)'],
  ['  להגדרת יעדים חודשיים לקטגוריות. אם תשאיר/י ריק — קטגוריות ייווצרו אוטומטית מתוך Transactions.'],
  [''],
  ['טיפים'],
  ['  • התאריך תמיד YYYY-MM-DD — אקסל לפעמים משנה אוטומטית, ודא/י שזה לא כולל שעה.'],
  ['  • TRUE/FALSE רגילים, לא "כן"/"לא".'],
  ['  • שמות חשבונות זהים בדיוק (כולל רווחים) בין Accounts ו-Transactions.'],
  ['  • לאחר ההעלאה, בדוק/בדקי בלוח המחוונים שהמספרים הגיוניים. אם משהו חסר — תקן/י את הקובץ ותעלה/תעלי שוב (יש דדופ אוטומטי).'],
];
const readmeWs = XLSX.utils.aoa_to_sheet(readmeRows);
readmeWs['!cols'] = [{ wch: 110 }];
XLSX.utils.book_append_sheet(wb, readmeWs, 'README');

XLSX.writeFile(wb, outPath);
console.log(`✓ Wrote ${outPath}`);
console.log(`  Open it in Excel, replace the sample rows with your real data, and upload.`);
