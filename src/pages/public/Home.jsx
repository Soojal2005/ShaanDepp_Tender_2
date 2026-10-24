import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Bell, Building2, CalendarDays, BarChart3, ChevronRight, ClipboardCheck, ClipboardList, Factory, FileSearch, FileText, HeartPulse, Landmark, Lightbulb, MoreHorizontal, ScrollText, Search, Send, ShieldCheck, ShoppingBag, Users, Wallet } from 'lucide-react';
import { DEPARTMENTS, GROUPS } from '../../content/services.js';
import { useI18n } from '../../i18n/index.jsx';
import { formatDate } from '../../lib/format.js';
import EnquiryForm from '../../site/EnquiryForm.jsx';
import FlowChart from '../../site/FlowChart.jsx';
import PortalPreview from '../../site/PortalPreview.jsx';
import { useSeo, useSiteConfig } from '../../site/hooks.js';

export const GROUP_ICONS = { FileSearch, ShoppingBag, Building2, ClipboardList, BadgeCheck, Landmark, ScrollText, Lightbulb };
const SERVICE_ICONS = [ClipboardList, ShoppingBag, Building2, ClipboardCheck, BadgeCheck, Wallet, ScrollText, Lightbulb];
const BENEFIT_ICONS = [Bell, Users, ClipboardList, ShieldCheck];
const PORTAL_ICONS = [Bell, Search, ShieldCheck, ClipboardList, FileSearch];
const PROCESS_ICONS = [Search, ClipboardList, Send, BarChart3];
const DEPARTMENT_ICONS = [Landmark, Landmark, Factory, Landmark, Building2, Users, MoreHorizontal];

