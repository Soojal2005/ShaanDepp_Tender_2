import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, Bookmark, Building2, ChevronDown, ClipboardCheck, Database, FileBarChart, Globe, Inbox, Landmark,
  LayoutDashboard, LifeBuoy, ListChecks, LogOut, Mail, Menu, Timer, Search, SlidersHorizontal, UserPlus, Users, ScrollText, Layers, Trophy,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { can, useAuth } from '../auth/AuthContext.jsx';
import LangPill from '../components/LangPill.jsx';
import { useI18n } from '../i18n/index.jsx';
import { formatNumber, initials } from '../lib/format.js';

const MAIN_NAV = [
  { to: '/app/dashboard', key: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/app/search', key: 'nav.search', icon: Search },
  { to: '/app/watchlist', key: 'nav.watchlist', icon: Bookmark },
  { to: '/app/alerts', key: 'nav.alerts', icon: Bell },
  { to: '/app/results', key: 'nav.results', icon: Trophy },
  { to: '/app/desk', key: 'nav.desk', icon: ClipboardCheck },
  { to: '/app/reports', key: 'nav.reports', icon: FileBarChart },
];

const ADMIN_NAV = [
  { to: '/app/admin/organizations', label: 'nav.organizations', icon: Building2, permission: 'orgs:manage' },
  { to: '/app/admin/plans', label: 'nav.plans', icon: Layers, permission: 'plans:manage' },
  { to: '/app/admin/masters', label: 'nav.masters', icon: ListChecks, permission: 'masters:manage' },
  { to: '/app/admin/ingestion', label: 'nav.ingestion', icon: Database, permission: 'ingestion:manage' },
  { to: '/app/admin/mail', label: 'nav.mail', icon: Mail, permission: 'queue:manage' },
  { to: '/app/admin/jobs', label: 'nav.jobs', icon: Timer, permission: 'jobs:manage' },
  { to: '/app/admin/reports', label: 'nav.weeklyReports', icon: FileBarChart, permission: 'reports:release' },
  { to: '/app/admin/access-requests', label: 'nav.accessRequests', icon: UserPlus, permission: 'enquiries:view', badge: 'newAccessRequests' },
  { to: '/app/admin/enquiries', label: 'nav.enquiries', icon: Inbox, permission: 'enquiries:view', badge: 'newGeneral' },
  { to: '/app/admin/audit', label: 'nav.audit', icon: ScrollText, permission: 'audit:view' },
];

function NavItem({ to, icon: Icon, children, onNavigate, badge }) {
  return (
    <NavLink to={to} onClick={onNavigate} className={({ isActive }) => `sidebar-link-btn ${isActive ? 'active' : ''}`}>
      <div className="sidebar-link-left">
        <Icon size={17} />
        <span>{children}</span>
      </div>
      {badge > 0 && <span className="sidebar-item-badge" aria-label={`${badge} new`}>{badge}</span>}
    </NavLink>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button type="button" className="top-user-pill" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <div className="user-avatar-navy" style={user.isStaff ? { background: '#B45309' } : undefined}>{initials(user.name)}</div>
        <div className="user-text-meta">
          <b>{user.name}</b>
          <span>{user.isStaff ? t(`roles.${user.role}`) : user.orgName}</span>
        </div>
        <ChevronDown size={14} style={{ color: '#94A3B8' }} />
      </button>
      {open && (
        <div className="user-menu" role="menu">
          <div className="user-menu-head">
            <div className="user-avatar-navy">{initials(user.name)}</div>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--slate-900)' }}>{user.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--slate-500)' }}>{user.email}</div>
              <div style={{ fontSize: 11, color: '#0066FF', fontWeight: 600 }}>{t(`roles.${user.role}`)}</div>
            </div>
          </div>
          <Link to="/app/profile" role="menuitem" onClick={() => setOpen(false)}><Users size={14} />{t('nav.profile')}</Link>
          <button type="button" role="menuitem" className="danger" onClick={logout}><LogOut size={14} />{t('nav.signOut')}</button>
        </div>
      )}
    </div>
  );
}

