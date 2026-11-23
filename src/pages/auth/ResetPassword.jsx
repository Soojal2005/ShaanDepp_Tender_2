import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeyRound, Loader2 } from 'lucide-react';
import { ErrorNote, Field } from '../../components/ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';

// Mirrors the server rule: at least 10 characters, one letter and one digit.
export const isStrongPassword = (value) => value.length >= 10 && /[A-Za-z]/.test(value) && /\d/.test(value);

/** Used for both "forgot password" links and invitation emails. */
export default function ResetPassword() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);

  const weak = password.length > 0 && !isStrongPassword(password);
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!isStrongPassword(password)) return setError({ message: t('auth.weak') });
    if (password !== confirm) return setError({ message: t('auth.mismatch') });
    setPending(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      // An expired / already-used / malformed link: offer a clear way to get a fresh one.
      if (err.code === 'invalid_token') setExpired(true);
      else setError(err);
    } finally {
      setPending(false);
    }
  };

  // No token in the link, or the link is expired / already used: recover by requesting a fresh one.
  if (!token || expired) {
    return (
      <div className="gate-card">
        <h2>{t('auth.resetTitle')}</h2>
        <div className="note note-error" role="alert">{token ? t('auth.resetInvalid') : t('auth.missingToken')}</div>
        <p className="gate-sub" style={{ margin: '0 0 22px' }}>{t('auth.resetRecover')}</p>
        <Link to="/forgot-password" className="btn btn-primary" style={{ textDecoration: 'none', color: '#fff' }}>{t('auth.sendLink')}</Link>
        <div className="gate-row"><Link to="/login">{t('auth.backToSignIn')}</Link></div>
      </div>
    );
  }

  return (
    <div className="gate-card">
      <h2>{t('auth.resetTitle')}</h2>
      <p className="gate-sub">{t('auth.resetBody')}</p>
      {done ? (
        <>
          <div className="note note-success" role="status">{t('auth.resetDone')}</div>
          <Link to="/login" className="btn btn-primary" style={{ textDecoration: 'none', color: '#fff' }}>{t('auth.signIn')}</Link>
        </>
      ) : (
        <>
          <ErrorNote error={error} />
          <form onSubmit={submit} noValidate>
            <Field label={t('auth.newPassword')} error={weak ? t('auth.weak') : null}>
              {(p) => (
                <input {...p} className="input" type="password" autoComplete="new-password" autoFocus required
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              )}
            </Field>
            <Field label={t('auth.confirmPassword')} error={mismatch ? t('auth.mismatch') : null}>
              {(p) => (
                <input {...p} className="input" type="password" autoComplete="new-password" required
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              )}
            </Field>
            <button type="submit" className="btn btn-primary" disabled={pending || !password || !confirm}>
              {pending ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}
              <span>{t('auth.setPassword')}</span>
            </button>
          </form>
        </>
      )}
    </div>
  );
}
