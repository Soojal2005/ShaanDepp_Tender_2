import { BarChart3, Bell, ClipboardCheck, LayoutDashboard, Search, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/index.jsx';

const NAV_ICONS = [LayoutDashboard, Search, Bell, ClipboardCheck, BarChart3, Settings];
const ROW_DATES = ['10 Oct', '02 Nov', '21 Nov'];
const ROW_STATUS = ['open', 'soon', 'new'];

/**
 * A readable "workspace" preview of the portal: teal sidebar, latest tenders on ivory. `active` is the
 * sidebar item to highlight (the feature the visitor picked). The real portal opens at sign-in.
 */
export default function PortalPreview({ active = 0 }) {
  const { t } = useI18n();
  const nav = t('site.home.previewNav');
  const status = t('site.lp.portalStatus');
  const rows = t('site.lp.samples').slice(0, 3).map((s, i) => ({
    title: s.title.replace(/^\[sample\]\s*/i, ''), dept: s.department, date: ROW_DATES[i], status: ROW_STATUS[i], label: status[i],
  }));

  return (
    <Link to="/login" className="ws-card" aria-label={t('site.home.previewLabel')}>
      <div className="ws-card-head" aria-hidden="true">
        <b>{t('brand.name')} · {t('site.nav.portal')}</b>
        <span className="ws-live">{t('site.lp.live')}</span>
      </div>
      <div className="ws-app" aria-hidden="true">
        <aside className="ws-nav">
          {nav.map((item, i) => { const Icon = NAV_ICONS[i]; return (
            <span key={item} className={i === active ? 'is-on' : undefined}><Icon size={18} strokeWidth={1.7} />{item}</span>
          ); })}
        </aside>
        <div className="ws-main">
          <div className="ws-main-head">
            <h4>{t('site.home.previewTitle')}</h4>
            <span className="ws-search"><Search size={14} />{t('site.home.previewSearch')}</span>
          </div>
          <div className="ws-table">
            <div className="ws-row ws-row-head">
              <span>{t('site.home.previewTender')}</span>
              <span className="ws-c-dept">{t('site.home.previewDepartment')}</span>
              <span>{t('site.lp.deadline')}</span>
              <span>{t('site.lp.statusCol')}</span>
            </div>
            {rows.map((r) => (
              <div className="ws-row" key={r.title}>
                <span className="ws-cell">{r.title}</span>
                <span className="ws-cell ws-c-dept">{r.dept}</span>
                <span>{r.date}</span>
                <span className={`ws-status ws-status-${r.status}`}>{r.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}
