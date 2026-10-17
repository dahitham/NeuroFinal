import crypto from 'node:crypto';
import { AppError } from '../utils/AppError.js';
import { describe, mean, round } from '../utils/stats.js';
import { toCsv } from '../utils/csv.js';
import { effectiveSettings } from './accessibilityService.js';

/**
 * Anonymous research evaluation. Records contain NO name, e-mail, user id, phone, address or
 * medical information – only the measurements below. Participant ids are sequential (P001, P002 …)
 * and are never linked to an account.
 */
export const RESEARCH_COLUMNS = [
  'Participant_ID', 'Session_ID', 'Reading_Time', 'Assessment_Score', 'Comprehension_Score', 'Assistance_Level',
  'Font', 'Font_Size', 'Line_Spacing', 'Letter_Spacing', 'Word_Spacing', 'Bionic_Reading', 'Color_Tint', 'TTS',
  'Reader_Mode', 'Focus_Mode', 'Preference_Congruence', 'Task_Completion', 'Ease_of_Reading', 'Navigation_Ease',
  'Usefulness', 'Satisfaction',
];

const yn = (b) => (b ? 'Yes' : 'No');
const isRating = (v) => Number.isInteger(v) && v >= 1 && v <= 5;

export function validateEvaluationInput(body) {
  const r = body && body.ratings;
  if (!r || ![r.easeOfReading, r.navigationEase, r.usefulness, r.satisfaction].every(isRating))
    throw new AppError(400, 'Please rate ease of reading, navigation ease, usefulness and satisfaction from 1 to 5.', 'VALIDATION');
  if (typeof body.taskCompleted !== 'boolean') throw new AppError(400, '"taskCompleted" must be true or false.', 'VALIDATION');
  return { ratings: r, taskCompleted: body.taskCompleted };
}

/** Builds one anonymous record from the user's REAL stored results – the client cannot inject measurements. */
export function buildRecord({ user, participantId, ratings, taskCompleted }) {
  const result = user.assessment && user.assessment.core && user.assessment.core.result;
  const s = effectiveSettings(user);
  const secs = result && result.breakdown && result.breakdown.reading && Array.isArray(result.breakdown.reading.rounds)
    ? result.breakdown.reading.rounds.filter((r) => r.seconds > 0).map((r) => r.seconds)
    : [];
  const comprehension = result && result.breakdown && result.breakdown.comprehension
    ? result.breakdown.comprehension.percent
    : result && result.breakdown && Array.isArray(result.breakdown.categories)
      ? result.breakdown.categories.find((category) => category.key === 'comprehension')?.percent ?? ''
      : '';
  return {
    Participant_ID: participantId,
    Session_ID: 'S-' + crypto.randomBytes(4).toString('hex'),
    Reading_Time: secs.length ? round(mean(secs), 1) : '',
    Assessment_Score: result ? result.score.total : '',
    Comprehension_Score: comprehension,
    Assistance_Level: result ? result.score.level : '',
    Font: s.font,
    Font_Size: s.fontSize,
    Line_Spacing: s.lineSpacing,
    Letter_Spacing: s.letterSpacing,
    Word_Spacing: s.wordSpacing,
    Bionic_Reading: yn(s.bionicReading),
    Color_Tint: s.colorTint,
    TTS: yn(s.textToSpeech),
    Reader_Mode: yn(s.readerMode),
    Focus_Mode: yn(s.focusMode),
    Preference_Congruence: result && result.preferences && result.preferences.congruence && result.preferences.congruence.score != null ? result.preferences.congruence.score : '',
    Task_Completion: yn(taskCompleted),
    Ease_of_Reading: ratings.easeOfReading,
    Navigation_Ease: ratings.navigationEase,
    Usefulness: ratings.usefulness,
    Satisfaction: ratings.satisfaction,
  };
}

const num = (rows, col) => rows.map((r) => (r[col] === '' ? null : Number(r[col]))).filter((v) => v != null && !Number.isNaN(v));
const tally = (rows, col) => rows.reduce((a, r) => ((a[r[col]] = (a[r[col]] || 0) + 1), a), {});

/** Descriptive statistics over real records only. Returns null when there is no data. */
export function aggregate(rows) {
  const n = rows.length;
  if (!n) return null;
  const completed = rows.filter((r) => r.Task_Completion === 'Yes').length;
  return {
    n,
    assistanceLevels: tally(rows, 'Assistance_Level'),
    fonts: tally(rows, 'Font'),
    lineSpacing: tally(rows, 'Line_Spacing'),
    letterSpacing: tally(rows, 'Letter_Spacing'),
    wordSpacing: tally(rows, 'Word_Spacing'),
    readingTime: describe(num(rows, 'Reading_Time')),
    assessmentScore: describe(num(rows, 'Assessment_Score')),
    comprehension: describe(num(rows, 'Comprehension_Score')),
    preferenceCongruence: describe(num(rows, 'Preference_Congruence')),
    taskCompletion: { completed, total: n, ratePercent: round((completed / n) * 100, 1) },
    usability: {
      easeOfReading: describe(num(rows, 'Ease_of_Reading')),
      navigationEase: describe(num(rows, 'Navigation_Ease')),
      usefulness: describe(num(rows, 'Usefulness')),
      satisfaction: describe(num(rows, 'Satisfaction')),
    },
  };
}

export const recordsToCsv = (rows) => toCsv(RESEARCH_COLUMNS, rows);
