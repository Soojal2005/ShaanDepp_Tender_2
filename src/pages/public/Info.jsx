import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, LogIn, Mail, MapPin, Phone } from 'lucide-react';
import { useI18n } from '../../i18n/index.jsx';
import EnquiryForm, { ACCESS_SERVICE, ContactButtons } from '../../site/EnquiryForm.jsx';
import { telHref, useSeo, useSiteConfig } from '../../site/hooks.js';

export function About() {
  const { t } = useI18n();
  const site = useSiteConfig();
  useSeo({ title: t('site.seo.aboutTitle'), description: t('site.aboutBody')[0], path: '/about' });
  return (
    <div className="site-wrap site-page">
      <h1>{t('site.aboutTitle')}</h1>
      <div className="site-two-col">
        <div>
          {t('site.aboutBody').map((p) => <p className="site-body" key={p}>{p}</p>)}
          <ul className="site-points">{t('site.aboutPoints').map((p) => <li key={p}><CheckCircle2 size={16} />{p}</li>)}</ul>
          <p className="site-reg-line">{t('site.trustBusiness')}: <b>{site.registration.business}</b> · {t('site.trustGst')}: <b>{site.registration.gst}</b></p>
          <Link className="btn btn-primary" to="/services">{t('site.ctaServices')}</Link>
        </div>
        <aside className="site-side-card">
          <h2>{t('site.enquireGeneral')}</h2>
          <EnquiryForm idPrefix="about" />
        </aside>
      </div>
    </div>
  );
}

export function Contact() {
  const { t } = useI18n();
  const site = useSiteConfig();
  useSeo({ title: t('site.seo.contactTitle'), description: t('site.contactSub'), path: '/contact' });
  return (
    <div className="site-wrap site-page">
      <h1>{t('site.contactTitle')}</h1>
      <p className="site-sub">{t('site.contactSub')}</p>
      <div className="site-two-col">
        <div>
          <ul className="site-contact-list">
            <li><Phone size={18} /><a href={telHref(site.phone)}>{site.phone}</a></li>
            <li><Mail size={18} /><a href={`mailto:${site.email}`}>{site.email}</a></li>
            <li><MapPin size={18} /><span>{t('site.city')}</span></li>
          </ul>
          <ContactButtons />
        </div>
        <aside className="site-side-card">
          <h2>{t('site.enquireGeneral')}</h2>
          <p className="cell-sub">{t('site.enquireHint')}</p>
          <EnquiryForm idPrefix="contact" />
        </aside>
      </div>
    </div>
  );
}

/** Portal accounts are created by staff, so this is an enquiry tagged for the inbox rather than a signup. */
export function RequestAccess() {
  const { t } = useI18n();
  useSeo({ title: t('site.access.seoTitle'), description: t('site.access.seoDesc'), path: '/request-access' });
  return (
    <div className="site-wrap site-page">
      <h1>{t('site.access.title')}</h1>
      <p className="site-sub">{t('site.access.sub')}</p>
      <div className="site-two-col">
        <div>
          <h2>{t('site.access.stepsTitle')}</h2>
          <ol className="site-portal-list site-access-steps">
            {t('site.access.steps').map((step, i) => <li key={step.title}><b>{i + 1}</b><span><strong>{step.title}</strong>{step.body}</span></li>)}
          </ol>
          <p className="site-reg-line">{t('site.access.haveAccount')} <Link to="/login">{t('site.nav.signIn')}</Link></p>
        </div>
        <aside className="site-side-card">
          <h2>{t('site.access.formTitle')}</h2>
          <p className="cell-sub">{t('site.access.formHint')}</p>
          <EnquiryForm idPrefix="access" service={ACCESS_SERVICE} kind="access_request" sendLabel={t('site.access.send')} />
        </aside>
      </div>
    </div>
  );
}

/** The "Get started" landing: sign in if you already have an account, or register your company (full details). */
export function GetStarted() {
  const { t } = useI18n();
  useSeo({ title: t('site.getStarted.seoTitle'), description: t('site.getStarted.seoDesc'), path: '/get-started' });
  return (
    <div className="site-wrap site-page">
      <h1>{t('site.getStarted.title')}</h1>
      <p className="site-sub">{t('site.getStarted.sub')}</p>

      <div className="gs-login">
        <div>
          <h2>{t('site.getStarted.haveAccount')}</h2>
          <p className="cell-sub">{t('site.getStarted.loginHint')}</p>
        </div>
        <Link className="btn btn-outline" to="/login"><LogIn size={16} />{t('site.getStarted.login')}</Link>
      </div>

      <div className="site-two-col">
        <div>
          <h2>{t('site.access.stepsTitle')}</h2>
          <ol className="site-portal-list site-access-steps">
            {t('site.access.steps').map((step, i) => <li key={step.title}><b>{i + 1}</b><span><strong>{step.title}</strong>{step.body}</span></li>)}
          </ol>
        </div>
        <aside className="site-side-card">
          <h2>{t('site.getStarted.registerTitle')}</h2>
          <p className="cell-sub">{t('site.getStarted.registerHint')}</p>
          <EnquiryForm idPrefix="gs" service={ACCESS_SERVICE} kind="access_request" sendLabel={t('site.getStarted.register')} rich />
        </aside>
      </div>
    </div>
  );
}

export function SiteNotFound() {
  const { t } = useI18n();
  useSeo({ title: t('site.notFoundTitle'), description: t('site.notFoundBody'), path: window.location.pathname });
  return (
    <div className="site-wrap site-page" style={{ textAlign: 'center', padding: '80px 16px' }}>
      <h1>{t('site.notFoundTitle')}</h1>
      <p className="site-sub">{t('site.notFoundBody')}</p>
      <Link className="btn btn-primary" to="/services">{t('site.servicesPageTitle')}</Link>
    </div>
  );
}
