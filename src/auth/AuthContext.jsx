import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setCsrfToken, setUnauthorizedHandler } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';

const AuthContext = createContext(null);
const ANONYMOUS = { status: 'anonymous', user: null, organization: null, expired: false, signedOut: false };

export function AuthProvider({ children }) {
  const { setLang, hasStoredChoice } = useI18n();
  const [state, setState] = useState({ status: 'loading', user: null, organization: null, expired: false, signedOut: false });

  const apply = useCallback(
    (data) => {
      setCsrfToken(data.csrfToken);
      setState({ status: 'authenticated', user: data.user, organization: data.organization, expired: false, signedOut: false });
      if (!hasStoredChoice) setLang(data.user.language);
    },
    [hasStoredChoice, setLang]
  );

  // `signedOut` marks a deliberate sign-out, so the next person to sign in on this
  // device is not sent to the previous user's last page.
  const clear = useCallback((expired = false, signedOut = false) => {
    setCsrfToken(null);
    setState({ ...ANONYMOUS, expired, signedOut });
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api.get('/auth/me', { silent401: true }));
    } catch (err) {
      if (err.status === 401) clear();
      else setState({ status: 'error', user: null, organization: null, expired: false, error: err.message });
    }
  }, [apply, clear]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Any 401 from a signed-in screen means the session ended server-side.
  useEffect(() => {
    setUnauthorizedHandler(() => clear(true));
    return () => setUnauthorizedHandler(() => {});
  }, [clear]);

  const login = useCallback(
    async (email, password) => {
      await api.post('/auth/login', { email, password }, { silent401: true });
      await refresh();
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* already signed out */
    }
    clear(false, true);
  }, [clear]);

  const value = useMemo(
    () => ({ ...state, login, logout, refresh }),
    [state, login, logout, refresh]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Mirrors the server's permission table for showing/hiding UI; the server still enforces everything. */
const ROLE_PERMISSIONS = {
  'orgs:manage': ['platform_admin'],
  'users:manage': ['platform_admin'],
  'plans:manage': ['platform_admin'],
  'masters:manage': ['platform_admin'],
  'audit:view': ['platform_admin'],
  'enquiries:view': ['platform_admin', 'analyst', 'case_manager'],
  'members:manage': ['tenant_admin'],
};
export const can = (user, permission) => Boolean(user && ROLE_PERMISSIONS[permission]?.includes(user.role));
