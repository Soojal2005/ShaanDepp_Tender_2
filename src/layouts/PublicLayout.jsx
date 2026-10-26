import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ArrowRight, BarChart3, Globe, Landmark, Mail, MapPin, Menu, MessageCircle, Phone, ShieldCheck, Users, X } from 'lucide-react';
import LangPill from '../components/LangPill.jsx';
import { GROUPS } from '../content/services.js';
import { useI18n } from '../i18n/index.jsx';
import { telHref, useSiteConfig, whatsappHref } from '../site/hooks.js';

const BADGE_ICONS = [ShieldCheck, Users, BarChart3];

export default function PublicLayout() {
  const { t, lang } = useI18n();
  const site = useSiteConfig();
  const L = lang === 'HI' ? 'hi' : 'en';
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [pathname]);

  const links = [['/', 'home', true], ['/services', 'services'], ['/about', 'about'], ['/contact', 'contact']];
  const waHref = whatsappHref(site.whatsappNumber, t('site.waText', { service: t('site.brand') }));
  return (
    <div className={`site ${pathname === '/' ? 'site-landing' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="site-wrap site-header-row">
          <Link to="/" className="site-brand" aria-label={t('site.brand')}>
            <span className="site-logo"><Landmark size={24} /></span>
            <span><b>{t('brand.name')}</b><small>{t('site.brand')}</small></span>
          </Link>
          <button type="button" className="site-menu-btn" aria-label={t('site.nav.menu')} aria-expanded={open} aria-controls="public-navigation" onClick={() => setOpen(!open)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
          <nav id="public-navigation" className={`site-nav ${open ? 'open' : ''}`} aria-label="Main" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
            <div className="site-nav-links">
              {links.map(([to, key, end]) => <NavLink key={to} to={to} end={end}>{t(`site.nav.${key}`)}</NavLink>)}
            </div>
            <div className="site-nav-actions">
              <LangPill />
              <Link className="btn btn-light btn-sm" to="/request-access">{t('site.nav.requestAccess')}</Link>
              <Link className="btn btn-dark btn-sm" to="/login">{t('site.nav.portal')} <ArrowRight size={15} /></Link>
            </div>
          </nav>
        </div>
      </header>

      <main id="main"><Outlet /></main>

      <footer className="site-footer">
        {/* Top: brand + tagline + three columns of real destinations. */}
        <div className="site-wrap site-footer-main">
          <div className="site-footer-brand">
            <Link to="/" className="site-brand light"><span className="site-logo"><Landmark size={24} /></span><span><b>{t('brand.name')}</b><small>{t('site.brand')}</small></span></Link>
            <p className="site-footer-tagline">{t('site.lp.footerTagline1')}<br /><span>{t('site.lp.footerTagline2')}</span></p>
            <p className="site-footer-body">{t('site.lp.footerBody')}</p>
            <ul className="site-footer-badges">
              {t('site.lp.footerBadges').map((b, i) => { const Icon = BADGE_ICONS[i]; return <li key={b}><Icon size={18} />{b}</li>; })}
            </ul>
          </div>
          <nav className="site-footer-cols" aria-label="Footer">
            <div>
              <h4>{t('site.lp.colServices')}</h4>
              <ul>{GROUPS.map((g) => <li key={g.slug}><Link to={`/services/${g.slug}`}>{g.title[L]}</Link></li>)}</ul>
            </div>
            <div>
              <h4>{t('site.lp.colCompany')}</h4>
              <ul>
                <li><Link to="/">{t('site.lp.companyLinks.home')}</Link></li>
                <li><Link to="/about">{t('site.lp.companyLinks.about')}</Link></li>
                <li><Link to="/contact">{t('site.lp.companyLinks.contact')}</Link></li>
                <li><Link to="/privacy">{t('site.lp.companyLinks.privacy')}</Link></li>
                <li><Link to="/terms">{t('site.lp.companyLinks.terms')}</Link></li>
              </ul>
            </div>
            <div>
              <h4>{t('site.lp.colGetStarted')}</h4>
              <ul>
                <li><Link to="/request-access">{t('site.lp.getStartedLinks.access')}</Link></li>
                <li><Link to="/login">{t('site.lp.getStartedLinks.login')}</Link></li>
                <li><Link to="/services">{t('site.lp.getStartedLinks.services')}</Link></li>
              </ul>
            </div>
          </nav>
        </div>

        {/* Contact row */}
        <div className="site-wrap site-footer-contact">
          <a href={telHref(site.phone)}><span className="site-footer-ci"><Phone size={16} /></span><span><small>{t('site.lp.callUs')}</small><b>{site.phone}</b></span></a>
          <a href={waHref} target="_blank" rel="noopener noreferrer"><span className="site-footer-ci site-footer-ci-wa"><MessageCircle size={16} /></span><span><small>{t('site.lp.whatsapp')}</small><b>{site.phone}</b></span></a>
          <a href={`mailto:${site.email}`}><span className="site-footer-ci"><Mail size={16} /></span><span><small>{t('site.lp.email')}</small><b>{site.email}</b></span></a>
          <span className="site-footer-office"><span className="site-footer-ci"><MapPin size={16} /></span><span><small>{t('site.lp.office')}</small><b>{t('site.lp.address')}</b></span></span>
        </div>

        {/* Registration row */}
        <div className="site-wrap">
          <dl className="site-footer-reg">
            <div><dt>{t('site.trustBusiness')}</dt><dd>{site.registration.business}</dd><dd className="site-footer-reg-sub">{t('site.lp.regType')}</dd></div>
            <div><dt>{t('site.trustGst')}</dt><dd>{site.registration.gst}</dd><dd className="site-footer-reg-sub">{t('site.city')}</dd></div>
            <div><dt>{t('site.lp.regAddress')}</dt><dd>{t('site.lp.address')}</dd></div>
            <div className="site-footer-reg-lang"><dt>{t('site.lp.language')}</dt><dd><LangPill /></dd></div>
          </dl>
        </div>

        {/* Bottom bar */}
        <div className="site-wrap site-copy">
          <span>© {new Date().getFullYear()} {t('site.brand')}. {t('site.home.rights')}</span>
          <nav className="site-legal" aria-label="Legal">
            <Link to="/privacy">{t('site.lp.legal.privacy')}</Link>
            <Link to="/terms">{t('site.lp.legal.terms')}</Link>
            <Link to="/disclaimer">{t('site.lp.legal.disclaimer')}</Link>
            <a href="/sitemap.xml">{t('site.lp.legal.sitemap')}</a>
          </nav>
        </div>
        <p className="site-wrap site-footer-note"><Globe size={13} aria-hidden="true" /> {t('site.footerNote')}</p>
      </footer>
    </div>
  );
}
