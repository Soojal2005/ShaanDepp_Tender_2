import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Landmark, Menu, MessageCircle, Phone, X } from 'lucide-react';
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
    <div className="site">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="site-wrap site-header-row">
          <Link to="/" className="site-brand" aria-label={t('site.brand')}>
            <span className="site-logo"><Landmark size={20} /></span>
            <span><b>{t('brand.name')}</b><small>{t('site.brand')}</small></span>
          </Link>
          <button type="button" className="site-menu-btn" aria-label={t('site.nav.menu')} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
          <nav className={`site-nav ${open ? 'open' : ''}`} aria-label="Main">
            {links.map(([to, key, end]) => <NavLink key={to} to={to} end={end}>{t(`site.nav.${key}`)}</NavLink>)}
            <div className="site-nav-actions">
              <LangPill />
              <Link className="btn btn-primary btn-sm" to="/login">{t('site.nav.portal')}</Link>
            </div>
          </nav>
        </div>
      </header>

      <main id="main"><Outlet /></main>

      <footer className="site-footer">
        <div className="site-wrap site-footer-grid">
          <div>
            <div className="site-brand light"><span className="site-logo"><Landmark size={18} /></span><span><b>{t('site.brand')}</b><small>{t('site.city')}</small></span></div>
            <p className="site-footer-note">{t('site.footerNote')}</p>
          </div>
          <div>
            <h4>{t('site.nav.services')}</h4>
            <ul>
              <li><Link to="/services">{t('site.servicesPageTitle')}</Link></li>
              <li><Link to="/about">{t('site.nav.about')}</Link></li>
              <li><Link to="/contact">{t('site.nav.contact')}</Link></li>
              <li><Link to="/login">{t('site.nav.signIn')}</Link></li>
            </ul>
          </div>
          <div>
            <h4>{t('site.nav.contact')}</h4>
            <ul>
              <li><a href={telHref(site.phone)}><Phone size={13} /> {site.phone}</a></li>
              <li><a href={`mailto:${site.email}`}>{site.email}</a></li>
              <li><a href={whatsappHref(site.whatsappNumber, t('site.waText', { service: t('site.brand') }))} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} /> {t('site.nav.whatsapp')}</a></li>
            </ul>
            <p className="site-reg">{t('site.trustBusiness')}: {site.registration.business}<br />{t('site.trustGst')}: {site.registration.gst}</p>
          </div>
        </div>
        <div className="site-wrap site-copy">© {new Date().getFullYear()} {t('site.brand')}</div>
      </footer>
    </div>
  );
}