export default function Home() {
  const { t, lang } = useI18n();
  const site = useSiteConfig();
  const L = lang === 'HI' ? 'hi' : 'en';
  const [samples, setSamples] = useState([]);
  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) return;
    let active = true;
    import('../../lib/supabase.js').then(({ getSampleTenders }) => getSampleTenders())
      .then((rows) => { if (active) setSamples(rows); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const sampleCards = samples.length ? samples : t('site.home.samples');
  useSeo({ title: t('site.seo.homeTitle'), description: t('site.seo.homeDesc'), path: '/' });

  return (
    <div className="site-home">
      <section className="site-hero" aria-labelledby="hero-title">
        <div className="site-wrap">
          <div className="site-hero-grid">
            <div className="site-hero-copy">
              <p className="site-kicker">{t('site.heroKicker')}</p>
              <h1 id="hero-title">{lang === 'HI' ? t('site.heroTitle') : <>Win government tenders<br className="hero-break" /> with the right information<br className="hero-break" /> and a <span>team beside you</span></>}</h1>
              <p className="site-lead">{t('site.heroBody')}</p>
              <div className="site-cta-row">
                <Link className="btn btn-primary" to="/login">{t('site.ctaPortal')} <ArrowRight size={17} /></Link>
                <Link className="btn btn-outline" to="/services">{t('site.ctaServices')}</Link>
                <Link className="btn btn-ghost" to="/contact">{t('site.ctaEnquire')} <ArrowRight size={17} /></Link>
              </div>
            </div>
            <aside className="site-trust" aria-label={t('site.trustTitle')}>
              <h2><ClipboardList size={25} />{t('site.trustTitle')}</h2>
              <dl>
                <div><span className="trust-symbol"><FileText size={21} /></span><div><dt>{t('site.trustBusiness')}</dt><dd>{site.registration.business}</dd></div></div>
                <div><span className="trust-symbol"><FileText size={21} /></span><div><dt>{t('site.trustGst')}</dt><dd>{site.registration.gst}</dd></div></div>
              </dl>
            </aside>
          </div>
          <ul className="site-benefits" aria-label={t('site.home.benefitsLabel')}>
            {t('site.home.benefits').map((label, i) => { const Icon = BENEFIT_ICONS[i]; return <li key={label}><Icon size={23} /><span>{label}</span></li>; })}
          </ul>
        </div>
      </section>

      <div className="site-content-surface">
        <section className="home-section home-samples" aria-labelledby="samples-title">
          <div className="site-wrap">
            <div className="home-section-heading"><div><h2 id="samples-title">{t('site.sampleTitle')}</h2><p className="site-sub">{t('site.sampleSub')}</p></div><Link className="home-text-link" to="/login">{t('site.home.allTenders')} <ArrowRight size={17} /></Link></div>
            <div className="home-sample-grid">
              {sampleCards.slice(0, 3).map((item, i) => {
                const Icon = [FileText, Factory, HeartPulse][i];
                return <Link key={item.id || item.title} to="/login" className={`home-sample-card sample-tone-${i}`}>
                  <span className="sample-icon"><Icon size={29} strokeWidth={1.8} /></span>
                  <div><h3>{item.title}</h3><p>{item.department || t('common.unavailable')}</p><span className="sample-deadline"><CalendarDays size={13} />{t('site.sampleDeadline')}: {item.submission_deadline ? formatDate(item.submission_deadline, lang) : t('site.home.exampleDate')}</span></div>
                  <ArrowRight className="sample-arrow" size={19} />
                </Link>;
              })}
            </div>
          </div>
        </section>

        <section className="home-section home-services" aria-labelledby="services-title">
          <div className="site-wrap">
            <h2 id="services-title">{t('site.servicesTitle')}</h2><p className="site-sub">{t('site.servicesSub')}</p>
            <div className="site-group-grid">
              {GROUPS.map((g, i) => { const Icon = SERVICE_ICONS[i]; return (
                <Link key={g.slug} to={`/services/${g.slug}`} className={`site-group-card service-tone-${i}`}>
                  <span className="site-group-icon"><Icon size={29} strokeWidth={1.9} /></span>
                  <div className="home-service-copy"><h3>{g.title[L]}</h3><p>{g.summary[L]}</p><span className="site-group-foot">{t('site.nServices', { n: g.items.length })}<ArrowRight size={17} /></span></div>
                </Link>
              ); })}
            </div>
          </div>
        </section>
      </div>

      <section className="home-portal" aria-labelledby="portal-title">
        <div className="site-wrap home-portal-grid">
          <div className="home-portal-copy"><h2 id="portal-title">{t('site.portalTitle')}</h2><p className="site-sub">{t('site.portalBody')}</p><Link className="btn btn-primary" to="/login">{t('site.ctaPortal')} <ArrowRight size={19} /></Link></div>
          <PortalPreview />
          <ul className="home-portal-features">{t('site.home.portalFeatures').map((label, i) => { const Icon = PORTAL_ICONS[i]; return <li key={label}><span><Icon size={18} /></span>{label}</li>; })}</ul>
          <details className="home-details home-portal-details"><summary>{t('site.home.portalDetails')}</summary><ul className="site-portal-list" aria-label={t('site.portalTitle')}>{t('site.portalPoints').map((point, i) => <li key={point}><b>{i + 1}</b><span>{point}</span></li>)}</ul></details>
        </div>
      </section>

      <div className="site-lower-surface">
        <section className="home-section home-process" aria-labelledby="process-title">
          <div className="site-wrap">
            <h2 id="process-title">{t('site.home.processTitle')}</h2>
            <ol className="home-process-grid">{t('site.home.process').map((step, i) => { const Icon = PROCESS_ICONS[i]; return <li key={step.title}><span className="process-number">{i + 1}</span><span className="process-icon"><Icon size={27} /></span><div><h3>{step.title}</h3><p>{step.body}</p></div>{i < 3 && <ChevronRight className="process-chevron" size={24} />}</li>; })}</ol>
            <details className="home-details"><summary>{t('site.home.fullProcess')}</summary><h3>{t('site.flowTitle')}</h3><p className="site-sub">{t('site.flowSub')}</p><FlowChart /></details>
          </div>
        </section>

        <section className="home-section home-departments" aria-labelledby="departments-title">
          <div className="site-wrap">
            <h2 id="departments-title">{t('site.home.departmentsTitle')}</h2>
            <ul className="home-department-grid">{t('site.home.departments').map((name, i) => { const Icon = DEPARTMENT_ICONS[i]; return <li key={name}><Icon size={29} strokeWidth={1.7} /><span>{name}</span></li>; })}</ul>
            <details className="home-details"><summary>{t('site.deptTitle')}</summary><ul className="site-dept-wall">{DEPARTMENTS.map(d => <li key={d}>{d}</li>)}</ul></details>
            <p className="home-coverage-note">{t('site.deptNote')}</p>
          </div>
        </section>

        <section className="home-section home-enquiry" id="enquiry" aria-labelledby="enquiry-title">
          <div className="site-wrap"><div className="home-enquiry-band"><div><h2 id="enquiry-title">{t('site.enquireGeneral')}</h2><p className="site-sub">{t('site.home.enquiryBody')}</p><p className="home-enquiry-help"><b>{t('site.ctaBandTitle')}</b> {t('site.ctaBandBody')}</p></div><EnquiryForm idPrefix="home" compact /></div></div>
        </section>
      </div>
    </div>
  );
}
