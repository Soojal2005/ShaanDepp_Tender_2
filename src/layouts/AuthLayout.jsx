import { Link, Outlet } from 'react-router-dom';
import { Check, Landmark } from 'lucide-react';
import LangPill from '../components/LangPill.jsx';
import { useI18n } from '../i18n/index.jsx';

/** Split sign-in frame: a dark brand panel beside the form (sign-in, forgot/reset password). */
export default function AuthLayout() {
  const { t } = useI18n();
  const brand = (
    <Link to="/" className="gate-brand">
      <span className="gate-brand-icon"><Landmark size={20} /></span>
      <span><h1>{t('brand.name')}</h1><small>{t('site.brand')}</small></span>
    </Link>
  );
  return (
    <div className="gate">
      <aside className="gate-aside">
        {brand}
        <div className="gate-aside-body">
          <h2>{t('auth.asideTitle')}</h2>
          <ul className="gate-aside-points">
            {t('auth.asidePoints').map((p) => <li key={p}><Check size={16} />{p}</li>)}
          </ul>
        </div>
        <p className="gate-aside-foot">{t('auth.trust')}</p>
      </aside>

      <main className="gate-main">
        <div className="gate-main-top">
          <div className="gate-main-brand">{brand}</div>
          <LangPill />
        </div>
        <div className="gate-form-wrap"><Outlet /></div>
      </main>
    </div>
  );
}
