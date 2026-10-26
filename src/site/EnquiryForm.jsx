import { useState } from 'react';
import { ArrowRight, CheckCircle2, MessageCircle, Phone } from 'lucide-react';
import { Button, ErrorNote, Field } from '../components/ui.jsx';
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

/** Enquiry form. Each submission lands in the staff inbox; `service` records what the visitor was looking at. */
export default function EnquiryForm({ service = '', idPrefix = 'enq', compact = false, sendLabel }) {
  const { t, lang } = useI18n();
  const { pending, run } = useAction();
  const blank = { name: '', company: '', email: '', phone: '', message: '', consent: false, website: '' };
  const [form, setForm] = useState(blank);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const nameValid = form.name.trim().length >= 2;
  const companyValid = form.company.trim().length >= 2;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const canSubmit = nameValid && companyValid && emailValid && form.consent;
  const formHint = !nameValid || !companyValid ? t('site.f.needDetails')
    : !emailValid ? t('site.f.needEmail')
      : !form.consent ? t('site.f.needConsent') : t('site.f.ready');
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const out = await run(() => api.post('/public/enquiries', {
      name: form.name.trim(), company: form.company.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined,
      service: service || undefined, message: form.message.trim() || undefined, language: lang, consent: form.consent, website: form.website,
    }));
    if (out.ok) { setDone(true); setForm(blank); } else setError(out.error);
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
    <form className={`site-form ${compact ? 'site-form-compact' : ''}`} onSubmit={submit} noValidate={!compact}>
      <div className="site-form-grid">
        <Field label={t('site.f.name')}>{(p) => <input {...p} id={`${idPrefix}-name`} aria-label={t('site.f.name')} placeholder={compact ? t('site.f.name') : undefined} className="input" required minLength={2} maxLength={150} autoComplete="name" value={form.name} onChange={set('name')} />}</Field>
        <Field label={t('site.f.company')}>{(p) => <input {...p} id={`${idPrefix}-company`} aria-label={t('site.f.company')} placeholder={compact ? t('site.f.company') : undefined} className="input" required minLength={2} maxLength={200} autoComplete="organization" value={form.company} onChange={set('company')} />}</Field>
        <Field label={t('site.f.email')}>{(p) => <input {...p} id={`${idPrefix}-email`} aria-label={t('site.f.email')} placeholder={compact ? t('site.f.email') : undefined} className="input" type="email" required maxLength={150} autoComplete="email" value={form.email} onChange={set('email')} />}</Field>
        <Field label={t('site.f.phone')} optional={t('common.optional')}>{(p) => <input {...p} id={`${idPrefix}-phone`} aria-label={t('site.f.phone')} placeholder={compact ? t('site.f.phone') : undefined} className="input" type="tel" maxLength={50} autoComplete="tel" value={form.phone} onChange={set('phone')} />}</Field>
      </div>
      <Field label={t('site.f.message')} optional={t('common.optional')}>{(p) => <textarea {...p} id={`${idPrefix}-message`} aria-label={t('site.f.message')} placeholder={compact ? t('site.f.message') : undefined} className="input textarea" rows={compact ? 1 : 4} maxLength={4000} value={form.message} onChange={set('message')} />}</Field>
      {/* Honeypot: hidden from people, filled by bots. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}>
        <label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label>
      </div>
      <label className="check-row site-consent">
        <input type="checkbox" checked={form.consent} onChange={set('consent')} />
        <span>{t('site.f.consent')}</span>
      </label>
      <p className={`site-form-feedback ${canSubmit ? 'is-ready' : ''}`} role="status" aria-live="polite">{formHint}</p>
      <p className="cell-sub">{t('site.privacy')}</p>
      <ErrorNote error={error} />
      <Button type="submit" pending={pending} disabled={pending || !canSubmit}>
        {pending ? t('site.f.sending') : (sendLabel || t('site.f.send'))}{compact && !pending && <ArrowRight size={17} />}
      </Button>
    </form>
  );
}
