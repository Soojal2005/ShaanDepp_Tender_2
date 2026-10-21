import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Mail } from 'lucide-react';
import { ErrorNote, Field } from '../../components/ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';

export default function ForgotPassword() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="gate-card">
      <h2>{t('auth.forgotTitle')}</h2>
      <p className="gate-sub">{t('auth.forgotBody')}</p>
      {sent ? (
        <div className="note note-success" role="status">{t('auth.forgotDone')}</div>
      ) : (
        <>
          <ErrorNote error={error} />
          <form onSubmit={submit} noValidate>
            <Field label={t('auth.email')}>
              {(p) => (
                <input {...p} className="input" type="email" autoComplete="username" required autoFocus
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              )}
            </Field>
            <button type="submit" className="btn btn-primary" disabled={pending || !email}>
              {pending ? <Loader2 size={15} className="spin" /> : <Mail size={15} />}
              <span>{t('auth.sendLink')}</span>
            </button>
          </form>
        </>
      )}
      <div className="gate-row"><Link to="/login">{t('auth.backToSignIn')}</Link></div>
    </div>
  );
}
