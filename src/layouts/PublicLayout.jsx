import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ArrowRight, Landmark, Menu, MessageCircle, Phone, X } from 'lucide-react';
import LangPill from '../components/LangPill.jsx';
import { useI18n } from '../i18n/index.jsx';
import { telHref, useSiteConfig, whatsappHref } from '../site/hooks.js';

export default function PublicLayout() {
  const { t } = useI18n();
  const site = useSiteConfig();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [pathname]);

  const links = [['/', 'home', true], ['/services', 'services'], ['/about', 'about'], ['/contact', 'contact']];
  return (
    <div className={`site ${pathname === '/' ? 'site-home-shell' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="site-wrap site-header-row">
          <Link to="/" className="site-brand" aria-label={t('site.brand')}>
            <span className="site-logo"><Landmark size={20} /></span>
            <span><b>{t('brand.name')}</b><small>{t('site.brand')}</small></span>
          </Link>
          <button type="button" className="site-menu-btn" aria-label={t('site.nav.menu')} aria-expanded={open} aria-controls="public-navigation" onClick={() => setOpen(!open)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
          <nav id="public-navigation" className={`site-nav ${open ? 'open' : ''}`} aria-label="Main" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
            {links.map(([to, key, end]) => <NavLink key={to} to={to} end={end}>{t(`site.nav.${key}`)}</NavLink>)}
            <div className="site-nav-actions">
              <LangPill />
              <Link className="btn btn-primary btn-sm" to="/login">{t('site.nav.portal')} <ArrowRight size={16} /></Link>
            </div>
          </nav>
        </div>
      </header>

      <main id="main"><Outlet /></main>

      <footer className="site-footer">
        <div className="site-wrap">
          <div className="site-footer-top">
            <Link to="/" className="site-brand light"><span className="site-logo"><Landmark size={29} /></span><span><b>{t('brand.name')}</b><small>{t('site.brand')}</small></span></Link>
            <nav className="site-footer-nav" aria-label="Footer">{links.map(([to, key]) => <Link key={to} to={to}>{t(`site.nav.${key}`)}</Link>)}</nav>
            <LangPill />
          </div>
          <div className="site-footer-contact"><span>{t('site.city')}</span><a href={telHref(site.phone)}><Phone size={12} />{site.phone}</a><a href={`mailto:${site.email}`}>{site.email}</a><a href={whatsappHref(site.whatsappNumber, t('site.waText', { service: t('site.brand') }))} target="_blank" rel="noopener noreferrer"><MessageCircle size={12} />{t('site.nav.whatsapp')}</a></div>
          <p className="site-footer-registration">{t('site.trustBusiness')}: {site.registration.business}<span> · </span>{t('site.trustGst')}: {site.registration.gst}<span> · </span><Link to="/login">{t('site.nav.signIn')}</Link></p>
          <div className="site-copy"><span>© {new Date().getFullYear()} {t('site.brand')}. {t('site.home.rights')}</span><a href="/sitemap.xml">{t('site.home.sitemap')}</a></div>
          <p className="site-footer-note">{t('site.footerNote')}</p>
        </div>
      </footer>
    </div>
  );
}
