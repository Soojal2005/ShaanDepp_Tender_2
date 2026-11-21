import { Link, Outlet } from 'react-router-dom';
import LangPill from '../components/LangPill.jsx';
import { useI18n } from '../i18n/index.jsx';

/** Split sign-in frame: the engraved Parliament with the wordmark beside an ivory form panel (sign-in, forgot/reset password). */
export default function AuthLayout() {
  const { t } = useI18n();
  return (
    <div className="gate">
      <aside className="gate-aside">
        <Link to="/" className="gate-mark">
          <b>{t('brand.name')}</b>
          <span>{t('site.lp.footerSub')}</span>
        </Link>
      </aside>

      <main className="gate-main">
        <div className="gate-main-top">
          <Link to="/" className="gate-mark gate-mark-sm"><b>{t('brand.name')}</b></Link>
          <LangPill />
        </div>
        <div className="gate-form-wrap"><Outlet /></div>
      </main>
    </div>
  );
}
