import { useState } from 'react';
import { ArrowRight, Briefcase, Building2, CheckCircle2, Hash, Mail, MapPin, MessageCircle, MessageSquare, Phone, Tags, User } from 'lucide-react';
import { Button, ErrorNote, Field } from '../components/ui.jsx';
import { INDUSTRIES } from '../content/industries.js';
import { useI18n } from '../i18n/index.jsx';
import { api } from '../lib/api.js';
import { useAction } from '../lib/hooks.js';
import { telHref, useSiteConfig, whatsappHref } from './hooks.js';

/** Call and WhatsApp buttons. `topic` is the service the visitor is looking at. */
export function ContactButtons({ topic }) {
  const { t } = useI18n();
  const site = useSiteConfig();
  return (
    <div className="site-contact-buttons">
      <a className="btn btn-outline" href={telHref(site.phone)}><Phone size={15} />{t('site.callUs')}: {site.phone}</a>
      <a className="btn btn-whatsapp" href={whatsappHref(site.whatsappNumber, t('site.waText', { service: topic || t('site.brand') }))} target="_blank" rel="noopener noreferrer">
        <MessageCircle size={15} />{t('site.chat')}
      </a>
    </div>
  );
}

/** The label staff see on a request for a portal account; the admin queue itself is selected by `kind`. */
export const ACCESS_SERVICE = 'Portal access request';
const MESSAGE_MAX = 4000;

const Required = () => <span className="req" aria-hidden="true"> *</span>;

/** A labelled input with an optional leading icon, used by the enquiry form. */
function IconField({ label, required, optional, icon: Icon, children }) {
  return (
    <Field label={required ? <>{label}<Required /></> : label} optional={optional}>
      {(p) => <div className={`field-control ${Icon ? 'has-icon' : ''}`}>{Icon && <Icon size={17} aria-hidden="true" />}{children(p)}</div>}
    </Field>
  );
}

/**
 * Enquiry form. Each submission lands in the staff inbox; `service` records what the visitor was looking at.
 * `rich` turns on the landing-page styling: placeholders, leading field icons and a message counter.
 */
