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
      setError(err.code === 'invalid_token' ? { message: t('auth.resetInvalid') } : err);
    } finally {
      setPending(false);
    }
  };

  if (!token) {
    return (
      <div className="gate-card">
        <h2>{t('auth.resetTitle')}</h2>
        <div className="note note-error" role="alert">{t('auth.missingToken')}</div>
        <div className="gate-row"><Link to="/forgot-password">{t('auth.forgotTitle')}</Link></div>
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
