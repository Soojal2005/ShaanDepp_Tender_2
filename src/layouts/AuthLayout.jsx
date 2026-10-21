import { Link, Outlet } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import LangPill from '../components/LangPill.jsx';
import { useI18n } from '../i18n/index.jsx';

/** Dark full-page frame used by sign-in, forgot-password and reset-password. */
export default function AuthLayout() {
  const { t } = useI18n();
  return (
    <div className="gate">
      <div className="gate-top">
        <Link to="/" className="gate-brand">
          <span className="gate-brand-icon"><Landmark size={20} /></span>
          <span>
            <h1>{t('brand.name')}</h1>
            <span>{t('brand.domain')} · {t('brand.subtitle')}</span>
          </span>
        </Link>
        <LangPill />
      </div>
      <Outlet />
      <p className="gate-trust">{t('auth.trust')}</p>
    </div>
  );
}
