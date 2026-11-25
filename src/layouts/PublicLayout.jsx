import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ArrowUpRight, Globe, Mail, MapPin, Menu, MessageCircle, Phone, X } from 'lucide-react';
import LangPill from '../components/LangPill.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { GROUPS } from '../content/services.js';
import { useI18n } from '../i18n/index.jsx';
import { telHref, useSiteConfig, whatsappHref } from '../site/hooks.js';


export default function PublicLayout() {
  const { t, lang } = useI18n();
  const { status } = useAuth();
  const authed = status === 'authenticated';
  const site = useSiteConfig();
  const L = lang === 'HI' ? 'hi' : 'en';
  const [open, setOpen] = useState(false);
  const { pathname, hash } = useLocation();
  // The header slides away while scrolling down and returns on any scroll up.
  // On the home page it is transparent over the hero and teal glass once scrolled.
  const isHome = pathname === '/';
  // Pages that open on a full-bleed teal panel: the header floats over it, transparent until scrolled.
  const isLanding = isHome || pathname === '/get-started';
  const [atTop, setAtTop] = useState(true);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setAtTop(y < 24);
      if (Math.abs(y - lastY) < 6) return; // ignore jitter
      setHidden(y > lastY && y > 120);
      lastY = y;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // On a hash link (e.g. /#services) scroll to that home section — retrying a
  // few times because the home page is lazy-loaded and may not be mounted yet.
  useEffect(() => {
    setOpen(false);
    if (hash) {
      const id = hash.slice(1);
      let tries = 0;
      const tryScroll = () => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else if (tries++ < 12) setTimeout(tryScroll, 60);
      };
      tryScroll();
    } else {
      window.scrollTo(0, 0);
    }
  }, [pathname, hash]);

  // Services/About/Contact scroll to the matching section on the home page.
  // Services opens the services page; About and Contact scroll to their home sections.
  const links = [['/', 'home'], ['/services', 'services'], ['/#about', 'about'], ['/#contact', 'contact']];
  const waHref = whatsappHref(site.whatsappNumber, t('site.waText', { service: t('site.brand') }));
  return (
    <div className={`site ${isLanding ? 'site-landing site-is-home' : ''} ${pathname === '/services' ? 'site-services-index' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      {/* One teal header everywhere: transparent over a landing hero until scrolled, solid elsewhere. */}
      <header className={`site-header is-over-hero ${!isLanding || !atTop ? 'is-scrolled' : ''} ${hidden && !open ? 'is-hidden' : ''}`}>
        <div className="site-wrap site-header-row landing-container">
          <Link to="/" className="site-brand" aria-label={t('site.brand')}>
            <img src="/images/shandeep-mark-transparent.png" alt="" className="site-brand-mark" /><img src="/images/shandeep-name-transparent.png" alt="" className="site-brand-name" />
          </Link>
          <button type="button" className="site-menu-btn" aria-label={t('site.nav.menu')} aria-expanded={open} aria-controls="public-navigation" onClick={() => setOpen(!open)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
          <nav id="public-navigation" className={`site-nav ${open ? 'open' : ''}`} aria-label="Main" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
            <div className="site-nav-links">
              {links.map(([to, key]) => {
                const active = (pathname === '/' && (to === '/' ? !hash : hash === to.slice(1))) || (key === 'services' && pathname.startsWith('/services'));
                return <Link key={to} to={to} className={active ? 'active' : undefined}>{t(`site.nav.${key}`)}</Link>;
              })}
            </div>
            <div className="site-nav-actions">
              <LangPill full />
              {authed
                ? <Link className="btn btn-dark btn-sm" to="/app/dashboard">{t('site.nav.dashboard')} <ArrowUpRight size={16} /></Link>
                : <Link className="btn btn-dark btn-sm" to="/get-started">{t('site.nav.getStarted')} <ArrowUpRight size={16} /></Link>}
            </div>
          </nav>
        </div>
      </header>

      <main id="main"><Outlet /></main>

      <footer className="site-footer">
        {/* Brand and link columns above the Raisina skyline (public/images/wfooter.webp). */}
        <div className="site-footer-sky">
          <div className="site-wrap landing-container site-footer-main">
            <div className="site-footer-brand">
              <Link to="/" className="site-footer-logo" aria-label={t('site.brand')}><img src="/images/shandeep-logo-transparent.png" alt="" /></Link>
              {/* Registration details stay on every page. */}
              <dl className="site-footer-reg">
                <div><dt>{t('site.trustBusiness')}</dt><dd>{site.registration.business}</dd></div>
                <div><dt>{t('site.trustGst')}</dt><dd>{site.registration.gst}</dd></div>
              </dl>
            </div>
            <nav className="site-footer-cols" aria-label="Footer">
              <div>
                <h4>{t('site.lp.colServices')}</h4>
                <ul>{GROUPS.filter((g) => !isLanding || g.slug !== 'funding-assistance').map((g) => <li key={g.slug}><Link to={`/services/${g.slug}`}>{g.title[L]}</Link></li>)}</ul>
              </div>
              <div>
                <h4>{t('site.lp.colCompany')}</h4>
                <ul>
                  <li><Link to="/about">{t('site.lp.companyLinks.about')}</Link></li>
                  <li><Link to="/contact">{t('site.lp.companyLinks.contact')}</Link></li>
                </ul>
                <h4>{t('site.lp.colPortal')}</h4>
                <ul>
                  <li><Link to="/request-access">{t('site.lp.portalLinks.access')}</Link></li>
                  <li><Link to="/login">{t('site.lp.portalLinks.login')}</Link></li>
                </ul>
              </div>
              <div>
                <h4>{t('site.lp.colContact')}</h4>
                <ul className="site-footer-contact">
                  <li><MapPin size={20} aria-hidden="true" /><span>{t('site.officeAddress')}</span></li>
                  <li>
                    <Phone size={20} aria-hidden="true" /><a href={telHref(site.phone)}>{site.phone}</a>
                    <a className="site-footer-wa" href={waHref} target="_blank" rel="noopener noreferrer" aria-label={t('site.lp.whatsapp')}><MessageCircle size={18} /></a>
                  </li>
                  <li><Mail size={20} aria-hidden="true" /><a href={`mailto:${site.email}`}>{site.email}</a></li>
                </ul>
              </div>
            </nav>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="site-footer-bar">
          <div className="site-wrap landing-container site-copy">
            <span>© {new Date().getFullYear()} {t('site.brand')}</span>
            <nav className="site-legal" aria-label="Legal">
              <Link to="/privacy">{t('site.lp.legal.privacy')}</Link>
              <Link to="/terms">{t('site.lp.legal.terms')}</Link>
              <Link to="/disclaimer">{t('site.lp.legal.disclaimer')}</Link>
              <a href="/sitemap.xml">{t('site.lp.legal.sitemap')}</a>
            </nav>
            <LangPill />
          </div>
          <p className="site-wrap landing-container site-footer-note"><Globe size={13} aria-hidden="true" /> {t('site.footerNote')}</p>
        </div>
      </footer>
    </div>
  );
}
