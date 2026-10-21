import { api } from '../lib/api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';

/** EN / HI switch. Remembered in the browser and, when signed in, on the user's profile. */
export default function LangPill() {
  const { lang, setLang } = useI18n();
  const { status } = useAuth();

  const choose = (next) => {
    if (next === lang) return;
    setLang(next);
    if (status === 'authenticated') api.patch('/auth/me', { language: next }).catch(() => {});
  };

  return (
    <div className="lang-pill" role="group" aria-label="Language">
      {['EN', 'HI'].map((code) => (
        <button
          key={code}
          type="button"
          className={`lang-btn ${lang === code ? 'active' : ''}`}
          aria-pressed={lang === code}
          onClick={() => choose(code)}
        >
          {code === 'EN' ? 'EN' : 'हिं'}
        </button>
      ))}
    </div>
  );
}
