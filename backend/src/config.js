import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

/** All configuration comes from environment variables. No secret has a hard-coded default. */
export function buildConfig(env = process.env) {
  let jwtSecret = env.JWT_SECRET;
  let ephemeralSecret = false;
  if (!jwtSecret) {
    jwtSecret = crypto.randomBytes(32).toString('hex'); // sessions reset on restart until JWT_SECRET is set
    ephemeralSecret = true;
  }
  return {
    port: Number(env.PORT) || 4000,
    jwtSecret,
    ephemeralSecret,
    gemini: {
      apiKey: env.GEMINI_API_KEY || '',
      model: env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
      baseUrl: (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, ''),
      timeoutMs: Number(env.GEMINI_TIMEOUT_MS) || 30000,
    },
    corsOrigins: env.CORS_ORIGINS ? list(env.CORS_ORIGINS) : DEFAULT_ORIGINS,
    datasetsDir: env.DATASETS_DIR ? path.resolve(env.DATASETS_DIR) : path.resolve(here, '../../datasets'),
    storageDir: env.STORAGE_DIR ? path.resolve(env.STORAGE_DIR) : path.resolve(here, '../storage'),
    researchAdmins: list(env.RESEARCH_ADMIN_EMAILS).map((e) => e.toLowerCase()),
    rateLimit: { windowMs: 60_000, ai: Number(env.AI_RATE_LIMIT) || 30, auth: Number(env.AUTH_RATE_LIMIT) || 20 },
  };
}

export default buildConfig();
