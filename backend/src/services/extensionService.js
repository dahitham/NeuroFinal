import crypto from 'node:crypto';
import { AppError } from '../utils/AppError.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no look-alike characters
const CODE_TTL_MS = 10 * 60_000;
const EXT_TOKEN_TTL_SEC = 90 * 24 * 3600;

const normalize = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hash = (c) => crypto.createHash('sha256').update(normalize(c)).digest('hex');

/**
 * Extension pairing: the signed-in web app shows a short one-time code; the extension exchanges it for a
 * long-lived, limited-scope token. The extension never receives the user's password, the JWT secret or any AI key.
 */
export function createExtensionService({ storage, tokens, now = () => Date.now() }) {
  const pending = new Map(); // codeHash -> { userId, expires }
  return {
    createPairingCode(user) {
      for (const [k, v] of pending) if (v.expires < now() || v.userId === user.id) pending.delete(k);
      const raw = Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');
      pending.set(hash(raw), { userId: user.id, expires: now() + CODE_TTL_MS });
      return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresInSeconds: CODE_TTL_MS / 1000 };
    },
    connect(code, label) {
      const key = hash(code);
      const entry = pending.get(key);
      pending.delete(key); // one-time use
      if (!entry || entry.expires < now()) throw new AppError(400, 'That pairing code is invalid or has expired. Create a new one in NeuroSync.', 'BAD_CODE');
      const tokenId = crypto.randomBytes(8).toString('hex');
      const user = storage.users.update(entry.userId, (u) => {
        u.extension = { connected: true, connectedAt: new Date(now()).toISOString(), lastSeenAt: null, tokenId, label: String(label || 'Chrome extension').slice(0, 60) };
      });
      if (!user) throw new AppError(400, 'That pairing code is invalid or has expired.', 'BAD_CODE');
      return { token: tokens.issue({ typ: 'ext', sub: user.id, tid: tokenId }, EXT_TOKEN_TTL_SEC), user: { name: user.name } };
    },
    touch(userId) {
      storage.users.update(userId, (u) => {
        u.extension.lastSeenAt = new Date(now()).toISOString();
      });
    },
    disconnect(userId) {
      storage.users.update(userId, (u) => {
        u.extension = { connected: false, connectedAt: null, lastSeenAt: null, tokenId: null, label: null };
      });
    },
    status: (user) => ({ connected: !!user.extension.connected, connectedAt: user.extension.connectedAt, lastSeenAt: user.extension.lastSeenAt, label: user.extension.label }),
  };
}
