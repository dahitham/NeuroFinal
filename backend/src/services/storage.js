import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Storage abstraction. The rest of the backend only uses this interface:
 *   users.findById / findByEmail / create / update
 *   evaluations.add / list
 * The default implementation is a small JSON-file store (no database needed for a prototype).
 * To move to a real database later, implement the same two repositories and pass them to createApp().
 */
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // atomic replace
}

/** @param {string|null} dir directory for JSON files; null = in-memory only (tests) */
export function createStorage(dir) {
  const persist = !!dir;
  if (persist) fs.mkdirSync(dir, { recursive: true });
  const usersFile = persist ? path.join(dir, 'users.json') : null;
  const evalFile = persist ? path.join(dir, 'evaluations.json') : null;
  const users = persist ? readJson(usersFile, []) : [];
  const evals = persist ? readJson(evalFile, { counter: 0, records: [] }) : { counter: 0, records: [] };
  const saveUsers = () => persist && writeJson(usersFile, users);
  const saveEvals = () => persist && writeJson(evalFile, evals);
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

  return {
    users: {
      findById: (id) => clone(users.find((u) => u.id === id)) || null,
      findByEmail: (email) => clone(users.find((u) => u.email === String(email).toLowerCase())) || null,
      create({ name, email, passwordHash }) {
        const user = {
          id: crypto.randomUUID(),
          name,
          email: email.toLowerCase(),
          passwordHash,
          createdAt: new Date().toISOString(),
          preferences: { assessmentMode: 'adaptive' },
          accessibility: { settings: null, recommended: null, updatedAt: null },
          assessment: { core: { session: null, result: null }, cognitive: { session: null, result: null } },
          research: { consent: null, consentAt: null },
          extension: { connected: false, connectedAt: null, lastSeenAt: null, tokenId: null, label: null },
        };
        users.push(user);
        saveUsers();
        return clone(user);
      },
      /** Applies `mutate(draft)` to the stored user and saves. Returns the updated copy. */
      update(id, mutate) {
        const u = users.find((x) => x.id === id);
        if (!u) return null;
        mutate(u);
        saveUsers();
        return clone(u);
      },
      remove(id) {
        const i = users.findIndex((u) => u.id === id);
        if (i === -1) return false;
        users.splice(i, 1);
        saveUsers();
        return true;
      },
    },
    evaluations: {
      /** `build(participantId)` receives the next anonymous id (P001, P002 …) and returns the record to store. */
      add(build) {
        evals.counter += 1;
        const record = build('P' + String(evals.counter).padStart(3, '0'));
        evals.records.push(record);
        saveEvals();
        return clone(record);
      },
      list: () => clone(evals.records),
      hasSession: (sessionId) => evals.records.some((r) => r.Session_ID === sessionId),
    },
  };
}
