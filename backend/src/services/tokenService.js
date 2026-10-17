import crypto from 'node:crypto';

const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/**
 * Standard HS256 JSON Web Tokens implemented with node:crypto (no extra dependency).
 * The signing secret exists only in the backend environment (JWT_SECRET).
 *  - typ "user" : a signed-in browser session
 *  - typ "ext"  : a browser-extension token created by pairing (can read settings + use AI only)
 */
export function createTokenService(secret) {
  const revoked = new Set();
  const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return {
    issue(payload, ttlSec) {
      const now = Math.floor(Date.now() / 1000);
      const body = { ...payload, iat: now, exp: now + ttlSec, jti: crypto.randomBytes(8).toString('hex') };
      const head = enc({ alg: 'HS256', typ: 'JWT' });
      const data = `${head}.${enc(body)}`;
      return `${data}.${sign(data)}`;
    },
    verify(token) {
      if (typeof token !== 'string') return null;
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [h, p, s] = parts;
      const a = Buffer.from(s);
      const b = Buffer.from(sign(`${h}.${p}`));
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
      try {
        if (JSON.parse(Buffer.from(h, 'base64url').toString()).alg !== 'HS256') return null;
        const data = JSON.parse(Buffer.from(p, 'base64url').toString());
        if (!data.exp || data.exp < Date.now() / 1000 || revoked.has(data.jti)) return null;
        return data;
      } catch {
        return null;
      }
    },
    revoke(token) {
      const data = this.verify(token);
      if (data) revoked.add(data.jti);
    },
  };
}
