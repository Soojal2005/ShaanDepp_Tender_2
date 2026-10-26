import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, BadgeCheck, Bell, Building, Building2, CalendarDays, Clock, ClipboardCheck, ClipboardList, Cog, Factory, FileSearch, FileText, Files,
  Flag, Gavel, IndianRupee, Landmark, Lightbulb, Mail, MapPin, MessageCircle, Navigation, Phone, ScrollText, Search, ShieldCheck,
  ShoppingBag, ShoppingCart, SlidersHorizontal, Trophy, Wallet,
} from 'lucide-react';
import { DEPARTMENTS, GROUPS, SERVICE_COUNT } from '../../content/services.js';
import { useI18n } from '../../i18n/index.jsx';
import { formatDate, formatInr } from '../../lib/format.js';
import EnquiryForm, { ACCESS_SERVICE } from '../../site/EnquiryForm.jsx';
import FlowChart from '../../site/FlowChart.jsx';
import PortalPreview from '../../site/PortalPreview.jsx';
import { telHref, useSeo, useSiteConfig, whatsappHref } from '../../site/hooks.js';

// The services index looks these up by each group's `icon` key, so the names must match content/services.js.
export const GROUP_ICONS = { FileSearch, ShoppingBag, Building2, ClipboardList, BadgeCheck, Landmark, ScrollText, Lightbulb };

const STAT_ICONS = [FileText, MapPin, Landmark, ShieldCheck];
const SERVICE_ICONS = [FileSearch, ShoppingCart, Building2, ClipboardCheck, ShieldCheck, Wallet, Gavel, Lightbulb];
const PORTAL_ICONS = [Bell, Search, Trophy, ClipboardCheck];
const DEPT_ICONS = [Landmark, Flag, Factory, Building2, Building, Cog, Files];
const ABOUT_ICONS = [FileSearch, ShieldCheck, ClipboardCheck, MapPin];
const SIDE_ICONS = [Clock, BadgeCheck, MessageCircle, Landmark];

// Value bands map to the portal's rupee filters, so the hero search is real, not decorative.
const VALUE_BANDS = [{ valueMax: '1000000' }, { valueMin: '1000000', valueMax: '10000000' }, { valueMin: '10000000' }];
const TYPE_VALUES = ['Works', 'Goods', 'Services'];

/** The hero search: keyword + a couple of real filters, then sign-in that lands the visitor on the results. */
function HeroSearch() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [band, setBand] = useState('');

  const runSearch = (overrideQ) => {
    const params = new URLSearchParams();
    const query = overrideQ ?? q;
    if (query.trim()) params.set('q', query.trim());
    if (type) params.set('tenderTypes', type);
    if (band !== '') { const b = VALUE_BANDS[Number(band)]; if (b.valueMin) params.set('valueMin', b.valueMin); if (b.valueMax) params.set('valueMax', b.valueMax); }
    const qs = params.toString();
    navigate('/login', { state: { from: `/app/search${qs ? `?${qs}` : ''}` } });
  };

  return (
    <div className="lp-search">
      <form className="lp-search-row" onSubmit={(e) => { e.preventDefault(); runSearch(); }} role="search">
        <span className="lp-search-field">
          <Search size={20} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('site.lp.searchPlaceholder')} aria-label={t('site.lp.searchBtn')} />
        </span>
        <button type="submit" className="btn btn-dark lp-search-btn">{t('site.lp.searchBtn')} <ArrowRight size={17} /></button>
      </form>
      <div className="lp-search-filters">
        <select className="lp-pill" value={type} onChange={(e) => setType(e.target.value)} aria-label={t('site.lp.filterType')}>
          <option value="">{t('site.lp.filterType')}</option>
          {t('site.lp.typeOptions').map((label, i) => <option key={label} value={TYPE_VALUES[i]}>{label}</option>)}
        </select>
        <select className="lp-pill" value={band} onChange={(e) => setBand(e.target.value)} aria-label={t('site.lp.filterValue')}>
          <option value="">{t('site.lp.filterValue')}</option>
          {t('site.lp.valueOptions').map((label, i) => <option key={label} value={i}>{label}</option>)}
        </select>
        <button type="button" className="lp-pill lp-pill-btn" onClick={() => runSearch()}>
          <SlidersHorizontal size={16} />{t('site.lp.moreFilters')}
        </button>
      </div>
      <div className="lp-popular">
        <span>{t('site.lp.popularLabel')}</span>
        <ul>{t('site.lp.popular').map((term) => <li key={term}><button type="button" onClick={() => { setQ(term); runSearch(term); }}>{term}</button></li>)}</ul>
      </div>
    </div>
  );
}

