export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** Sample standard deviation (n − 1); needs ≥ 2 values. */
export function stdDev(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
export const round = (v, d = 2) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
export const describe = (a) => ({ n: a.length, mean: round(mean(a)), median: round(median(a)), sd: round(stdDev(a)) });
