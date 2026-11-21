import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Award, BadgeCheck, Bell, Building2, CalendarDays, Check, ChevronDown, ClipboardCheck, ClipboardList, Database, FileSearch, FileText,
  IndianRupee, Landmark, Lightbulb, Mail, MapPin, MessageCircle, Phone, ScrollText, Search, ShieldCheck,
  ShoppingBag, SlidersHorizontal, Tag, TrendingUp, Trophy,
} from 'lucide-react';
import { DEPARTMENTS, GROUPS, SERVICE_COUNT, itemsOf } from '../../content/services.js';
import { useI18n } from '../../i18n/index.jsx';
import { formatDate, formatInr } from '../../lib/format.js';
import EnquiryForm, { ACCESS_SERVICE } from '../../site/EnquiryForm.jsx';
import FlowChart from '../../site/FlowChart.jsx';
import PortalPreview from '../../site/PortalPreview.jsx';
import { telHref, useSeo, useSiteConfig, whatsappHref } from '../../site/hooks.js';

// The services index looks these up by each group's `icon` key, so the names must match content/services.js.
export const GROUP_ICONS = { FileSearch, ShoppingBag, Building2, ClipboardList, BadgeCheck, Landmark, ScrollText, Lightbulb, TrendingUp, Award };

const PORTAL_ICONS = [Bell, Search, Trophy, ClipboardCheck];
const ABOUT_ICONS = [FileSearch, ShieldCheck, ClipboardCheck, MapPin];

// Value bands map to the portal's rupee filters, so the hero search is real, not decorative.
const VALUE_BANDS = [{ valueMax: '1000000' }, { valueMin: '1000000', valueMax: '10000000' }, { valueMin: '10000000' }];
const TYPE_VALUES = ['Works', 'Goods', 'Services'];

/**
 * Service groups as a box of folders. Opening a folder lifts it (and every folder behind it) by the open
 * height, and its sheets fill the space it leaves above the next folder. Folders in front never move, the
 * box keeps one height, and whatever is under the pointer still belongs to the folder it was on, so hover
 * (after a short pause) and tap can both open folders without anything sliding away. The first starts open.
 */
