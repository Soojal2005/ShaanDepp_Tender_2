import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Building2, ClipboardList, FileSearch, Landmark, Lightbulb, ScrollText, ShoppingBag } from 'lucide-react';
import { DEPARTMENTS, GROUPS } from '../../content/services.js';
import { useI18n } from '../../i18n/index.jsx';
import EnquiryForm from '../../site/EnquiryForm.jsx';
import FlowChart from '../../site/FlowChart.jsx';
import { useSeo, useSiteConfig } from '../../site/hooks.js';

export const GROUP_ICONS = { FileSearch, ShoppingBag, Building2, ClipboardList, BadgeCheck, Landmark, ScrollText, Lightbulb };

export default function Home() {
  const { t, lang } = useI18n();
  const site = useSiteConfig();
  const L = lang === 'HI' ? 'hi' : 'en';
  useSeo({ title: t('site.seo.homeTitle'), description: t('site.seo.homeDesc'), path: '/' });
  return (
    <>
      <section className="site-hero">
        <div className="site-wrap site-hero-grid">
          <div>
            <p className="site-kicker">{t('site.heroKicker')}</p>
            <h1>{t('site.heroTitle')}</h1>
            <p className="site-lead">{t('site.heroBody')}</p>
            <div className="site-cta-row">
              <Link className="btn btn-primary" to="/login">{t('site.ctaPortal')} <ArrowRight size={15} /></Link>
              <Link className="btn btn-outline" to="/services">{t('site.ctaServices')}</Link>
              <Link className="btn btn-ghost" to="/contact">{t('site.ctaEnquire')}</Link>
            </div>
          </div>
          <aside className="site-trust" aria-label={t('site.trustTitle')}>
            <h2>{t('site.trustTitle')}</h2>
            <dl>
              <dt>{t('site.trustBusiness')}</dt><dd>{site.registration.business}</dd>
              <dt>{t('site.trustGst')}</dt><dd>{site.registration.gst}</dd>
            </dl>
          </aside>
        </div>
      </section>

      <section className="site-section">
        <div className="site-wrap">
          <h2>{t('site.servicesTitle')}</h2>
          <p className="site-sub">{t('site.servicesSub')}</p>
          <div className="site-group-grid">
            {GROUPS.map((g) => {
              const Icon = GROUP_ICONS[g.icon];
              return (
                <Link key={g.slug} to={`/services/${g.slug}`} className="site-group-card">
                  <span className="site-group-icon"><Icon size={22} /></span>
                  <h3>{g.title[L]}</h3>
                  <p>{g.summary[L]}</p>
                  <span className="site-group-foot">{t('site.nServices', { n: g.items.length })} <ArrowRight size={14} /></span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="site-section alt">
        <div className="site-wrap site-portal-grid">
          <div>
            <h2>{t('site.portalTitle')}</h2>
            <p className="site-sub">{t('site.portalBody')}</p>
            <Link className="btn btn-primary" to="/login">{t('site.ctaPortal')} <ArrowRight size={15} /></Link>
          </div>
          <ul className="site-portal-list" aria-label={t('site.portalTitle')}>
            {t('site.portalPoints').map((p, i) => <li key={p}><b>{i + 1}</b><span>{p}</span></li>)}
          </ul>
        </div>
      </section>

      <section className="site-section">
        <div className="site-wrap">
          <h2>{t('site.flowTitle')}</h2>
          <p className="site-sub">{t('site.flowSub')}</p>
          <FlowChart />
        </div>
      </section>

      <section className="site-section alt">
        <div className="site-wrap">
          <h2>{t('site.deptTitle')}</h2>
          <ul className="site-dept-wall">{DEPARTMENTS.map((d) => <li key={d}>{d}</li>)}</ul>
          <p className="cell-sub">{t('site.deptNote')}</p>
        </div>
      </section>

      <section className="site-section">
        <div className="site-wrap site-band">
          <div>
            <h2>{t('site.ctaBandTitle')}</h2>
            <p className="site-sub">{t('site.ctaBandBody')}</p>
          </div>
          <div className="site-band-form"><EnquiryForm idPrefix="home" /></div>
        </div>
      </section>
    </>
  );
}
