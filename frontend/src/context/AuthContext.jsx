import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from '../services/api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(tokenStore.get() ? 'loading' : 'anon'); // loading | authed | anon

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      setStatus('anon');
      return;
    }
    try {
      const p = await api.profile.get();
      setUser(p.user);
      setStatus('authed');
    } catch (e) {
      if (e.status === 401) {
        tokenStore.clear();
        setUser(null);
        setStatus('anon');
      } else {
        setStatus((s) => (s === 'loading' ? 'offline' : s)); // backend unreachable
      }
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUnauthorized = () => {
      tokenStore.clear();
      setUser(null);
      setStatus('anon');
    };
    window.addEventListener('neurosync:unauthorized', onUnauthorized);
    return () => window.removeEventListener('neurosync:unauthorized', onUnauthorized);
  }, [refresh]);

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: status === 'authed',
      refresh,
      async signup(name, email, password) {
        const r = await api.signup(name, email, password);
        tokenStore.set(r.token);
        setUser(r.user);
        setStatus('authed');
      },
      async login(email, password) {
        const r = await api.login(email, password);
        tokenStore.set(r.token);
        setUser(r.user);
        setStatus('authed');
      },
      async logout() {
        await api.logout();
        tokenStore.clear();
        setUser(null);
        setStatus('anon');
      },
      setUserName: (name) => setUser((u) => (u ? { ...u, name } : u)),
    }),
    [user, status, refresh]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
