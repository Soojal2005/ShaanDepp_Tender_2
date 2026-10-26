import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/index.jsx';
import { LEGAL, LEGAL_UPDATED, NOTICE_VERSION } from '../../content/legal.js';
import { useSeo, useSiteConfig } from '../../site/hooks.js';

/** One of the legal pages: 'privacy', 'terms' or 'disclaimer'. */
function LegalPage({ doc, path }) {
  const { lang, t } = useI18n();
  const site = useSiteConfig();
  const page = LEGAL[doc];
  const fill = (text) => text
    .replaceAll('{email}', site.email).replaceAll('{phone}', site.phone)
    .replaceAll('{business}', site.registration.business).replaceAll('{gst}', site.registration.gst);
  useSeo({ title: `${page.title} | ${t('site.brand')}`, description: page.intro, path });

  return (
    <div className="site-wrap site-page legal-page">
      <nav className="site-crumbs" aria-label="Breadcrumb"><Link to="/">{t('site.nav.home')}</Link><span>/</span><span>{page.title}</span></nav>
      <h1>{page.title}</h1>
      <p className="legal-meta">{doc === 'privacy' ? `Notice ${NOTICE_VERSION} · ` : ''}Last updated {LEGAL_UPDATED}</p>
      {lang === 'HI' && <p className="note note-info">This page is available in English only.</p>}
      <p className="site-body">{page.intro}</p>
      {page.sections.map((s) => (
        <section key={s.h}>
          <h2>{s.h}</h2>
          {s.p?.map((p) => <p className="site-body" key={p}>{fill(p)}</p>)}
          {s.list && <ul className="legal-list">{s.list.map((item) => <li key={item}>{fill(item)}</li>)}</ul>}
        </section>
      ))}
    </div>
  );
}

export const Privacy = () => <LegalPage doc="privacy" path="/privacy" />;
export const Terms = () => <LegalPage doc="terms" path="/terms" />;
export const Disclaimer = () => <LegalPage doc="disclaimer" path="/disclaimer" />;
