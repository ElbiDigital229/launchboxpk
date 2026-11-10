// Reads a salary out of a job ad's text. Arbeitnow has no salary field, so we only trust
// amounts that the ad labels as pay (salary, Gehalt, brutto, per year...) and skip
// funding rounds, revenue and valuations. Returns null when there is no clear salary.

const CUR = { '€': 'EUR', eur: 'EUR', euro: 'EUR', '$': 'USD', usd: 'USD', '£': 'GBP', gbp: 'GBP', chf: 'CHF' };
const SYM = '(?:€|\\$|£|EUR|USD|GBP|CHF|Euro)';
const NUM = '\\d{1,3}(?:[.,\\s\\u00a0]\\d{3})*(?:[.,]\\d{1,2})?\\s?(?:k|K|Tsd\\.?)?';
const RANGE = new RegExp(`(${SYM})?\\s?(${NUM})\\s?(${SYM})?(?:\\s?(?:-|–|—|bis|to|and)\\s?(${SYM})?\\s?(${NUM})\\s?(${SYM})?)?`, 'g');
const PAY_BEFORE = /(salary|compensation|pay range|pay band|base pay|gehalt|vergütung|verguetung|jahresgehalt|bruttojahresgehalt|zielgehalt|fixgehalt|ote\b|stundenlohn|wage|lohn|budget for this role|range for this role|we offer|wir bieten|paid)[^.]{0,80}$/i;
const PAY_AFTER = /^[^.]{0,30}(brutto|gross|per (year|annum|month|hour)|p\.\s?a\.|\/\s?(year|yr|month|mo|hour|h)\b|pro (jahr|monat|stunde)|im jahr|jährlich|annually|a year|a month|monthly|yearly)/i;
const NOT_PAY = /^\s?(m\b|mn|bn|b\b|million|billion|mio|mrd|series|valuation|revenue|funding|in funding|raised)/i;

const num = (s) => {
  let t = s.replace(/[\s ]/g, '');
  const k = /(k|tsd\.?)$/i.test(t);
  t = t.replace(/(k|tsd\.?)$/i, '');
  // "75.000" / "75,000" thousands; "12.55" or "85,50" decimals
  if (/^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(t)) t = t.replace(/[.,](\d{1,2})$/, '').replace(/[.,]/g, '');
  else t = t.replace(',', '.');
  const n = parseFloat(t);
  return k ? n * 1000 : n;
};

export function salary(text) {
  for (const m of text.matchAll(RANGE)) {
    const [all, s1, a, s2, s3, b, s4] = m;
    const sym = s1 || s2 || s3 || s4;
    if (!sym || !a) continue;
    const before = text.slice(Math.max(0, m.index - 100), m.index);
    const after = text.slice(m.index + all.length, m.index + all.length + 40);
    if (NOT_PAY.test(after)) continue;
    if (!PAY_BEFORE.test(before) && !PAY_AFTER.test(after)) continue;
    const lo = num(a), hi = b ? num(b) : lo;
    if (!lo || hi < lo) continue;
    // The words right after the amount win ("£125 per month (£1,500 annually)"), then the words before it
    const which = (t) => /hour|stunde|\/\s?h\b|stundenlohn/.test(t) ? 'hour'
      : /month|monat|\/\s?mo\b|monthly|monatlich/.test(t) ? 'month'
      : /year|jahr|annum|p\.\s?a|annual|yearly|\/\s?yr/.test(t) ? 'year' : '';
    const period = which(after.slice(0, 25).toLowerCase()) || which(before.slice(-40).toLowerCase())
      || (lo >= 15000 ? 'year' : lo >= 500 ? 'month' : 'hour');
    const ok = { year: [5000, 1e6], month: [100, 80000], hour: [5, 500] }[period];
    if (lo < ok[0] || hi > ok[1]) continue;
    const currency = CUR[sym.toLowerCase()] ?? CUR[sym];
    return { min: Math.round(lo), max: Math.round(hi), currency, period };
  }
  return null;
}
