// Quick check: does parseAmount handle the U+20AA NIS prefix correctly
const inputs = ['₪ 37.00', '₪ 100.00', '₪1000', '37.00', ''];
function parseAmount(raw) {
  if (typeof raw === 'number') return raw;
  let s = String(raw ?? '').trim();
  if (!s) return NaN;
  s = s.replace(/[₪$€£\s]/g, '').replace(/,/g, '');
  if (/^\(.+\)$/.test(s)) s = '-' + s.slice(1, -1);
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
for (const inp of inputs) {
  console.log(`"${inp}" → ${parseAmount(inp)}`);
}
