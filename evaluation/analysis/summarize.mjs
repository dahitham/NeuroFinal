#!/usr/bin/env node
/**
 * Descriptive statistics for exported evaluation CSV files (uses the same functions as the backend).
 *   node evaluation/analysis/summarize.mjs evaluation/exports/*.csv
 */
import fs from 'node:fs';
import { aggregate, RESEARCH_COLUMNS } from '../../backend/src/services/evaluationService.js';

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"' && src[i + 1] === '"') (cell += '"', i++); else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') (row.push(cell), (cell = ''));
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  const head = rows[0] || [];
  return rows.slice(1).map((r) => Object.fromEntries(head.filter((h) => RESEARCH_COLUMNS.includes(h)).map((h) => [h, r[head.indexOf(h)] ?? ''])));
}

const files = process.argv.slice(2);
if (!files.length) { console.error('Usage: node evaluation/analysis/summarize.mjs <export.csv> [more.csv …]'); process.exit(1); }
const seen = new Set();
const rows = files.flatMap((f) => parseCsv(fs.readFileSync(f, 'utf8'))).filter((r) => r.Participant_ID && !seen.has(`${r.Participant_ID}|${r.Session_ID}`) && seen.add(`${r.Participant_ID}|${r.Session_ID}`));
const a = aggregate(rows);
if (!a) { console.log('No evaluation data available.'); process.exit(0); }
console.log(`Participants: ${a.n}\nTask completion: ${a.taskCompletion.completed}/${a.taskCompletion.total} (${a.taskCompletion.ratePercent}%)\n\nMeasure                      n   mean  median    sd`);
const row = (name, s) => console.log(`${name.padEnd(26)} ${String(s.n).padStart(3)} ${String(s.mean ?? '-').padStart(6)} ${String(s.median ?? '-').padStart(7)} ${String(s.sd ?? '-').padStart(5)}`);
row('Reading time (s)', a.readingTime); row('Assessment score (0-14)', a.assessmentScore); row('Comprehension (%)', a.comprehension); row('Preference congruence (%)', a.preferenceCongruence);
Object.entries(a.usability).forEach(([k, s]) => row(k, s));
for (const k of ['assistanceLevels', 'fonts', 'lineSpacing', 'letterSpacing', 'wordSpacing']) console.log(`\n${k}:`, a[k]);
