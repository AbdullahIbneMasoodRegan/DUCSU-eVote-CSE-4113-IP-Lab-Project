// M1 — frontend auth (frozen signatures):
//
//   const { user, role, login, logout } = useAuth();
//   <RequireRole roles={['ec']}>...</RequireRole>
//
// user is the object from GET /api/me, or null when logged out.
// role is 'ec' | 'observer' | 'voter' | 'candidate' | null.
// login(user) stores the user returned by a login endpoint.
// logout() ends the session on the server and clears local state.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, onUnauthorized } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Set when the server says the session timed out, so the login page can explain why.
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/me')
      .then((d) => !cancelled && setUser(d.user))
      .catch(() => !cancelled && setUser(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const userRef = useRef(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    onUnauthorized((err) => {
      if (userRef.current && err.code === 'SESSION_EXPIRED') setExpired(true);
      setUser(null);
    });
    return () => onUnauthorized(null);
  }, []);

  const login = useCallback((u) => {
    setExpired(false);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    const d = await api.get('/me');
    setUser(d.user);
    return d.user;
  }, []);

  const value = useMemo(
    () => ({ user, role: user?.role ?? null, loading, expired, login, logout, refresh }),
    [user, loading, expired, login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Where each role lands after login. */
export function homeFor(role) {
  if (role === 'ec') return '/admin';
  if (role === 'observer') return '/observer';
  return '/voter';
}

/** Does `role` satisfy `roles`? Candidates are voters, so 'voter' admits them. */
export function hasRole(role, roles) {
  if (!role) return false;
  if (roles.includes(role)) return true;
  return role === 'candidate' && roles.includes('voter');
}

export function RequireRole({ roles, children }) {
  const { user, role, loading } = useAuth();
  const location = useLocation();
  const { t } = useTranslation('common');

  if (loading) {
    return (
      <p className="py-16 text-center text-slate-600" role="status">
        {t('loading')}
      </p>
    );
  }
  if (!user) {
    const staffOnly = roles.every((r) => r === 'ec' || r === 'observer');
    return <Navigate to={staffOnly ? '/admin/login' : '/login'} replace state={{ from: location }} />;
  }
  if (!hasRole(role, roles)) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">{t('forbidden.title')}</h1>
        <p className="mt-2 text-slate-600">{t('forbidden.body')}</p>
      </div>
    );
  }
  return children;
}
