import { DEFAULT_SETTINGS, LEVEL_SETTINGS, LEVEL_LABELS, LEVEL_CLASSIFICATION } from '../data/settingsSchema.js';

export const classifyAssistance = (total) => {
  const level = total <= 4 ? 1 : total <= 9 ? 2 : 3;
  return { level, label: LEVEL_LABELS[level], classification: LEVEL_CLASSIFICATION[level] };
};

/**
 * Builds the recommended accessibility profile for an assistance level.
 * @param {number|{level?:number,total?:number,assistanceLevel?:number}} input 0–14 score, or an object with the level/score
 */
export function generateAccessibilityProfile(input) {
  let level;
  if (typeof input === 'number') level = classifyAssistance(input).level;
  else if (input && input.level) level = input.level;
  else if (input && input.assistanceLevel) level = input.assistanceLevel;
  else if (input && typeof input.total === 'number') level = classifyAssistance(input.total).level;
  if (![1, 2, 3].includes(level)) level = 1;
  return {
    assistanceLevel: level,
    assistanceLabel: LEVEL_LABELS[level],
    settings: { ...DEFAULT_SETTINGS, ...LEVEL_SETTINGS[level] },
  };
}

const FONT_NAMES = { lexend: 'Lexend font', atkinson: 'Atkinson Hyperlegible font', opendyslexic: 'OpenDyslexic font' };

/** Human-readable checklist shown on the Assessment Results page ("Recommended accessibility settings"). */
export function describeSettings(s) {
  const out = [];
  if (FONT_NAMES[s.font]) out.push(FONT_NAMES[s.font]);
  if (s.fontSize > 16) out.push(`Larger text (${s.fontSize}px)`);
  if (s.lineSpacing > 1.5) out.push('Increased line spacing');
  if (s.letterSpacing > 0) out.push('Increased letter spacing');
  if (s.wordSpacing > 0) out.push('Increased word spacing');
  if (s.colorTint !== 'none' || s.background !== 'white') out.push('Soft color tint');
  if (s.contrast === 'high') out.push('High contrast');
  if (s.bionicReading) out.push(s.bionicIntensity === 'light' ? 'Light bionic reading' : 'Bionic reading');
  if (s.readingRuler) out.push('Reading ruler');
  if (s.focusMode) out.push('Focus support');
  if (s.readerMode) out.push('Reader mode');
  if (s.textToSpeech) out.push('Text-to-speech');
  return out.length ? out : ['Default reading settings'];
}

export const levelInfo = (level) => ({
  level,
  label: LEVEL_LABELS[level],
  classification: LEVEL_CLASSIFICATION[level],
  description: [
    '',
    'Your answers suggest that you may need only light support. This is a personalization guide, not a diagnosis.',
    'Your answers suggest that a few reading supports may help. This is a personalization guide, not a diagnosis.',
    'Your answers suggest that stronger reading supports may help. This is a personalization guide, not a diagnosis.',
  ][level],
});