/** A section heading: eyebrow kicker plus a two-tone serif title, matching the reference. */
function Heading({ id, kicker, a, b, sub, action }) {
  return (
    <header className="lp-head">
      <div>
        <p className="lp-eyebrow">{kicker}</p>
        <h2 id={id}>{a}{b && <> <span>{b}</span></>}</h2>
        {sub && <p className="lp-head-sub">{sub}</p>}
      </div>
      {action}
    </header>
  );
}

/** A single tender row. Live synthetic samples come from the public table; otherwise labelled illustrations. */
function TenderCard({ item, lang, t, tone }) {
  const title = (item.title || '').replace(/^\[sample\]\s*/i, '');
  const value = item.estimated_value ?? item.value;
  return (
    <Link to="/login" className="lp-tender">
      <div className="lp-tender-top">
        <span className={`lp-chip lp-tone-${tone}`}>{item.department || t('common.unavailable')}</span>
        {item.submission_deadline && <span className="lp-deadline"><CalendarDays size={13} />{t('site.lp.deadline')}: {formatDate(item.submission_deadline, lang)}</span>}
      </div>
      <h3>{title}</h3>
      <ul className="lp-tender-meta">
        {item.state && <li><MapPin size={15} />{item.state}</li>}
        <li><IndianRupee size={15} />{value != null ? formatInr(value) : t('site.lp.valueNA')}</li>
        {item.tender_no && <li><FileText size={15} />{t('site.lp.refNo')}: {item.tender_no}</li>}
      </ul>
      <div className="lp-tender-foot">
        <span className="lp-sample">{t('site.lp.sample')}{!item.submission_deadline && ` · ${t('site.lp.noDeadline')}`}</span>
        <ArrowRight size={18} aria-hidden="true" />
      </div>
    </Link>
  );
}