function ServiceFolders({ t, lang }) {
  const [open, setOpen] = useState(0);
  const hoverTimer = useRef(0);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const L = lang === 'HI' ? 'hi' : 'en';
  // Hand-written short titles exist for the original groups; newer groups use their own title.
  const titleOf = (i) => t('site.lp.serviceCards')[i]?.title ?? GROUPS[i].title[L];
  const openNow = (i) => { clearTimeout(hoverTimer.current); setOpen(i); };
  const openSoon = (i) => { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setOpen(i), 120); };

  return (
    <div className="svc-stack">
      {GROUPS.map((g, i) => {
        const isOpen = open === i;
        return (
          <div key={g.slug} className={`svc-folder ${i % 2 ? 'alt' : ''} ${isOpen ? 'is-open' : ''} ${i <= open ? 'is-raised' : ''}`} style={{ '--i': i }}
            onMouseEnter={() => openSoon(i)} onMouseLeave={() => clearTimeout(hoverTimer.current)}>
            <h3 className="svc-tab-h">
              <button type="button" className="svc-tab" id={`svc-tab-${g.slug}`} aria-expanded={isOpen} aria-controls={`svc-${g.slug}`} onClick={() => openNow(i)}>
                <span>{titleOf(i)}</span>
              </button>
            </h3>
            {/* Closed folders keep their sheets in the DOM so they can animate; `inert` keeps their links out of the tab order. */}
            <div className="svc-body" id={`svc-${g.slug}`} role="region" aria-labelledby={`svc-tab-${g.slug}`} {...(isOpen ? {} : { inert: '' })}>
              <div className="svc-sheets">
                <span className="svc-sheet-back is-3" aria-hidden="true" />
                <span className="svc-sheet-back is-2" aria-hidden="true" />
                <span className="svc-sheet-back" aria-hidden="true" />
                <div className="svc-sheet">
                  <ul className="svc-checks">
                    {itemsOf(g).slice(0, 3).map((it) => (
                      <li key={it.slug}><span className="svc-check" aria-hidden="true"><Check size={16} strokeWidth={3} /></span><span className="svc-item">{it[L]}</span></li>
                    ))}
                  </ul>
                  <Link className="svc-explore" to={`/services/${g.slug}`}>{t('site.lp.explore')} <ArrowRight size={18} aria-hidden="true" /></Link>
                </div>
              </div>
              <div className="svc-front" aria-hidden="true" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * "How we help you win": the four steps beside a sample tender printout. Choosing a step highlights the
 * clause that step deals with, on the same sheet; the sheet itself never moves.
 */
function HowWeHelp({ t }) {
  const [step, setStep] = useState(1);
  const [showFlow, setShowFlow] = useState(false);
  const steps = t('site.lp.steps');
  const doc = t('site.lp.tender');
  // Arrow keys move between steps, as in any tab list.
  const onKey = (e) => {
    const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const next = (step + d + steps.length) % steps.length;
    setStep(next);
    document.getElementById(`how-step-${next}`)?.focus();
  };
  return (
    <section className="lp-how" aria-labelledby="process-title">
      <div className="site-wrap">
        <p className="lp-how-kicker">{t('site.lp.helpKicker')}</p>
        <h2 id="process-title">{t('site.lp.processPre')}<span className="lp-how-mark">{t('site.lp.processMark')}</span>{t('site.lp.processPost')}</h2>
        <div className="lp-how-grid">
          <div className="lp-how-side">
            <div className="lp-how-steps" role="tablist" aria-orientation="vertical" aria-labelledby="process-title" onKeyDown={onKey}>
              {steps.map((s, i) => (
                <button key={s.title} type="button" role="tab" id={`how-step-${i}`} aria-selected={i === step} aria-controls="tender-sheet"
                  tabIndex={i === step ? 0 : -1} className={i === step ? 'is-active' : undefined} onClick={() => setStep(i)}>
                  {s.title}
                </button>
              ))}
            </div>
            <p className="lp-how-body">{steps[step].body}</p>
            <button type="button" className="lp-how-more" aria-expanded={showFlow} aria-controls="flow-panel" onClick={() => setShowFlow(!showFlow)}>
              {showFlow ? t('site.lp.processHide') : t('site.lp.processAll')} <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
          <article className="tp-paper" id="tender-sheet" role="tabpanel" aria-labelledby={`how-step-${step}`}>
            <h3 className="tp-head">{doc.title}</h3>
            {doc.clauses.map((c, i) => (
              <p key={c.label} className={`tp-clause ${i === step ? 'is-on' : ''}`}>
                <span className="tp-note"><span>{c.note}</span></span>
                <b>{c.label}</b> {c.before}<span className="tp-mark">{c.mark}</span>{c.after}
              </p>
            ))}
          </article>
        </div>
        <div id="flow-panel" className="lp-expand" hidden={!showFlow}>
          {showFlow && <div className="lp-panel"><h3>{t('site.flowTitle')}</h3><p className="lp-head-sub">{t('site.flowSub')}</p><FlowChart /></div>}
        </div>
      </div>
    </section>
  );
}

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
        <button type="submit" className="btn lp-search-btn">{t('site.lp.searchBtn')}</button>
      </form>
      <div className="lp-search-filters">
        <label className="lp-pill">
          <Tag size={17} aria-hidden="true" />
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('site.lp.filterType')}>
            <option value="">{t('site.lp.filterType')}</option>
            {t('site.lp.typeOptions').map((label, i) => <option key={label} value={TYPE_VALUES[i]}>{label}</option>)}
          </select>
        </label>
        <label className="lp-pill">
          <Database size={17} aria-hidden="true" />
          <select value={band} onChange={(e) => setBand(e.target.value)} aria-label={t('site.lp.filterValue')}>
            <option value="">{t('site.lp.filterValue')}</option>
            {t('site.lp.valueOptions').map((label, i) => <option key={label} value={i}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="lp-pill lp-pill-btn" onClick={() => runSearch()}>
          <SlidersHorizontal size={17} aria-hidden="true" />{t('site.lp.moreFilters')}<ChevronDown size={16} aria-hidden="true" />
        </button>
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
  // Reveal cards and the folder stack when they scroll into view.
  // Re-runs when live samples arrive so their freshly-rendered cards get observed too.
  useEffect(() => {
    const els = document.querySelectorAll('.svc-stack, .lp-tender, .lp-service, .lp-about-card, .lp-contact-card, .lp-dept-grid li');
    if (!els.length) return undefined;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in-view'); io.unobserve(e.target); } });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [samples]);
  const tenders = (samples.length ? samples : t('site.lp.samples')).slice(0, 3);
  const waHref = useMemo(() => whatsappHref(site.whatsappNumber, t('site.waText', { service: t('site.brand') })), [site.whatsappNumber, t]);
  useSeo({ title: t('site.seo.homeTitle'), description: t('site.seo.homeDesc'), path: '/' });

  return (
    <div className="site-home lp">
      <div className="lp-bg" aria-hidden="true" />

      {/* ---- Hero: teal civic illustration (desktop / mobile art in public/images) ---- */}
      <section className="lp-hero" aria-labelledby="hero-title">
        <div className="site-wrap">
          <h1 id="hero-title">{t('site.lp.heroLine1')} <span>{t('site.lp.heroLine2')}</span></h1>
          <p className="lp-lead">{t('site.lp.heroBody')}</p>
          <HeroSearch />
        </div>
      </section>

      {/* ---- Our Services ---- */}
      <section id="services" className="lp-svc" aria-labelledby="services-title">
        <div className="site-wrap lp-svc-grid">
          <div className="lp-svc-head">
            <h2 id="services-title">{t('site.lp.servicesTitle1')} <span>{t('site.lp.servicesTitle2')}</span></h2>
            <Link className="lp-svc-all" to="/services">{t('site.lp.servicesAll', { n: SERVICE_COUNT })} <ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
          <div className="lp-svc-right">
            <ServiceFolders t={t} lang={lang} />
            {/* Key figures as a quiet row under the folders. The services count comes from the catalogue. */}
            <ul className="lp-svc-stats">
              {t('site.lp.stats').map((s) => <li key={s.label}><b>{s.n ?? SERVICE_COUNT}</b><small>{s.label}</small></li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* ---- How we help ---- */}
      <HowWeHelp t={t} />

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


      {/* ---- About ---- */}
      <section id="about" className="lp-section" aria-labelledby="about-title">
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
              <li key={s.label}><span className="lp-stat-ico"><Icon size={22} /></span><span><b>{s.n ?? SERVICE_COUNT}</b><small>{s.label}</small></span></li>
            ); })}
          </ul>
        </div>
      </section>

      {/* ---- Departments: the list beside a big count, over the civic buildings ---- */}
      <section className="lp-dept2" aria-labelledby="dept-title">
        <div className="site-wrap">
          <div className="lp-dept2-copy">
            <h2 id="dept-title">{t('site.lp.deptTitle')}</h2>
            <ul className="lp-dept2-list">{t('site.lp.depts').map((name) => <li key={name}>{name}</li>)}</ul>
            <button type="button" className="lp-dept2-all" aria-expanded={showDepts} aria-controls="dept-panel" onClick={() => setShowDepts(!showDepts)}>
              {showDepts ? t('site.lp.deptHide') : t('site.lp.deptAll')} <ArrowRight size={18} aria-hidden="true" />
            </button>
            <div id="dept-panel" className="lp-dept2-panel" hidden={!showDepts}>
              <ul className="lp-dept-wall">{DEPARTMENTS.map((d) => <li key={d}>{d}</li>)}</ul>
              <p className="lp-dept2-note">{t('site.deptNote')}</p>
            </div>
          </div>
        </div>
        {/* The illustration box keeps the image's proportions, so the count stays in the same spot on the art.
            The count is lighten-blended, so the bright facades stay in front of it. */}
        <div className="lp-dept2-art" aria-hidden="true"><span>{t('site.lp.depts').length}</span></div>
      </section>

      {/* ---- Contact: details on the left, Bhopal on the map ---- */}
      <section id="contact" className="lp-touch" aria-labelledby="contact-title">
        <div className="lp-touch-map" aria-hidden="true"><span className="lp-touch-pin">{t('site.lp.mapCity')}</span></div>
        <div className="site-wrap">
          <h2 id="contact-title">{t('site.lp.contactHeading')}</h2>
          <ul className="lp-touch-list">
            <li>
              <span className="lp-touch-ico">
                <a href={telHref(site.phone)} aria-label={t('site.lp.callUs')}><Phone size={30} strokeWidth={1.6} /></a>
                <a href={waHref} target="_blank" rel="noopener noreferrer" aria-label={t('site.lp.whatsapp')}><MessageCircle size={30} strokeWidth={1.6} /></a>
              </span>
              <div><b>{t('site.lp.cCallWa')}</b><a href={telHref(site.phone)}>{site.phone}</a></div>
            </li>
            <li>
              <span className="lp-touch-ico"><Mail size={32} strokeWidth={1.6} aria-hidden="true" /></span>
              <div><b>{t('site.lp.email')}</b><a href={`mailto:${site.email}`}>{site.email}</a></div>
            </li>
            <li>
              <span className="lp-touch-ico"><MapPin size={32} strokeWidth={1.6} aria-hidden="true" /></span>
              <div><b>{t('site.lp.cOffice')}</b><span>{t('site.city')}</span></div>
            </li>
          </ul>
          <a className="lp-touch-btn" href="#access">{t('site.lp.cCallback')}</a>
        </div>
      </section>

      {/* ---- Request access: Parliament on the left, the form on white ---- */}
      <section className="lp-access2" id="access" aria-labelledby="access-title">
        <div className="lp-access2-side">
          <h2 id="access-title">{t('site.lp.accessTitle1')} <span>{t('site.lp.accessTitle2')}</span></h2>
        </div>
        <div className="lp-access2-form">
          <EnquiryForm idPrefix="home" service={ACCESS_SERVICE} kind="access_request" sendLabel={t('site.lp.submit')} rich />
        </div>
      </section>
    </div>
  );
}
