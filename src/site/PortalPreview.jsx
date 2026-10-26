import { BarChart3, Bell, ClipboardCheck, LayoutDashboard, Landmark, Search, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/index.jsx';

const NAV_ICONS = [LayoutDashboard, Search, Bell, ClipboardCheck, BarChart3, Settings];
const ROW_DATES = ['10 Oct', '02 Nov', '21 Nov'];
const ROW_STATUS = ['open', 'soon', 'new'];

/** A decorative but readable "app window" preview of the portal. The real portal opens at sign-in. */
export default function PortalPreview() {
  const { t } = useI18n();
  const nav = t('site.home.previewNav');
  const status = t('site.lp.portalStatus');
  const rows = t('site.lp.samples').slice(0, 3).map((s, i) => ({
    title: s.title, dept: s.department, date: ROW_DATES[i], status: ROW_STATUS[i], label: status[i],
  }));

  return (
    <Link to="/login" className="lp-app" aria-label={t('site.home.previewLabel')}>
      <div className="lp-app-bar" aria-hidden="true">
        <span className="lp-app-dots"><i /><i /><i /></span>
        <span className="lp-app-title"><Landmark size={14} />{t('brand.name')} · {t('site.nav.portal')}</span>
        <span className="lp-app-live">Live</span>
      </div>
      <div className="lp-app-body" aria-hidden="true">
        <aside className="lp-app-nav">
          <span className="lp-app-brand"><Landmark size={14} />{t('brand.name')}</span>
          {nav.map((item, i) => { const Icon = NAV_ICONS[i]; return (
            <span key={item} className={`lp-app-link ${i === 0 ? 'on' : ''}`}><Icon size={14} />{item}</span>
          ); })}
        </aside>
        <div className="lp-app-main">
          <div className="lp-app-head">
            <h4>{t('site.home.previewTitle')}</h4>
            <span className="lp-app-search"><Search size={13} />{t('site.home.previewSearch')}</span>
          </div>
          <div className="lp-app-table">
            <div className="lp-app-row lp-app-row-head">
              <span>{t('site.home.previewTender')}</span>
              <span className="lp-app-c-dept">{t('site.home.previewDepartment')}</span>
              <span className="lp-app-c-date">{t('site.lp.deadline')}</span>
              <span>{t('site.lp.statusCol')}</span>
            </div>
            {rows.map((r) => (
              <div className="lp-app-row" key={r.title}>
                <span className="lp-app-cell">{r.title.replace(/^\[sample\]\s*/i, '')}</span>
                <span className="lp-app-cell lp-app-c-dept">{r.dept}</span>
                <span className="lp-app-c-date">{r.date}</span>
                <span className={`lp-app-status lp-app-status-${r.status}`}>{r.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}
