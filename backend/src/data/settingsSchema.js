/**
 * Accessibility settings – one schema shared by the API, the Reading Studio page and the
 * browser extension engine. Names/ranges mirror the controls in the "Reading Studio" design.
 *
 *   fontSize        14–28 px          (16 = leave the website's size alone)
 *   lineSpacing     1–2.4             (1.5 = leave the website's line height alone)
 *   letterSpacing   0–10  (× 0.01em)
 *   wordSpacing     0–10  (× 0.03em)
 *   speechSpeed     0.5–2
 */
export const DEFAULT_SETTINGS = Object.freeze({
  font: 'system',
  fontSize: 16,
  lineSpacing: 1.5,
  letterSpacing: 0,
  wordSpacing: 0,
  bionicReading: false,
  bionicIntensity: 'normal',
  readingRuler: false,
  focusMode: false,
  readerMode: false,
  background: 'white',
  colorTint: 'none',
  contrast: 'standard',
  textToSpeech: false,
  speechSpeed: 1,
});

export const SETTING_RULES = Object.freeze({
  font: { type: 'enum', values: ['system', 'lexend', 'atkinson', 'opendyslexic'] },
  fontSize: { type: 'number', min: 14, max: 28, step: 1 },
  lineSpacing: { type: 'number', min: 1, max: 2.4, step: 0.1 },
  letterSpacing: { type: 'number', min: 0, max: 10, step: 1 },
  wordSpacing: { type: 'number', min: 0, max: 10, step: 1 },
  bionicReading: { type: 'boolean' },
  bionicIntensity: { type: 'enum', values: ['light', 'normal'] },
  readingRuler: { type: 'boolean' },
  focusMode: { type: 'boolean' },
  readerMode: { type: 'boolean' },
  background: { type: 'enum', values: ['white', 'cream', 'gray'] },
  colorTint: { type: 'enum', values: ['none', 'yellow', 'blue'] },
  contrast: { type: 'enum', values: ['standard', 'high'] },
  textToSpeech: { type: 'boolean' },
  speechSpeed: { type: 'number', min: 0.5, max: 2, step: 0.1 },
});

/** Settings recommended for each Recommended Assistance Level. */
export const LEVEL_SETTINGS = Object.freeze({
  // Level 1 – Basic / Mild: light bionic reading, default spacing, reading ruler optional (off)
  1: { font: 'system', fontSize: 16, lineSpacing: 1.5, letterSpacing: 0, wordSpacing: 0, bionicReading: true, bionicIntensity: 'light', readingRuler: false, focusMode: false, readerMode: false, background: 'white', colorTint: 'none', contrast: 'standard', textToSpeech: false, speechSpeed: 1 },
  // Level 2 – Moderate: Lexend, more spacing, soft colour tint (bionic optional → off)
  2: { font: 'lexend', fontSize: 18, lineSpacing: 1.9, letterSpacing: 4, wordSpacing: 3, bionicReading: false, bionicIntensity: 'light', readingRuler: false, focusMode: false, readerMode: false, background: 'cream', colorTint: 'yellow', contrast: 'standard', textToSpeech: false, speechSpeed: 1 },
  // Level 3 – High / Maximum: OpenDyslexic, wide spacing, TTS, reader mode, focus mode, reading ruler
  3: { font: 'opendyslexic', fontSize: 20, lineSpacing: 2.0, letterSpacing: 6, wordSpacing: 6, bionicReading: false, bionicIntensity: 'light', readingRuler: true, focusMode: true, readerMode: true, background: 'cream', colorTint: 'yellow', contrast: 'standard', textToSpeech: true, speechSpeed: 1 },
});

export const LEVEL_LABELS = Object.freeze({ 1: 'Mild Assistance', 2: 'Moderate Assistance', 3: 'Maximum Assistance' });
export const LEVEL_CLASSIFICATION = Object.freeze({ 1: 'Basic / Mild Assistance', 2: 'Moderate Assistance', 3: 'High / Maximum Assistance' });
