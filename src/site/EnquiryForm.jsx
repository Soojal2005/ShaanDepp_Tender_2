import { useState } from 'react';
import { ArrowRight, Building2, CheckCircle2, Mail, MessageCircle, MessageSquare, Phone, User } from 'lucide-react';
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
  const ph = (key) => (rich ? t(`site.f.${key}Ph`) : undefined);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const out = await run(() => api.post('/public/enquiries', {
      name: form.name.trim(), company: form.company.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined,
      service: service || undefined, kind, message: form.message.trim() || undefined, language: lang, consent: form.consent, website: form.website,
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
    <form className={`site-form ${rich ? 'site-form-rich' : ''}`} onSubmit={submit} noValidate>
      <div className="site-form-grid">
        <IconField label={t('site.f.name')} required icon={rich ? User : null}>{(p) => <input {...p} id={`${idPrefix}-name`} aria-label={t('site.f.name')} placeholder={ph('name')} className="input" required minLength={2} maxLength={150} autoComplete="name" value={form.name} onChange={set('name')} />}</IconField>
        <IconField label={t('site.f.company')} required icon={rich ? Building2 : null}>{(p) => <input {...p} id={`${idPrefix}-company`} aria-label={t('site.f.company')} placeholder={ph('company')} className="input" required minLength={2} maxLength={200} autoComplete="organization" value={form.company} onChange={set('company')} />}</IconField>
        <IconField label={t('site.f.email')} required icon={rich ? Mail : null}>{(p) => <input {...p} id={`${idPrefix}-email`} aria-label={t('site.f.email')} placeholder={ph('email')} className="input" type="email" required maxLength={150} autoComplete="email" value={form.email} onChange={set('email')} />}</IconField>
        <IconField label={t('site.f.phone')} optional={t('common.optional')} icon={rich ? Phone : null}>{(p) => <input {...p} id={`${idPrefix}-phone`} aria-label={t('site.f.phone')} placeholder={ph('phone')} className="input" type="tel" maxLength={50} autoComplete="tel" value={form.phone} onChange={set('phone')} />}</IconField>
      </div>
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