function PlanCard() {
  const { organization, user } = useAuth();
  const { t, lang } = useI18n();
  if (user.isStaff || !organization) return null;
  const { plan, alertCap, seatsUsed, seatLimit } = organization;
  return (
    <div className="standard-plan-card">
      <div className="plan-card-header">
        <span className="plan-title">{plan ? plan.name : t('profile.noPlan')}</span>
        <span className="plan-active-badge">{organization.status}</span>
      </div>
      {plan && <p className="plan-info-line">{t('profile.perDay', { n: formatNumber(alertCap, lang) })}</p>}
      <div className="plan-progress-wrapper">
        <div className="plan-progress-track">
          <div className="plan-progress-fill" style={{ width: `${Math.min(100, (seatsUsed / Math.max(1, seatLimit)) * 100)}%` }} />
        </div>
        <span className="plan-progress-label tabular-nums">{t('profile.loginsUsed', { used: seatsUsed, limit: seatLimit })}</span>
      </div>
      <Link to="/app/profile" className="plan-link-btn">{t('nav.profile')}</Link>
    </div>
  );
}

export default function PortalLayout() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const adminLinks = ADMIN_NAV.filter((item) => can(user, item.permission));
  const closeMenu = () => setMenuOpen(false);

  // New items waiting in the staff inboxes. Refreshed on navigation and once a minute; a failed fetch just hides the badges.
  const [inboxCounts, setInboxCounts] = useState({});
  const watchesInbox = can(user, 'enquiries:view');
  useEffect(() => {
    if (!watchesInbox) return undefined;
    let active = true;
    const load = () => api.get('/admin/enquiries/summary').then((c) => { if (active) setInboxCounts(c); }).catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [watchesInbox, location.pathname]);

  const submitSearch = (e) => {
    e.preventDefault();
    navigate(query.trim() ? `/app/search?q=${encodeURIComponent(query.trim())}` : '/app/search');
  };

  return (
    <div className="app-container">
      <header className="top-navbar">
        <button type="button" className="nav-toggle" aria-label={t('nav.menu')} onClick={() => setMenuOpen(true)}>
          <Menu size={20} />
        </button>
        <Link to="/app" className="top-brand" style={{ textDecoration: 'none' }}>
          <div className="brand-icon-box"><Landmark size={22} /></div>
          <div className="brand-titles">
            <h1>{t('brand.name')}</h1>
            <span>{t('brand.subtitle')}</span>
          </div>
        </Link>

        <form className="top-search-area" onSubmit={submitSearch} role="search">
          <div className="search-input-wrapper">
            <Search size={16} className="search-icon-left" />
            <input
              type="search"
              className="global-header-input"
              placeholder={t('nav.searchPlaceholder')}
              aria-label={t('nav.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="search-submit-btn" aria-label={t('common.search')}><Search size={15} /></button>
          </div>
          <Link to="/app/search" className="advanced-search-btn" style={{ textDecoration: 'none' }}>
            <SlidersHorizontal size={15} style={{ color: '#0066FF' }} />
            <span>{t('nav.advanced')}</span>
          </Link>
        </form>

        <div className="top-controls">
          <LangPill />
          <UserMenu />
        </div>
      </header>

      <div className="main-layout-shell">
        <div className={`sidebar-scrim ${menuOpen ? 'open' : ''}`} onClick={closeMenu} aria-hidden="true" />
        <aside className={`dark-navy-sidebar ${menuOpen ? 'open' : ''}`}>
          <nav className="sidebar-nav-list" aria-label="Main">
            {MAIN_NAV.map((item) => (
              <NavItem key={item.to} to={item.to} icon={item.icon} onNavigate={closeMenu}>{t(item.key)}</NavItem>
            ))}

            {adminLinks.length > 0 && (
              <>
                <div className="sidebar-nav-divider" />
                <div className="sidebar-section">{t('nav.admin')}</div>
                {adminLinks.map((item) => (
                  <NavItem key={item.to} to={item.to} icon={item.icon} onNavigate={closeMenu} badge={inboxCounts[item.badge]}>{t(item.label)}</NavItem>
                ))}
              </>
            )}

            <div className="sidebar-nav-divider" />
            <NavItem to="/app/profile" icon={Users} onNavigate={closeMenu}>{t('nav.profile')}</NavItem>
            <NavItem to="/app/help" icon={LifeBuoy} onNavigate={closeMenu}>{t('nav.help')}</NavItem>
            <a href="/" className="sidebar-link-btn">
              <div className="sidebar-link-left"><Globe size={17} /><span>{t('nav.website')}</span></div>
            </a>
          </nav>
          <div className="sidebar-bottom-zone"><PlanCard /></div>
        </aside>

        <main className="main-content-scrollable" id="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
