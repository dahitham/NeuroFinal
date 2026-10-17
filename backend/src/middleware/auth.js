import { AppError } from '../utils/AppError.js';

export const bearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

/**
 * Authentication middleware.
 *  optional      – attaches req.user when a valid user OR extension token is sent (AI endpoints work for both)
 *  required      – signed-in browser session only
 *  requiredAny   – browser session OR paired extension (read-only sync endpoint)
 */
export function createAuth({ tokens, storage }) {
  function resolve(req) {
    const token = bearer(req);
    const data = token && tokens.verify(token);
    if (!data) return null;
    const user = storage.users.findById(data.sub);
    if (!user) return null;
    if (data.typ === 'ext') {
      if (!user.extension.connected || user.extension.tokenId !== data.tid) return null; // disconnected / replaced
      return { user, typ: 'ext' };
    }
    return data.typ === 'user' ? { user, typ: 'user' } : null;
  }
  const attach = (req, found) => {
    req.user = found ? found.user : null;
    req.authType = found ? found.typ : null;
  };
  const deny = () => new AppError(401, 'Please sign in again to continue.', 'UNAUTHENTICATED');
  return {
    optional(req, _res, next) {
      attach(req, resolve(req));
      next();
    },
    required(req, _res, next) {
      const f = resolve(req);
      if (!f || f.typ !== 'user') return next(deny());
      attach(req, f);
      next();
    },
    requiredAny(req, _res, next) {
      const f = resolve(req);
      if (!f) return next(deny());
      attach(req, f);
      next();
    },
  };
}
