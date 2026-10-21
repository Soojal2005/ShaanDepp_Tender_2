import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAnyPermission, RequireAuth, RequirePermission } from './auth/guards.jsx';
import { Loading } from './components/ui.jsx';
import AuthLayout from './layouts/AuthLayout.jsx';
import PortalLayout from './layouts/PortalLayout.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import NotFound from './pages/NotFound.jsx';
import ForgotPassword from './pages/auth/ForgotPassword.jsx';
import Login from './pages/auth/Login.jsx';
import ResetPassword from './pages/auth/ResetPassword.jsx';
import Help from './pages/portal/Help.jsx';
import Profile from './pages/portal/Profile.jsx';

// Heavier screens (charts, tables, admin) load on demand so the sign-in page stays light.
const Dashboard = lazy(() => import('./pages/portal/Dashboard.jsx'));
const Search = lazy(() => import('./pages/portal/Search.jsx'));
const Watchlist = lazy(() => import('./pages/portal/Watchlist.jsx'));
const Organizations = lazy(() => import('./pages/admin/Organizations.jsx'));
const OrganizationDetail = lazy(() => import('./pages/admin/OrganizationDetail.jsx'));
const Plans = lazy(() => import('./pages/admin/Plans.jsx'));
const Masters = lazy(() => import('./pages/admin/Masters.jsx'));
const Ingestion = lazy(() => import('./pages/admin/Ingestion.jsx'));
const MailQueue = lazy(() => import('./pages/admin/MailQueue.jsx'));
const Jobs = lazy(() => import('./pages/admin/Jobs.jsx'));
const Alerts = lazy(() => import('./pages/portal/Alerts.jsx'));
const Enquiries = lazy(() => import('./pages/admin/Enquiries.jsx'));
const AuditLog = lazy(() => import('./pages/admin/AuditLog.jsx'));

export default function App() {
  return (
    <Suspense fallback={<div style={{ padding: 60 }}><Loading /></div>}>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
        </Route>

        <Route path="/app" element={<RequireAuth><PortalLayout /></RequireAuth>}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="search" element={<Search />} />
          <Route path="watchlist" element={<Watchlist />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="desk" element={<ComingSoon titleKey="nav.desk" />} />
          <Route path="reports" element={<ComingSoon titleKey="nav.reports" />} />
          <Route path="profile" element={<Profile />} />
          <Route path="help" element={<Help />} />

          <Route path="admin">
            <Route element={<RequirePermission permission="orgs:manage" />}>
              <Route path="organizations" element={<Organizations />} />
              <Route path="organizations/:orgId" element={<OrganizationDetail />} />
            </Route>
            <Route element={<RequirePermission permission="plans:manage" />}>
              <Route path="plans" element={<Plans />} />
            </Route>
            <Route element={<RequirePermission permission="masters:manage" />}>
              <Route path="masters" element={<Masters />} />
            </Route>
            <Route element={<RequirePermission permission="ingestion:manage" />}>
              <Route path="ingestion" element={<Ingestion />} />
            </Route>
            <Route element={<RequirePermission permission="queue:manage" />}>
              <Route path="mail" element={<MailQueue />} />
            </Route>
            <Route element={<RequirePermission permission="jobs:manage" />}>
              <Route path="jobs" element={<Jobs />} />
            </Route>
            <Route element={<RequireAnyPermission permissions={['enquiries:view']} />}>
              <Route path="enquiries" element={<Enquiries />} />
            </Route>
            <Route element={<RequirePermission permission="audit:view" />}>
              <Route path="audit" element={<AuditLog />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>

        {/* The public company website takes over "/" in a later step. */}
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
