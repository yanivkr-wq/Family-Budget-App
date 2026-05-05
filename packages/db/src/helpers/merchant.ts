// Normalize merchant strings from Israeli bank/CC scrapers so that the same
// vendor matches across slightly different raw spellings.
//
// Operations:
//   1. Lowercase Latin chars (Hebrew is unaffected).
//   2. Strip common installment markers ("תשלום X מתוך Y", "תשלום מס׳ X", "Payment X of Y").
//   3. Strip date suffixes ("- 12/04/2026").
//   4. Collapse repeated whitespace.
//   5. Trim.
//
// Returns a canonical string suitable for grouping, fuzzy match, and rule lookup.

const INSTALLMENT_HE_PATTERNS: RegExp[] = [
  /תשלום\s*\d+\s*(?:מתוך|\/)\s*\d+/g,
  /תשלום\s*מס[׳']?\s*\d+/g,
  /\bת\.\s*\d+\s*\/\s*\d+\b/g,
];

const INSTALLMENT_EN_PATTERNS: RegExp[] = [
  /payment\s+\d+\s+of\s+\d+/gi,
  /\b\d+\s*\/\s*\d+\s*(?:payments?|תשלומים?)\b/gi,
];

const DATE_SUFFIX_PATTERNS: RegExp[] = [
  /[-–—]\s*\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\s*$/, // "- 12/04/2026"
  /[-–—]\s*\d{1,2}[\/.-]\d{1,2}\s*$/, // "- 12/04"
];

export function normalizeMerchant(raw: string): string {
  if (!raw) return '';
  let s = raw.normalize('NFKC');

  for (const re of INSTALLMENT_HE_PATTERNS) s = s.replace(re, '');
  for (const re of INSTALLMENT_EN_PATTERNS) s = s.replace(re, '');
  for (const re of DATE_SUFFIX_PATTERNS) s = s.replace(re, '');

  s = s.toLowerCase();
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[\-_*•·]+$/g, '').trim();
  return s;
}

// Extract installment info from the raw string if present. Returns null if no
// installment marker found.
export interface InstallmentMatch {
  current: number;
  total: number | null; // null if pattern said "תשלום מס X" without total
}

export function parseInstallment(raw: string): InstallmentMatch | null {
  if (!raw) return null;
  const norm = raw.normalize('NFKC');

  // Hebrew "תשלום X מתוך Y" or "תשלום X / Y"
  const heMatch = /תשלום\s*(\d+)\s*(?:מתוך|\/)\s*(\d+)/.exec(norm);
  if (heMatch) {
    const current = Number(heMatch[1]);
    const total = Number(heMatch[2]);
    if (current > 0 && total > 0 && current <= total) {
      return { current, total };
    }
  }

  // Hebrew "תשלום מס׳ X" — count only, total unknown
  const heNumOnly = /תשלום\s*מס[׳']?\s*(\d+)/.exec(norm);
  if (heNumOnly) {
    return { current: Number(heNumOnly[1]), total: null };
  }

  // English "Payment X of Y"
  const enMatch = /payment\s+(\d+)\s+of\s+(\d+)/i.exec(norm);
  if (enMatch) {
    return { current: Number(enMatch[1]), total: Number(enMatch[2]) };
  }

  // Generic "X / Y תשלומים" or "X/Y payments"
  const generic = /\b(\d+)\s*\/\s*(\d+)\s*(?:תשלומים?|payments?)\b/i.exec(norm);
  if (generic) {
    return { current: Number(generic[1]), total: Number(generic[2]) };
  }

  return null;
}
