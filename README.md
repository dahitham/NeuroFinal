# NeuroSync – backend-integrated

NeuroSync is an AI-powered inclusive-education and web-accessibility platform. A dataset-based assessment produces a **Recommended Assistance Level** and a personalised set of reading settings, which a Chrome extension applies to any website.

> **Not a diagnostic tool.** Scores are a project heuristic for choosing comfortable reading settings. They are not clinically validated and do not diagnose dyslexia or any other condition.

This version takes **your supplied frontend design** (six pages: Landing, Assessment, Assessment Results, Dashboard, Accessibility Settings / "Reading Studio", AI Tools / "Reading Intelligence") as the visual source of truth and builds a real backend around it.

## Contents

[Existing frontend integration](#existing-frontend-integration) · [Architecture](#architecture) · [API reference](#api-reference) · [Datasets](#dataset-integration) · [Gemini](#gemini-configuration) · [Environment variables](#environment-variables) · [Authentication](#authentication) · [Assessment engine](#assessment-engine) · [Personalization](#personalization) · [Accessibility settings](#accessibility-settings) · [AI tools](#ai-tools) · [Evaluation](#evaluation) · [Chrome extension](#chrome-extension) · [Installation & running](#installation-and-running) · [Testing](#testing) · [Troubleshooting](#troubleshooting) · [Security](#security) · [Future database integration](#future-database-integration) · [Limitations](#limitations)

## Existing frontend integration

The design files were static, self-contained mock-ups (`*.dc.html`, with the README noting they are reference mock-ups). To make them functional they were **converted to React + Vite while keeping the design itself untouched**:

- `frontend/src/styles/tokens.css` is your `tokens.css`, **byte-for-byte**.
- Each page's own `<style>` block was extracted by script into `styles/pages.generated.css` (scoped per page so the six pages' overlapping class names don't collide). Nothing was restyled by hand.
- Markup and **inline styles were converted mechanically** from the mock-ups (the `s("…")` helper turns the design's inline style strings into React style objects verbatim). The Landing page is the generated conversion with only navigation wired.
- Lexend is bundled locally (the design loaded it from Google Fonts) so the app also works offline.

### Page → API mapping

| Page (route) | Backend calls | Auth |
| --- | --- | --- |
| Landing `/` | none (navigation to `/signup`, `/login`) | no |
| Login / Signup `/login` `/signup` | `POST /api/auth/login` · `POST /api/auth/signup` | no |
| Assessment `/assessment` | `GET /api/assessment/questions` (resume + Previous via `cursor`) · `POST /api/assessment/start` (retake) · `POST /api/assessment/answer` · `POST /api/assessment/submit` | yes |
| Results `/results` | `GET /api/assessment/results` · `POST /api/accessibility/reset {to:"recommended"}` ("Apply Recommended Settings") | yes |
| Dashboard `/dashboard` | `GET /api/dashboard` · `PUT /api/accessibility/profile` (Quick Controls) · `POST /api/extension/pairing-code` · `POST /api/extension/disconnect` | yes |
| Reading Studio `/accessibility` | `GET/PUT /api/accessibility/profile` (auto-save) · `POST /api/accessibility/reset` (both reset buttons) | yes |
| Reading Intelligence `/ai-tools` | `POST /api/simplify` · `/api/summarize` · `/api/word-assistance` | yes (UI) |
| Profile `/profile`, Settings `/settings` | `GET/PUT/DELETE /api/profile` · `PUT /api/evaluation/consent` · `POST /api/evaluation` · `GET /api/evaluation/export` · `GET /api/health` | yes |

### Where the design was extended (and why)

The design set did not include everything the product needs. These are the only additions, built from the design's own tokens/classes:

1. **Login / Signup pages** – no auth screens existed. Built from `.ns-card`, `.ns-field`, `.ns-btn`, `.ns-logo`, `.ns-link` in `tokens.css`.
2. **Profile and Settings pages** – the Dashboard sidebar links to them. Composed from the Dashboard's `.c` cards and token form controls. Settings holds: assessment difficulty (LOW / MEDIUM / HIGH / adaptive), the research-consent switch + optional anonymous feedback, AI/backend status, account deletion.
3. **Sidebar on Reading Studio / Reading Intelligence** – the mock-ups show these without the sidebar, but the Dashboard sidebar lists them; they render inside the same sidebar shell so navigation works. On phones the sidebar becomes a scrolling row (the mock hides it entirely, which would remove navigation).
4. **OpenDyslexic** added to the Font select – required by Level 3 of the personalization spec.
5. **Small data-driven additions inside existing screens:** "Welcome back, *name*"; dataset category and answer-option rendering in the assessment card; the extension card's *Get pairing code* link; an auto-save status line under the Reading Studio buttons; category performance and answer explanations on Results.
6. **Dashboard / Results states** the mock-ups don't show (in progress, completed, highlighted level) reuse the design's own colours.

## Architecture

```text
NeuroSync/
├── frontend/      React + Vite app (port 5173)  – the supplied design, wired to the API
├── backend/       Node + Express REST API (port 4000)
│   └── src/ routes · controllers · services · middleware · utils · data · server.js
├── extension/     Chrome Manifest V3 extension + the shared accessibility engine
├── datasets/      supplied neurosync_*.json assessment banks
├── evaluation/    anonymous research notes + analysis script
├── scripts/       verify-extension-vocabulary.mjs (independent local word-help data)
└── tests/e2e/     optional Playwright browser checks
```

- **routes** define endpoints (`routes/index.js` lists them all) · **controllers** handle request/response · **services** hold business logic (assessment, scoring, personalization, settings, AI, evaluation, extension pairing, storage) · **middleware** does auth, validation, rate limiting, errors · **data** holds the dataset adapter, loader and assessment/settings configuration.
- `extension/content/neurosync-engine.js` is framework-free and is imported by the web app (alias `@ext`), so the Reading Studio preview and the browser extension apply settings with identical code. A test asserts the engine's settings schema equals the backend's.

## API reference

All endpoints are under `/api`. JSON in/out. Errors: `{ "error": { "code", "message", "details?" } }` – never stack traces or keys.

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | – | status; whether AI is configured (never the key) |
| `POST /auth/signup` `{name,email,password}` | – | create account → `{token,user}` |
| `POST /auth/login` `{email,password}` | – | → `{token,user}` |
| `POST /auth/logout` | token | revokes the token |
| `GET /profile` · `PUT /profile` `{name?,assessmentMode?}` · `DELETE /profile` `{password}` | user | profile / delete account |
| `GET /dashboard` | user | everything the Dashboard shows |
| `GET /assessment/questions?part=core\|cognitive&cursor=n` | user | current (or earlier) question; creates/resumes the session |
| `POST /assessment/start` `{part,mode?}` | user | new assessment (`mode`: adaptive, low, medium, high) |
| `POST /assessment/answer` `{part,stepId,value?,timeMs?,timedOut?}` | user | save an answer → next question |
| `POST /assessment/submit` `{part}` | user | score + level + recommended profile |
| `GET /assessment/results?part=` | user | latest stored result |
| `GET /accessibility/profile` | user | settings in force, recommendation, defaults |
| `PUT /accessibility/profile` `{settings:{…}}` | user | partial update (validated) |
| `POST /accessibility/reset` `{to:"recommended"\|"default"}` | user | Apply Recommended / Reset to Default |
| `POST /simplify` `{text}` · `POST /summarize` `{text}` | optional | AI (Gemini) |
| `POST /word-assistance` `{word,context?}` | optional | **local vocabulary first**, AI only if unknown |
| `PUT /evaluation/consent` `{consent}` · `POST /evaluation` | user | consent / anonymous feedback record |
| `GET /evaluation` · `GET /evaluation/export` | research admin | statistics / anonymous CSV |
| `POST /extension/pairing-code` | user | one-time code (10 min) |
| `POST /extension/connect` `{code,label?}` | – | exchange code → extension token |
| `GET /extension/status` · `POST /extension/disconnect` | user | connection status / revoke |
| `GET /extension/sync` | user or extension | settings for the extension |

## Dataset integration

The supplied files in `new datasets/` are copied unchanged into `datasets/` and are the authoritative assessment banks. The backend reads only `neurosync_*.json`; legacy assessment files are not loaded as a fallback. See [`datasets/README.md`](datasets/README.md). Their `questions[]` records use option objects (`id`, `text`) and `correctAnswer` option IDs. Startup validation reports exact files and record IDs/rows and fails on malformed data. The answer key and explanations stay server-side until submission.

The five active categories are attention to detail, comprehension, sentence understanding, sequencing, and word recognition. Each assessment samples up to four unique questions per category; difficulty adapts by category. The standalone `extension/data/vocabulary.json` remains a separate word-help resource because the supplied recognition records do not contain definitions.

## Gemini configuration

`backend/.env` (copy `backend/.env.example`):

```dotenv
GEMINI_API_KEY=your_google_ai_studio_api_key
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_BASE_URL=https://generativelanguage.googleapis.com
```

Create a Gemini API key in Google AI Studio and keep it **only** in the backend environment – never in the frontend, extension, browser storage or source control. The backend calls Google's `generateContent` API directly. Without a Gemini key the AI endpoints answer *"AI assistance is temporarily unavailable. Your local accessibility tools are still available."* and everything else works. Live Gemini calls are tested here against mocks only.

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | – | required for AI features; create in Google AI Studio |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Gemini model name |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com` | |
| `GEMINI_TIMEOUT_MS` | `30000` | upstream request timeout |
| `JWT_SECRET` | random per start | **set a long random string** or sign-ins reset on restart |
| `PORT` | `4000` | |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173` | comma-separated; extension origins are allowed |
| `DATASETS_DIR` | `../datasets` | |
| `STORAGE_DIR` | `backend/storage` | JSON-file store (git-ignored) |
| `RESEARCH_ADMIN_EMAILS` | – | who may read research data |
| `AI_RATE_LIMIT` / `AUTH_RATE_LIMIT` | 30 / 20 per minute per IP | |

Frontend: `VITE_API_BASE_URL` (default `http://localhost:4000`) – no secrets.

## Authentication

Email + password (scrypt-hashed, salted). Sessions are standard **HS256 JWTs** signed with `JWT_SECRET` (7 days, revocable on logout). The browser keeps the token in `localStorage`; a 401 anywhere signs the user out. Guest mode is not provided because the supplied design has none (progress, "Save & exit" and the dashboard all need an account). Extension tokens are a separate, limited token type (see below).

## Assessment engine

Server-side sessions, so **Save & exit** resumes exactly where you left, and **Previous** lets you review/change answers.

- **Flow**: up to four multiple-choice questions from each supplied category (20 questions with the current files); no question repeats within an assessment, and options are shuffled.
- **Difficulty**: *Adaptive* starts MEDIUM; two correct in a row within a category → harder, a miss → easier. LOW / MEDIUM / HIGH pin the level (Settings → Question difficulty).
- **`calculateAssessmentScore()` (0–14)**: because the new records contain scored answers but no reading-time or self-report fields, the score is the rounded share of incorrect answers scaled to 14. This deterministic mapping uses only the provided records.
- **Classification**: 0–4 *Basic / Mild* · 5–9 *Moderate* · 10–14 *High / Maximum Assistance* – always called **Recommended Assistance Level**.
- **Optional check** (`part=cognitive`): draws from the same supplied categories, uses the existing timed flow, and reports results separately from the assistance level.

## Personalization

`generateAccessibilityProfile()` maps level → settings (`backend/src/data/settingsSchema.js`):

| Level | Settings |
| --- | --- |
| 1 Mild | light bionic reading, default spacing, reading ruler optional (off) |
| 2 Moderate | Lexend 18px, line 1.9, letter 4, word 3, warm cream + soft yellow tint, bionic optional (off) |
| 3 Maximum | OpenDyslexic 20px, line 2.0, letter 6, word 6, cream + yellow tint, text-to-speech, reader mode, focus mode, reading ruler |

The recommendation is stored after submit but **applied only when the user chooses** (*Apply Recommended Settings*). Manual changes in Reading Studio always override it; *Reset to Recommended* / *Reset to Default* restore either.

## Accessibility settings

Stored per user and validated against the schema (unknown keys, wrong types and out-of-range values are rejected with details): `font` (system, lexend, atkinson, opendyslexic), `fontSize` 14–28, `lineSpacing` 1–2.4, `letterSpacing` 0–10, `wordSpacing` 0–10, `bionicReading`, `readingRuler`, `focusMode`, `readerMode`, `background` (white, cream, gray), `colorTint` (none, yellow, blue), `contrast` (standard, high), `textToSpeech`, `speechSpeed` 0.5–2. Slider units: letter ×0.01em, word ×0.03em; **16px and 1.5× mean "leave the website as it is"** in the extension. The Reading Studio preview applies them with the shared engine; the extension applies them on every site.

## AI tools

- **Simplify** → `{simplified}` · **Summarize** → `{summary, bullets[3–5]}` · **Word assistance** → `{simpleMeaning, synonym, pronunciation, visualHint, source}`.
- Prompts demand: preserve meaning, simpler words, shorter sentences, no new information; text inside the prompt is treated as data (prompt-injection guard).
- Word help is **local first** using the standalone bundled vocabulary resource, instant and offline in the extension. Only unknown words go to Gemini; identical requests are cached on the server and in the browser, concurrent duplicates are de-duplicated, and calls are click-triggered (never on hover).
- All failures (key missing, network, 4xx/5xx, empty or malformed reply) return the friendly message with no secrets or stack traces. AI endpoints are rate-limited per IP.

## Evaluation

Optional and anonymous – see [`evaluation/README.md`](evaluation/README.md). Consent first, records built from stored results on the server, ids `P001, P002…`, CSV export for research admins, real statistics only (`null` when there is no data).

## Chrome extension

See [`extension/README.md`](extension/README.md).

1. `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`.
2. In NeuroSync: **Dashboard → Browser Extension → Get pairing code**.
3. Click the extension icon, enter the code, **Connect**. The dashboard badge turns *Connected*.

The code is one-time and expires in 10 minutes; it is exchanged for a limited-scope token that can only read settings and use AI. It can be revoked from the dashboard. The extension contains no Gemini key, JWT secret or credentials. Settings re-sync when the popup opens and every 15 minutes; popup toggles are local overrides and *Reset Settings* returns to what is saved in NeuroSync. Level 3's reader mode opens automatically only on article-like pages (≥ 250 words).

## Installation and running

Requirements: Node.js 18+, npm, Chrome (for the extension).

```bash
cd NeuroSync
npm run install:all                      # installs backend + frontend

# terminal 1 – backend
cd backend
cp .env.example .env                     # add GEMINI_API_KEY (and JWT_SECRET)
npm start                                # http://localhost:4000

# terminal 2 – frontend
cd frontend
npm run dev                             # http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173) → *Get Started* → create an account → take the assessment. Production build: `cd frontend && npm run build && npm run preview` (port 4173).

## Testing

```bash
npm test            # backend + frontend
```

- **Backend (node:test, real HTTP)**: actual dataset parsing and schema validation; adaptive/fixed difficulty and randomisation; 0–14 scoring and level thresholds; personalization levels; settings validation; full assessment runs (all correct → level 1, all wrong → score 14 / level 3); resume, previous/edit, ordering; **answer key never sent before submission**; explanations after submission; dashboard real-state transitions; settings save/apply/override/reset; separate optional assessment; auth and JWT tampering; AI success, local-first words, caching, validation, **all failure modes leak nothing**, rate limiting; evaluation consent/anonymity/CSV/admin gating; extension pairing, scope and revocation.
- **Frontend (vitest + jsdom)**: the engine (bionic safety and reversibility, fonts, units, colours, ruler, focus, reader mode, TTS), word assistant, selection toolbar, API service (auth header, error mapping, 401 handling), design style conversion, and **schema parity with the backend**.
- **Real-browser checks** (`tests/e2e/`): full user journey and the unpacked extension in Chromium, including pairing and revocation.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "We couldn't reach the NeuroSync server" | start the backend; check `VITE_API_BASE_URL` and that the port is 4000 |
| CORS error in the console | add your frontend origin to `CORS_ORIGINS` |
| "AI assistance is temporarily unavailable" | set `GEMINI_API_KEY`; check `GET /api/health` (`ai.configured`) and confirm `GEMINI_MODEL` is available to your API key |
| Signed out after restarting the backend | set `JWT_SECRET` |
| Start-up reports dataset validation errors | correct the cited source record; the server intentionally does not skip malformed assessment items or load legacy files |
| Extension says the code is invalid | codes are single-use and last 10 minutes – create a new one |
| Extension can't reach the API | backend must be running; non-default host → edit `host_permissions` in `extension/manifest.json` and `DEFAULT_API` in `background.js` |
| Port 5173 in use | Vite is configured with `strictPort`; free the port or change it in `frontend/vite.config.js` **and** `CORS_ORIGINS` |

## Security

Key and JWT secret only in `backend/.env` (git-ignored; `.env.example` has none) · scrypt password hashing · HS256 JWT, expiry + revocation · per-route input validation, 64 KB body limit · CORS allow-list (no wildcard) · rate limiting (AI + auth) · AI output rendered as text (no HTML injection) · prompts treat user text as data · errors never contain stacks or credentials · answer key server-side only · settings and profile endpoints scoped to the signed-in user · extension tokens are limited-scope and revocable · research records are anonymous and consent-gated.

## Future database integration

All persistence goes through `backend/src/services/storage.js` (`users.findById/findByEmail/create/update/remove`, `evaluations.add/list`). The default is a JSON-file store (`backend/storage`, atomic writes). To move to PostgreSQL / MongoDB / Supabase, implement the same two repositories and pass them to `createApp({ storage })` – no controller or service changes are needed. Sessions, pairing codes and token revocation are in-memory today; move them to the database/Redis when running more than one server instance.

## Limitations

Scoring thresholds are heuristics, not validated norms · the supplied task categories and accuracy score do not diagnose dyslexia · JSON-file storage suits a prototype, not production scale · no guest mode (not in the design) · extension targets Chrome (MV3) · fonts are Latin-only · layout-heavy sites may react to font/spacing overrides · Gemini model availability is controlled by Google.