export default function EnquiryForm({ service = '', kind = 'general', idPrefix = 'enq', sendLabel, rich = false }) {
  const { t, lang } = useI18n();
  const { pending, run } = useAction();
  // Registering "as a company" (access_request) also captures the company's identity.
  const isAccess = kind === 'access_request';
  const blank = { name: '', company: '', email: '', phone: '', message: '', consent: false, website: '', gstin: '', address: '', city: '', state: '', industry: '', keywords: '', otp: '' };
  const [form, setForm] = useState(blank);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  // Registering as a company verifies the email up front: enter email -> get a
  // 6-digit code by mail -> verify it -> then the rest of the form can be sent.
  const [otpSent, setOtpSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const { pending: otpPending, run: runOtp } = useAction();
  const nameValid = form.name.trim().length >= 2;
  const companyValid = form.company.trim().length >= 2;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  // The company identity required at registration: phone, city, state, industry (GSTIN and street address are optional).
  const companyValid2 = !isAccess || (form.phone.trim() && form.city.trim() && form.state.trim() && form.industry.trim());
  const otpValid = /^\d{6}$/.test(form.otp.trim());
  const baseValid = nameValid && companyValid && emailValid && companyValid2 && form.consent;
  // For an access request the email must be verified before the form can be sent.
  const canSubmit = isAccess ? baseValid && emailVerified : baseValid;
  const formHint = !nameValid || !companyValid ? t('site.f.needDetails')
    : !emailValid ? t('site.f.needEmail')
      : !companyValid2 ? t('site.f.needCompany')
        : !form.consent ? t('site.f.needConsent')
          : isAccess && !emailVerified ? t('site.f.otpVerifyFirst') : t('site.f.ready');
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const ph = (key) => (rich ? t(`site.f.${key}Ph`) : undefined);
  const trimmed = (key) => form[key].trim() || undefined;

  // Changing the email invalidates any code already sent/verified for the old one.
  const onEmailChange = (e) => {
    setForm({ ...form, email: e.target.value, otp: '' });
    setOtpSent(false);
    setEmailVerified(false);
  };

  // Step 1 (access request): email a 6-digit verification code to the address.
  const requestOtp = async () => {
    setError(null);
    setEmailVerified(false);
    const out = await runOtp(() => api.post('/public/register/request-otp', { email: form.email.trim(), name: form.name.trim() || undefined }));
    if (out.ok) setOtpSent(true); else setError(out.error);
  };

  // Step 2: confirm the code the user typed (does not use it up — submit does).
  const verify = async () => {
    setError(null);
    const out = await runOtp(() => api.post('/public/register/verify-otp', { email: form.email.trim(), otp: form.otp.trim() }));
    if (out.ok) setEmailVerified(true); else setError({ message: t('site.f.otpInvalid') });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const out = await run(() => api.post('/public/enquiries', {
      name: form.name.trim(), company: form.company.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined,
      service: service || undefined, kind, message: form.message.trim() || undefined, language: lang, consent: form.consent, website: form.website,
      ...(isAccess && { gstin: trimmed('gstin'), address: trimmed('address'), city: trimmed('city'), state: trimmed('state'), industry: trimmed('industry'), keywords: trimmed('keywords'), otp: form.otp.trim() }),
    }));
    if (out.ok) { setDone(true); setForm(blank); setOtpSent(false); setEmailVerified(false); } else setError(out.error);
  };

  if (done) {
    return (
      <div className="site-form-done" role="status">
        <CheckCircle2 size={28} />
        <p>{t('site.sent')}</p>
        <ContactButtons topic={service} />
      </div>
    );
  }
  return (
    <form className={`site-form ${rich ? 'site-form-rich' : ''}`} onSubmit={submit} noValidate>
      <div className="site-form-grid">
        <IconField label={t('site.f.name')} required icon={rich ? User : null}>{(p) => <input {...p} id={`${idPrefix}-name`} aria-label={t('site.f.name')} placeholder={ph('name')} className="input" required minLength={2} maxLength={150} autoComplete="name" value={form.name} onChange={set('name')} />}</IconField>
        <IconField label={t('site.f.company')} required icon={rich ? Building2 : null}>{(p) => <input {...p} id={`${idPrefix}-company`} aria-label={t('site.f.company')} placeholder={ph('company')} className="input" required minLength={2} maxLength={200} autoComplete="organization" value={form.company} onChange={set('company')} />}</IconField>
        <IconField label={t('site.f.email')} required icon={rich ? Mail : null}>{(p) => <input {...p} id={`${idPrefix}-email`} aria-label={t('site.f.email')} placeholder={ph('email')} className="input" type="email" required maxLength={150} autoComplete="email" value={form.email} onChange={onEmailChange} />}</IconField>
        <IconField label={t('site.f.phone')} required={isAccess} optional={isAccess ? undefined : t('common.optional')} icon={rich ? Phone : null}>{(p) => <input {...p} id={`${idPrefix}-phone`} aria-label={t('site.f.phone')} placeholder={ph('phone')} className="input" type="tel" required={isAccess} maxLength={50} autoComplete="tel" value={form.phone} onChange={set('phone')} />}</IconField>
      </div>
      {isAccess && (
        <div className="site-form-otp">
          {emailVerified ? (
            <p className="note note-success" role="status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={16} /> {t('site.f.otpVerified')}
            </p>
          ) : !otpSent ? (
            <Button variant="outline" pending={otpPending} disabled={otpPending || !emailValid} onClick={requestOtp}>
              {otpPending ? t('site.f.otpSending') : t('site.f.otpSend')}
            </Button>
          ) : (
            <>
              <p className="cell-sub">{t('site.f.otpSentNote')}</p>
              <IconField label={t('site.f.otpLabel')} required icon={rich ? Mail : null}>
                {(p) => (
                  <input {...p} id={`${idPrefix}-otp`} aria-label={t('site.f.otpLabel')} className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                    value={form.otp} onChange={(e) => setForm({ ...form, otp: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
                )}
              </IconField>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button pending={otpPending} disabled={otpPending || !otpValid} onClick={verify}>
                  {otpPending ? t('site.f.otpVerifying') : t('site.f.otpVerify')}
                </Button>
                <Button variant="outline" size="sm" pending={otpPending} disabled={otpPending} onClick={requestOtp}>{t('site.f.otpResend')}</Button>
              </div>
            </>
          )}
        </div>
      )}
      {isAccess && (
        <>
          <p className="site-form-section">{t('site.f.companyHeading')}</p>
          <div className="site-form-grid">
            <IconField label={t('site.f.city')} required icon={rich ? MapPin : null}>{(p) => <input {...p} id={`${idPrefix}-city`} aria-label={t('site.f.city')} placeholder={ph('city')} className="input" required maxLength={100} autoComplete="address-level2" value={form.city} onChange={set('city')} />}</IconField>
            <IconField label={t('site.f.state')} required icon={rich ? MapPin : null}>{(p) => <input {...p} id={`${idPrefix}-state`} aria-label={t('site.f.state')} placeholder={ph('state')} className="input" required maxLength={100} autoComplete="address-level1" value={form.state} onChange={set('state')} />}</IconField>
            <IconField label={t('site.f.industry')} required icon={rich ? Briefcase : null}>{(p) => (
              <>
                {/* Combobox: pick a listed industry or type your own words. The typed text is stored and drives matching. */}
                <input {...p} id={`${idPrefix}-industry`} aria-label={t('site.f.industry')} className="input" required maxLength={120}
                  list={`${idPrefix}-industry-list`} placeholder={t('site.f.industrySelect')} value={form.industry} onChange={set('industry')} />
                <datalist id={`${idPrefix}-industry-list`}>
                  {INDUSTRIES.map((it) => <option key={it.value} value={it.value}>{lang === 'HI' ? it.hi : it.value}</option>)}
                </datalist>
              </>
            )}</IconField>
            <IconField label={t('site.f.gstin')} optional={t('common.optional')} icon={rich ? Hash : null}>{(p) => <input {...p} id={`${idPrefix}-gstin`} aria-label={t('site.f.gstin')} placeholder={ph('gstin')} className="input" maxLength={15} style={{ textTransform: 'uppercase' }} value={form.gstin} onChange={set('gstin')} />}</IconField>
          </div>
          <IconField label={t('site.f.address')} optional={t('common.optional')} icon={rich ? Building2 : null}>{(p) => <input {...p} id={`${idPrefix}-address`} aria-label={t('site.f.address')} placeholder={ph('address')} className="input" maxLength={300} autoComplete="street-address" value={form.address} onChange={set('address')} />}</IconField>
          <IconField label={t('site.f.keywords')} optional={t('common.optional')} icon={rich ? Tags : null}>{(p) => <textarea {...p} id={`${idPrefix}-keywords`} aria-label={t('site.f.keywords')} placeholder={ph('keywords')} className="input textarea" rows={2} maxLength={1000} value={form.keywords} onChange={set('keywords')} />}</IconField>
          <p className="cell-sub" style={{ margin: '-6px 0 2px' }}>{t('site.f.keywordsHint')}</p>
        </>
      )}
      <IconField label={t('site.f.message')} required={rich} optional={rich ? undefined : t('common.optional')} icon={rich ? MessageSquare : null}>{(p) => <textarea {...p} id={`${idPrefix}-message`} aria-label={t('site.f.message')} placeholder={ph('message')} className="input textarea" rows={4} maxLength={MESSAGE_MAX} value={form.message} onChange={set('message')} />}</IconField>
      {rich && <p className="site-form-count" aria-hidden="true">{form.message.length}/500</p>}
      {/* Honeypot: hidden from people, filled by bots. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}>
        <label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label>
      </div>
      <label className="check-row site-consent">
        <input type="checkbox" checked={form.consent} onChange={set('consent')} />
        <span>{rich ? t('site.f.consentShort') : t('site.f.consent')}</span>
      </label>
      {rich && <p className="site-form-privacy">{t('site.privacy')}</p>}
      <p className={`site-form-feedback ${canSubmit ? 'is-ready' : ''}`} role="status" aria-live="polite">{formHint}</p>
      {!rich && <p className="cell-sub">{t('site.privacy')}</p>}
      <ErrorNote error={error} />
      <Button type="submit" pending={pending} disabled={pending || !canSubmit}>
        {pending ? t('site.f.sending') : (sendLabel || t('site.f.send'))}{!pending && <ArrowRight size={16} />}
      </Button>
    </form>
  );
}
