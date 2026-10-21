import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loading, ErrorNote, Empty } from '../components/ui.jsx';
import { can, useAuth } from './AuthContext.jsx';

/** Wraps routes that need a signed-in user; sends visitors to /login and back again afterwards. */
export function RequireAuth({ children }) {
  const { status, error, expired, signedOut, refresh } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <div style={{ padding: 60 }}><Loading /></div>;
  if (status === 'error') {
    return <div style={{ padding: 40, maxWidth: 520, margin: '0 auto' }}><ErrorNote error={{ message: error }} onRetry={refresh} /></div>;
  }
  if (status === 'anonymous') {
    return (
      <Navigate
        to="/login"
        replace
        state={signedOut ? undefined : { from: location.pathname + location.search, expired }}
      />
    );
  }
  return children;
}

/** Route-level permission check. The server enforces the same rule; this only avoids dead-end screens. */
export function RequirePermission({ permission }) {
  const { user } = useAuth();
  if (!can(user, permission)) {
    return <Empty title="You do not have access to this page">Ask a platform administrator if you need it.</Empty>;
  }
  return <Outlet />;
}

export function RequireAnyPermission({ permissions }) {
  const { user } = useAuth();
  if (!permissions.some((p) => can(user, p))) {
    return <Empty title="You do not have access to this page">Ask a platform administrator if you need it.</Empty>;
  }
  return <Outlet />;
}
