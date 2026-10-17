import { AppError } from '../utils/AppError.js';
import { hashPassword, verifyPassword } from '../services/passwords.js';
import { bearer } from '../middleware/auth.js';

const TTL_SEC = 7 * 24 * 3600;
export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

export function createAuthController({ storage, tokens }) {
  const session = (user, status = 200) => (res) =>
    res.status(status).json({ token: tokens.issue({ typ: 'user', sub: user.id }, TTL_SEC), user: publicUser(user), expiresInSeconds: TTL_SEC });
  return {
    signup(req, res) {
      const { name, email, password } = req.valid;
      if (storage.users.findByEmail(email)) throw new AppError(409, 'An account with this email already exists. Try logging in.', 'EMAIL_TAKEN');
      const user = storage.users.create({ name, email, passwordHash: hashPassword(password) });
      session(user, 201)(res);
    },
    login(req, res) {
      const { email, password } = req.valid;
      const user = storage.users.findByEmail(email);
      if (!user || !verifyPassword(password, user.passwordHash)) throw new AppError(401, 'Email or password is incorrect.', 'BAD_CREDENTIALS');
      session(user)(res);
    },
    logout(req, res) {
      const t = bearer(req);
      if (t) tokens.revoke(t);
      res.json({ ok: true });
    },
  };
}
