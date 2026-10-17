import config from './config.js';
import { createApp } from './app.js';
import { getDatasets } from './data/datasets.js';

const data = getDatasets(config.datasetsDir);
const app = createApp();
app.listen(config.port, () => {
  console.log(`NeuroSync API listening on http://localhost:${config.port}`);
  console.log('Datasets loaded:', JSON.stringify(data.report.loaded));
  if (data.report.missing.length) console.warn('MISSING datasets:', data.report.missing.join(', '));
  if (Object.keys(data.report.skipped).length) console.warn('Skipped malformed dataset items (originals untouched):', JSON.stringify(data.report.skipped));
  console.log(config.gemini.apiKey ? `Gemini model: ${config.gemini.model}` : 'GEMINI_API_KEY is not set – AI endpoints answer "temporarily unavailable"; local tools are unaffected.');
  if (config.ephemeralSecret) console.log('JWT_SECRET is not set – using a temporary secret; sign-ins reset when the server restarts.');
});