export default function Home() {
  const { t, lang } = useI18n();
  const site = useSiteConfig();
  const wantsLive = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(wantsLive);
  const [showFlow, setShowFlow] = useState(false);
  const [showDepts, setShowDepts] = useState(false);
  useEffect(() => {
    if (!wantsLive) return undefined;
    let active = true;
    import('../../lib/supabase.js').then(({ getSampleTenders }) => getSampleTenders())
      .then((rows) => { if (active) setSamples(rows); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [wantsLive]);
  const tenders = (samples.length ? samples : t('site.lp.samples')).slice(0, 3);
  const waHref = useMemo(() => whatsappHref(site.whatsappNumber, t('site.waText', { service: t('site.brand') })), [site.whatsappNumber, t]);
  useSeo({ title: t('site.seo.homeTitle'), description: t('site.seo.homeDesc'), path: '/' });

  return (
    <div className="site-home lp">
      <div className="lp-bg" aria-hidden="true" />

      {/* ---- Hero ---- */}
      <section className="lp-hero" aria-labelledby="hero-title">
        <div className="site-wrap">
          <p className="lp-kicker">{t('site.lp.heroKicker')}</p>
          <h1 id="hero-title">{t('site.lp.heroLine1')} <span>{t('site.lp.heroLine2')}</span></h1>
          <p className="lp-lead">{t('site.lp.heroBody')}</p>
          <HeroSearch />
          <div className="lp-cta">
            <a className="btn btn-blue" href="#access">{t('site.lp.ctaAccess')} <ArrowRight size={16} /></a>
            <Link className="btn btn-light" to="/services">{t('site.lp.ctaServices')} <ArrowRight size={16} /></Link>
          </div>
          <ul className="lp-stat-strip">
            {t('site.lp.stats').map((s, i) => { const Icon = STAT_ICONS[i]; return (
              <li key={s.label}><span className="lp-stat-ico"><Icon size={22} /></span><span><b>{s.n}</b><small>{s.label}</small></span></li>
            ); })}
          </ul>
        </div>
      </section>

      {/* ---- Latest tenders ---- */}
      <section className="lp-section" aria-labelledby="tenders-title">
        <div className="site-wrap">
          <Heading id="tenders-title" kicker={t('site.lp.tendersKicker')} a={t('site.lp.tendersTitle')} sub={t('site.lp.tendersSub')}
            action={<Link className="lp-link" to="/login">{t('site.lp.tendersAll')} <ArrowRight size={16} /></Link>} />
          <div className="lp-tender-grid" aria-busy={loading}>
            {loading
              ? [0, 1, 2].map((i) => <div key={i} className="lp-tender lp-skeleton" aria-hidden="true"><i /><i /><i /><i /></div>)
              : tenders.map((item, i) => <TenderCard key={item.id || item.title} item={item} lang={lang} t={t} tone={i % 3} />)}
          </div>
        </div>
      </section>

      {/* ---- Our Services ---- */}
      <section className="lp-section" aria-labelledby="services-title">
        <div className="site-wrap">
          <Heading id="services-title" kicker={t('site.lp.servicesKicker')} a={t('site.lp.servicesTitle1')} b={t('site.lp.servicesTitle2')}
            sub={t('site.lp.servicesSub', { n: SERVICE_COUNT, g: GROUPS.length })}
            action={<Link className="lp-link" to="/services">{t('site.lp.servicesAll')} <ArrowRight size={16} /></Link>} />
          <div className="lp-service-grid">
            {GROUPS.map((g, i) => { const Icon = SERVICE_ICONS[i]; const card = t('site.lp.serviceCards')[i]; return (
              <Link key={g.slug} to={`/services/${g.slug}`} className="lp-service">
                <span className={`lp-ico lp-ico-${i}`}><Icon size={24} strokeWidth={1.8} /></span>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
                <span className="lp-service-arrow"><ArrowRight size={18} /></span>
              </Link>
            ); })}
          </div>
        </div>
      </section>

      {/* ---- Portal ---- */}
      <section className="lp-portal" aria-labelledby="portal-title">
        <div className="site-wrap lp-portal-grid">
          <div>
            <p className="lp-eyebrow">{t('site.lp.portalKicker')}</p>
            <h2 id="portal-title">{t('site.lp.portalTitle')}</h2>
            <p className="lp-portal-body">{t('site.lp.portalBody')}</p>
            <ul className="lp-checks">
              {t('site.portalPoints').map((point, i) => { const Icon = PORTAL_ICONS[i]; return <li key={point}><span><Icon size={17} /></span>{point}</li>; })}
            </ul>
            <div className="lp-cta">
              <a className="btn btn-blue" href="#access">{t('site.lp.ctaAccess')} <ArrowRight size={16} /></a>
              <Link className="btn btn-light" to="/login">{t('site.ctaPortal')}</Link>
            </div>
          </div>
          <div className="lp-preview"><PortalPreview /></div>
        </div>
      </section>

      {/* ---- How we help ---- */}
      <section className="lp-section" aria-labelledby="process-title">
        <div className="site-wrap">
          <Heading id="process-title" kicker={t('site.lp.helpKicker')} a={t('site.lp.processTitle')} sub={t('site.lp.processSub')}
            action={<button type="button" className="lp-link" aria-expanded={showFlow} aria-controls="flow-panel" onClick={() => setShowFlow(!showFlow)}>{showFlow ? t('site.lp.processHide') : t('site.lp.processAll')} <ArrowRight size={16} /></button>} />
          <ol className="lp-steps">
            {t('site.lp.steps').map((step, i) => (
              <li key={step.title}><span className="lp-step-num">{i + 1}</span><h3>{step.title}</h3><p>{step.body}</p></li>
            ))}
          </ol>
          <div id="flow-panel" className="lp-expand" hidden={!showFlow}>
            {showFlow && <div className="lp-panel"><h3>{t('site.flowTitle')}</h3><p className="lp-head-sub">{t('site.flowSub')}</p><FlowChart /></div>}
          </div>
        </div>
      </section>

      {/* ---- About ---- */}
      <section className="lp-section" aria-labelledby="about-title">
        <div className="site-wrap">
          <div className="lp-about-intro">
            <p className="lp-eyebrow">{t('site.lp.aboutKicker')}</p>
            <h2 id="about-title">{t('site.lp.aboutTitle1')} <span>{t('site.lp.aboutTitle2')}</span></h2>
            <p className="lp-lead lp-about-lead">{t('site.lp.aboutBody')}</p>
          </div>
          <div className="lp-about-grid">
            {t('site.lp.aboutCards').map((card, i) => { const Icon = ABOUT_ICONS[i]; return (
              <article key={card.title} className="lp-about-card"><span className="lp-ico lp-ico-soft"><Icon size={24} strokeWidth={1.7} /></span><h3>{card.title}</h3><p>{card.body}</p></article>
            ); })}
          </div>
          <ul className="lp-about-stats">
            {t('site.lp.aboutStats').map((s, i) => { const Icon = [FileText, MapPin, Landmark][i]; return (
              <li key={s.label}><span className="lp-stat-ico"><Icon size={22} /></span><span><b>{s.n}</b><small>{s.label}</small></span></li>
            ); })}
          </ul>
        </div>
      </section>

      {/* ---- Departments ---- */}
      <section className="lp-section" aria-labelledby="dept-title">
        <div className="site-wrap">
          <Heading id="dept-title" kicker={t('site.lp.deptKicker')} a={t('site.lp.deptTitle')} sub={t('site.lp.deptSub')}
            action={<button type="button" className="lp-link" aria-expanded={showDepts} aria-controls="dept-panel" onClick={() => setShowDepts(!showDepts)}>{showDepts ? t('site.lp.deptHide') : t('site.lp.deptAll')} <ArrowRight size={16} /></button>} />
          <ul className="lp-dept-grid">
            {t('site.lp.depts').map((name, i) => { const Icon = DEPT_ICONS[i]; return <li key={name}><Icon size={26} strokeWidth={1.5} /><span>{name}</span></li>; })}
          </ul>
          <div id="dept-panel" className="lp-expand" hidden={!showDepts}>
            <ul className="lp-dept-wall">{DEPARTMENTS.map((d) => <li key={d}>{d}</li>)}</ul>
          </div>
          <p className="lp-note">{t('site.deptNote')}</p>
        </div>
      </section>

      {/* ---- Contact ---- */}
      <section className="lp-section" aria-labelledby="contact-title">
        <div className="site-wrap">
          <div className="lp-about-intro">
            <p className="lp-eyebrow">{t('site.lp.contactKicker')}</p>
            <h2 id="contact-title">{t('site.lp.contactTitle1')} <span>{t('site.lp.contactTitle2')}</span></h2>
            <p className="lp-lead lp-about-lead">{t('site.lp.contactSub')}</p>
          </div>
          <div className="lp-contact-grid">
            <div className="lp-contact-cards">
              <a className="lp-contact-card" href={telHref(site.phone)}>
                <span className="lp-ico lp-ico-soft"><Phone size={22} /></span>
                <div><b>{t('site.lp.cPhone')}</b><small>{t('site.lp.cPhoneSub')}</small><strong>{site.phone}</strong><span className="lp-dot">{t('site.lp.hours')}</span></div>
              </a>
              <a className="lp-contact-card" href={`mailto:${site.email}`}>
                <span className="lp-ico lp-ico-soft"><Mail size={22} /></span>
                <div><b>{t('site.lp.cEmail')}</b><small>{t('site.lp.cEmailSub')}</small><strong>{site.email}</strong><span className="lp-dot lp-dot-blue">{t('site.lp.cEmailNote')}</span></div>
              </a>
              <div className="lp-contact-card">
                <span className="lp-ico lp-ico-soft"><MapPin size={22} /></span>
                <div><b>{t('site.lp.cAddress')}</b><small>{t('site.lp.cAddressSub')}</small><strong>{t('site.lp.address')}</strong></div>
              </div>
              <a className="lp-contact-card" href={waHref} target="_blank" rel="noopener noreferrer">
                <span className="lp-ico lp-ico-green"><MessageCircle size={22} /></span>
                <div><b>{t('site.lp.cWhatsapp')}</b><small>{t('site.lp.cWhatsappSub')}</small><strong>{site.phone}</strong><span className="lp-dot">{t('site.lp.hours')}</span></div>
              </a>
            </div>
            <aside className="lp-location">
              <div className="lp-location-head"><MapPin size={18} /><div><b>{t('site.lp.ourLocation')}</b><small>{t('site.city')}</small></div></div>
              <div className="lp-location-body">
                <div className="lp-location-org"><span className="lp-ico lp-ico-soft"><Landmark size={22} /></span><div><b>{t('site.brand')}</b><small>{t('site.lp.address')}</small></div></div>
                <ul className="lp-location-facts">
                  <li><Clock size={16} /><b>{t('site.lp.officeHours')}</b><span>{t('site.lp.hours')}</span></li>
                  <li><Navigation size={16} /><b>{t('site.lp.primeLocation')}</b><span>{t('site.lp.primeLocationSub')}</span></li>
                  <li><ShieldCheck size={16} /><b>{t('site.lp.easyAccess')}</b><span>{t('site.lp.easyAccessSub')}</span></li>
                </ul>
              </div>
            </aside>
          </div>
          <div className="lp-cta">
            <a className="btn btn-blue" href="#access">{t('site.lp.cCallback')} <ArrowRight size={16} /></a>
            <a className="btn btn-light" href={`mailto:${site.email}`}>{t('site.lp.cEmailBtn')} <ArrowRight size={16} /></a>
          </div>
        </div>
      </section>

      {/* ---- Request access ---- */}
      <section className="lp-section lp-access" id="access" aria-labelledby="access-title">
        <div className="site-wrap">
          <div className="lp-about-intro">
            <p className="lp-eyebrow">{t('site.lp.getStarted')}</p>
            <h2 id="access-title">{t('site.lp.accessTitle1')} <span>{t('site.lp.accessTitle2')}</span></h2>
            <p className="lp-lead lp-about-lead">{t('site.lp.accessSub')}</p>
          </div>
          <div className="lp-access-grid">
            <div className="lp-panel lp-form-panel">
              <div className="lp-form-head"><span className="lp-ico lp-ico-soft"><Mail size={22} /></span><div><h3>{t('site.lp.formTitle')}</h3><p>{t('site.lp.formSub')}</p></div></div>
              <EnquiryForm idPrefix="home" service={ACCESS_SERVICE} kind="access_request" sendLabel={t('site.lp.submit')} rich />
            </div>
            <aside className="lp-side">
              {t('site.lp.sideCards').map((card, i) => { const Icon = SIDE_ICONS[i]; const isHelp = i === 2; return (
                <div key={card.title} className="lp-side-card">
                  <span className={`lp-ico ${isHelp ? 'lp-ico-green' : 'lp-ico-soft'}`}><Icon size={20} /></span>
                  <div><b>{card.title}</b><p>{card.body}</p>{isHelp && <a className="lp-side-phone" href={telHref(site.phone)}>{site.phone}</a>}</div>
                </div>
              ); })}
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
}
