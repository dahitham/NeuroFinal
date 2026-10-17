# NeuroSync Chrome Extension (Manifest V3)

Applies your NeuroSync reading settings (the ones you set in **Reading Studio**) to any website.

## Install (developer mode)

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and choose this `extension/` folder.
2. Start the backend and frontend (see the root README) and sign in to NeuroSync.
3. In NeuroSync open **Dashboard → Browser Extension → Get pairing code**.
4. Click the NeuroSync toolbar icon, enter the code and press **Connect**. The dashboard badge changes to *Connected*.

## How the connection works (no secrets in the extension)

- The web app asks the backend for a **one-time pairing code** (valid 10 minutes, single use).
- The extension exchanges it for a **limited-scope extension token** (`POST /api/extension/connect`). That token can only (a) read the user's settings (`GET /api/extension/sync`) and (b) call the AI endpoints. It cannot read the profile, assessment results or change settings, and it can be revoked at any time (Disconnect in NeuroSync, or the popup).
- Settings are re-synced when the popup opens and every 15 minutes. Quick toggles in the popup are **local overrides**; **Reset Settings** returns to what is saved in NeuroSync.
- AI requests: page → content script → background worker → NeuroSync backend → Gemini. The extension contains **no** Gemini key, JWT secret or database credential.

## Different backend / port

Edit `manifest.json › host_permissions` and the default `DEFAULT_API` in `background.js` (or paste another API base into storage key `ns_api`).

## Files

`content/neurosync-engine.js` (shared accessibility engine) · `content/neurosync-selection.js` (Simplify / Summarize / Explain Word toolbar) · `content/content.js` · `background.js` · `popup/` · `data/vocabulary.json` (generated from `datasets/Word_Difficulty_Test.json`) · `assets/fonts/` (Lexend, Atkinson Hyperlegible, OpenDyslexic – bundled, work offline).

Extensions cannot modify `chrome://` pages or the Chrome Web Store.
