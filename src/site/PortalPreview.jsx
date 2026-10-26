import { Bell, BarChart3, ClipboardList, Home, Landmark, Search, Settings, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/index.jsx';

/** A decorative, code-rendered preview; the actual portal opens at sign-in. */
export default function PortalPreview() {
  const { t } = useI18n();
  const items = t('site.home.previewNav');
  const icons = [Home, Search, Bell, ClipboardList, BarChart3, Settings];
  return (
    <Link to="/login" className="portal-device-preview" aria-label={t('site.home.previewLabel')}>
      <div className="preview-orbit" aria-hidden="true" />
      <div className="preview-laptop" aria-hidden="true">
        <div className="preview-screen">
          <aside className="preview-sidebar"><b><Landmark size={12} /> Shan-Deep</b>{items.map((item, i) => { const Icon = icons[i]; return <span key={item}><Icon size={9} />{item}</span>; })}</aside>
          <div className="preview-main"><div className="preview-topbar">Shan-Deep <span>● EN</span></div><div className="preview-page"><h4>{t('site.home.previewTitle')}</h4><div className="preview-search"><Search size={8} />{t('site.home.previewSearch')}</div><div className="preview-table"><div className="preview-table-head"><span>{t('site.home.previewTender')}</span><span>{t('site.home.previewDepartment')}</span><span>{t('site.sampleDeadline')}</span></div>{t('site.home.samples').concat(t('site.home.samples')).map((item, i) => <div key={i}><span>{item.title}</span><span>{item.department}</span><span className="preview-status">{t('site.home.previewOpen')}</span></div>)}</div></div></div>
        </div>
        <div className="preview-laptop-base" />
      </div>
      <div className="preview-phone" aria-hidden="true"><div className="preview-phone-speaker" /><div className="preview-phone-top"><Landmark size={10} />Shan-Deep</div>{items.map((item, i) => { const Icon = icons[i]; return <div className="preview-phone-item" key={item}><Icon size={12} />{item}</div>; })}<div className="preview-phone-card"><ShieldCheck size={19} /><span>{t('site.home.previewReady')}</span></div><div className="preview-phone-bottom" /></div>
    </Link>
  );
}
