# End-to-end browser checks (optional)

These drive a real Chromium with Playwright against a running backend (`:4000`) and frontend (`:5173`).
They are the checks used while building the project; they are **not** needed to run NeuroSync.

```bash
pip install playwright && playwright install chromium
# terminal 1: cd backend && STORAGE_DIR=/tmp/ns-e2e npm start
# terminal 2: cd frontend && npm run dev
python tests/e2e/app_flow.py          # signup → assessment (Previous, Save & exit, resume) → results → apply → dashboard
                                      #   → Reading Studio (save/reload/reset) → AI tools → settings → logout/login → mobile
python tests/e2e/extension_flow.py    # needs a test site on :8000 (python -m http.server 8000 in a folder with an article page);
                                      #   loads extension/ in Chromium: pairing code → connect → settings applied → revoke
```
`app_flow.py` creates `dahi@example.com`; delete `backend/storage` (or use a fresh `STORAGE_DIR`) before re-running.
