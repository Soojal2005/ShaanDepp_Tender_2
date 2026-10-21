import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAnyPermission, RequireAuth, RequirePermission } from './auth/guards.jsx';
import AuthLayout from './layouts/AuthLayout.jsx';
import PortalLayout from './layouts/PortalLayout.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import NotFound from './pages/NotFound.jsx';
import ForgotPassword from './pages/auth/ForgotPassword.jsx';
import Login from './pages/auth/Login.jsx';
import ResetPassword from './pages/auth/ResetPassword.jsx';
import Help from './pages/portal/Help.jsx';
import Profile from './pages/portal/Profile.jsx';
import AuditLog from './pages/admin/AuditLog.jsx';
import Enquiries from './pages/admin/Enquiries.jsx';
import Masters from './pages/admin/Masters.jsx';
import OrganizationDetail from './pages/admin/OrganizationDetail.jsx';
import Organizations from './pages/admin/Organizations.jsx';
import Plans from './pages/admin/Plans.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Route>

      <Route path="/app" element={<RequireAuth><PortalLayout /></RequireAuth>}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<ComingSoon titleKey="nav.dashboard" />} />
        <Route path="search" element={<ComingSoon titleKey="nav.search" />} />
        <Route path="watchlist" element={<ComingSoon titleKey="nav.watchlist" />} />
        <Route path="alerts" element={<ComingSoon titleKey="nav.alerts" />} />
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
  );
}
