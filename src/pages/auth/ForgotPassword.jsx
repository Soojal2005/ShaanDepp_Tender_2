import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Loader2, Mail } from 'lucide-react';
import { ErrorNote, Field } from '../../components/ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { isStrongPassword } from './ResetPassword.jsx';

/** Forgot password via a 6-digit email OTP: enter email, then code + new password. */
export default function ForgotPassword() {
  const { t } = useI18n();
  const [step, setStep] = useState('email'); // 'email' | 'reset' | 'done'
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const weak = password.length > 0 && !isStrongPassword(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const otpValid = /^\d{6}$/.test(otp);

  const sendCode = async (e) => {
    e?.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setStep('reset');
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    setError(null);
    if (!otpValid) return setError({ message: t('auth.invalidOtp') });
    if (!isStrongPassword(password)) return setError({ message: t('auth.weak') });
    if (password !== confirm) return setError({ message: t('auth.mismatch') });
    setPending(true);
    try {
      await api.post('/auth/reset-password', { email: email.trim(), otp, password });
      setStep('done');
    } catch (err) {
      setError(err.code === 'invalid_otp' ? { message: t('auth.invalidOtp') } : err);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="gate-card">
      <h2>{t('auth.forgotTitle')}</h2>

      {step === 'done' ? (
        <>
          <div className="note note-success" role="status">{t('auth.resetDone')}</div>
          <Link to="/login" className="btn btn-primary" style={{ textDecoration: 'none', color: '#fff' }}>{t('auth.signIn')}</Link>
        </>
      ) : step === 'email' ? (
        <>
          <p className="gate-sub">{t('auth.forgotBody')}</p>
          <ErrorNote error={error} />
          <form onSubmit={sendCode} noValidate>
            <Field label={t('auth.email')}>
              {(p) => (
                <input {...p} className="input" type="email" autoComplete="username" required autoFocus
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              )}
            </Field>
            <button type="submit" className="btn btn-primary" disabled={pending || !email}>
              {pending ? <Loader2 size={15} className="spin" /> : <Mail size={15} />}
              <span>{t('auth.sendCode')}</span>
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="gate-sub">{t('auth.otpBody')}</p>
          <ErrorNote error={error} />
          <form onSubmit={reset} noValidate>
            <Field label={t('auth.otpLabel')}>
              {(p) => (
                <input {...p} className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus
                  value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              )}
            </Field>
            <Field label={t('auth.newPassword')} error={weak ? t('auth.weak') : null}>
              {(p) => (
                <input {...p} className="input" type="password" autoComplete="new-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              )}
            </Field>
            <Field label={t('auth.confirmPassword')} error={mismatch ? t('auth.mismatch') : null}>
              {(p) => (
                <input {...p} className="input" type="password" autoComplete="new-password" required
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              )}
            </Field>
            <button type="submit" className="btn btn-primary" disabled={pending || !otpValid || !password || !confirm}>
              {pending ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}
              <span>{t('auth.setPassword')}</span>
            </button>
          </form>
          <div className="gate-row">
            <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={sendCode}>{t('auth.resend')}</button>
          </div>
        </>
      )}

      <div className="gate-row"><Link to="/login">{t('auth.backToSignIn')}</Link></div>
    </div>
  );
}
