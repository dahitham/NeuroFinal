/**
 * Reading Preference test (dataset: Reading Preference & Font Preference).
 * Turns the answers into features, builds live-preview styles for the options,
 * and calculates how well the RECOMMENDED settings match what the user said they prefer.
 */
export const PREF_IDS = ['PREF-FONT-01', 'PREF-SPACE-01', 'PREF-LSPACE-01', 'PREF-BIONIC-01', 'PREF-SIMP-01', 'PREF-COLOR-01'];

export function optionToFeature(id, option) {
  const o = String(option || '');
  switch (id) {
    case 'PREF-FONT-01':
      return { key: 'font', value: /lexend/i.test(o) ? 'lexend' : /dyslexic/i.test(o) ? 'opendyslexic' : /atkinson/i.test(o) ? 'atkinson' : 'system' };
    case 'PREF-SPACE-01':
      return { key: 'lineSpacing', value: /2\.0x|wide/i.test(o) ? 'wide' : /1\.5x|moderate/i.test(o) ? 'moderate' : 'standard' };
    case 'PREF-LSPACE-01':
      return { key: 'letterSpacing', value: /expanded/i.test(o) ? 'expanded' : 'standard' };
    case 'PREF-BIONIC-01':
      return { key: 'bionic', value: /bionic/i.test(o) };
    case 'PREF-SIMP-01':
      return { key: 'simplification', value: /simplified/i.test(o) ? 'simplified' : 'original' };
    case 'PREF-COLOR-01':
      return { key: 'color', value: /yellow/i.test(o) ? 'yellow' : /blue/i.test(o) ? 'blue' : /dark/i.test(o) ? 'dark' : 'none' };
    default:
      return null;
  }
}

export function answersToFeatures(answers = {}) {
  const out = {};
  for (const [id, option] of Object.entries(answers)) {
    const f = optionToFeature(id, option);
    if (f) out[f.key] = f.value;
  }
  return out;
}

/** Styles the client applies to the sample text when an option is selected (so preview matches the setting). */
export function previewStyles(item) {
  const by = {};
  for (const opt of item.options) {
    const f = optionToFeature(item.id, opt);
    const s = {};
    if (!f) continue;
    if (f.key === 'font') s.font = f.value;
    if (f.key === 'lineSpacing') s.lineHeight = f.value === 'wide' ? 2 : f.value === 'moderate' ? 1.5 : 1.2;
    if (f.key === 'letterSpacing') s.letterSpacing = f.value === 'expanded' ? '0.12em' : 'normal';
    if (f.key === 'bionic') s.bionic = f.value;
    if (f.key === 'simplification') s.text = f.value === 'simplified' ? item.textSimplified : item.textOriginal;
    if (f.key === 'color') Object.assign(s, { yellow: { background: '#FCF6E3', color: '#1E2F36' }, blue: { background: '#E3EEF9', color: '#1E2F36' }, dark: { background: '#15171c', color: '#E5E7EB' }, none: { background: '#FFFFFF', color: '#1E2F36' } }[f.value]);
    by[opt] = s;
  }
  return by;
}

const lineBucket = (v) => (v <= 1.5 ? 'standard' : v <= 1.9 ? 'moderate' : 'wide');
const tintFamily = (s) => (s.colorTint !== 'none' || s.background !== 'white' ? 'soft tint' : 'none');

/**
 * Compares RECOMMENDED settings with the user's stated preferences.
 * A personalization-alignment measure – not diagnostic accuracy.
 * @returns {{score:number|null, matchedFeatures:string[], matchedCount:number, totalFeatures:number, details:object[]}}
 */
export function calculatePreferenceCongruence(recommended, features) {
  const rec = recommended || {};
  const pre = features || {};
  const colorPref = pre.color === undefined ? undefined : pre.color === 'yellow' || pre.color === 'blue' ? 'soft tint' : pre.color;
  const checks = [
    ['Font', rec.font, pre.font],
    ['Line spacing', rec.lineSpacing == null ? undefined : lineBucket(rec.lineSpacing), pre.lineSpacing],
    ['Letter spacing', rec.letterSpacing == null ? undefined : rec.letterSpacing > 0 ? 'expanded' : 'standard', pre.letterSpacing],
    ['Bionic reading', !!rec.bionicReading, pre.bionic],
    ['Color tint', rec.colorTint == null ? undefined : tintFamily(rec), colorPref],
  ].filter(([, , p]) => p !== undefined);
  const details = checks.map(([feature, r, p]) => ({ feature, recommended: r, preferred: p, match: r === p }));
  const matched = details.filter((d) => d.match);
  return {
    score: details.length ? Math.round((matched.length / details.length) * 100) : null,
    matchedFeatures: matched.map((d) => d.feature),
    matchedCount: matched.length,
    totalFeatures: details.length,
    details,
  };
}
