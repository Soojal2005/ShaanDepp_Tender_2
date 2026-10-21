import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Key, Loader2, Lock } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { ErrorNote, Field } from '../../components/ui.jsx';
import { useI18n } from '../../i18n/index.jsx';

export default function Login() {
  const { status, login, expired } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const from = location.state?.from && location.state.from.startsWith('/app') ? location.state.from : '/app';
  if (status === 'authenticated') return <Navigate to={from} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err.status === 429) setError({ message: t('auth.locked') });
      else if (err.status === 401) setError({ message: t('auth.invalidCredentials') });
      else setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="gate-card">
      <div className="gate-badge"><Lock size={12} />{t('auth.gateBadge')}</div>
      <h2>{t('auth.signInTitle')}</h2>
      <p className="gate-sub">{t('auth.signInSubtitle')}</p>

      {(location.state?.expired || expired) && !error && (
        <div className="note note-info" role="status">{t('auth.sessionExpired')}</div>
      )}
      <ErrorNote error={error} />

      <form onSubmit={submit} noValidate>
        <Field label={t('auth.email')}>
          {(p) => (
            <input {...p} className="input" type="email" autoComplete="username" required autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          )}
        </Field>
        <Field label={t('auth.password')}>
          {(p) => (
            <input {...p} className="input" type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
        <button type="submit" className="btn btn-primary" disabled={pending || !email || !password}>
          {pending ? <Loader2 size={15} className="spin" /> : <Key size={15} />}
          <span>{pending ? t('auth.signingIn') : t('auth.signIn')}</span>
        </button>
      </form>

      <div className="gate-row">
        <Link to="/forgot-password">{t('auth.forgot')}</Link>
      </div>
    </div>
  );
}
