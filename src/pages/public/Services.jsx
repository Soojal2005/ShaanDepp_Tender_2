import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { GROUPS, findGroup, findItem, itemsOf, leadFor } from '../../content/services.js';
import { useI18n } from '../../i18n/index.jsx';
import EnquiryForm, { ContactButtons } from '../../site/EnquiryForm.jsx';
import { useSeo } from '../../site/hooks.js';
import { GROUP_ICONS } from './Home.jsx';
import { SiteNotFound } from './Info.jsx';

const Crumbs = ({ items }) => (
  <nav className="site-crumbs" aria-label="Breadcrumb">
    {items.map((c, i) => (
      <span key={i}>{i > 0 && <ChevronRight size={12} />}{c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</span>
    ))}
  </nav>
);

export function ServicesIndex() {
  const { t, lang } = useI18n();
  const L = lang === 'HI' ? 'hi' : 'en';
  const [text, setText] = useState('');
  useSeo({ title: t('site.seo.servicesTitle'), description: t('site.servicesSub'), path: '/services' });
  const needle = text.trim().toLowerCase();
  const matches = useMemo(() => (needle
    ? GROUPS.flatMap((g) => itemsOf(g).filter((i) => `${i.en} ${i.hi}`.toLowerCase().includes(needle)).map((i) => ({ g, i })))
    : []), [needle]);
  return (
    <div className="site-wrap site-page">
      <Crumbs items={[{ label: t('site.nav.home'), to: '/' }, { label: t('site.servicesPageTitle') }]} />
      <h1>{t('site.servicesPageTitle')}</h1>
      <p className="site-sub">{t('site.servicesPageSub')}</p>
      <input className="input site-search" type="search" aria-label={t('site.search')} placeholder={t('site.search')} value={text} onChange={(e) => setText(e.target.value)} />
      {needle ? (
        matches.length === 0 ? <p>{t('site.noMatch')}</p> : (
          <ul className="site-result-list">
            {matches.map(({ g, i }) => <li key={`${g.slug}/${i.slug}`}><Link to={`/services/${g.slug}/${i.slug}`}><b>{i[L]}</b><span>{g.title[L]}</span></Link></li>)}
          </ul>
        )
      ) : (
        GROUPS.map((g) => {
          const Icon = GROUP_ICONS[g.icon];
          return (
            <section key={g.slug} className="site-index-group">
              <h2><span className="site-group-icon sm"><Icon size={18} /></span><Link to={`/services/${g.slug}`}>{g.title[L]}</Link></h2>
              <ul className="site-chip-list">
                {itemsOf(g).map((i) => <li key={i.slug}><Link to={`/services/${g.slug}/${i.slug}`}>{i[L]}</Link></li>)}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

export function GroupPage() {
  const { t, lang } = useI18n();
  const L = lang === 'HI' ? 'hi' : 'en';
  const { group: slug } = useParams();
  const g = findGroup(slug);
  useSeo({ title: g ? `${g.title[L]} | ${t('site.brand')}` : t('site.notFoundTitle'), description: g?.summary[L] ?? '', path: `/services/${slug}` });
  if (!g) return <SiteNotFound />;
  return (
    <div className="site-wrap site-page">
      <Crumbs items={[{ label: t('site.nav.home'), to: '/' }, { label: t('site.servicesPageTitle'), to: '/services' }, { label: g.title[L] }]} />
      <h1>{g.title[L]}</h1>
      <p className="site-sub">{g.summary[L]}</p>
      <div className="site-two-col">
        <div>
          <h2>{t('site.groupHow')}</h2>
          <ul className="site-points">{g.how[L].map((p) => <li key={p}>{p}</li>)}</ul>
          <h2>{t('site.groupItems')}</h2>
          <ul className="site-item-grid">
            {itemsOf(g).map((i) => (
              <li key={i.slug}><Link to={`/services/${g.slug}/${i.slug}`}><span>{i[L]}</span><ArrowRight size={14} /></Link></li>
            ))}
          </ul>
        </div>
        <aside className="site-side-card">
          <h2>{t('site.enquire')}</h2>
          <p className="cell-sub">{t('site.enquireHint')}</p>
          <ContactButtons topic={g.title.en} />
          <EnquiryForm service={g.title.en} idPrefix="group" />
        </aside>
      </div>
    </div>
  );
}

export function ServicePage() {
  const { t, lang } = useI18n();
  const L = lang === 'HI' ? 'hi' : 'en';
  const { group: gs, item: is } = useParams();
  const found = findItem(gs, is);
  useSeo({
    title: found ? `${found.item[L]} | ${found.group.title[L]} | ${t('site.brand')}` : t('site.notFoundTitle'),
    description: found ? leadFor(lang, found.item[L], found.group.title[L]) : '',
    path: `/services/${gs}/${is}`,
  });
  if (!found) return <SiteNotFound />;
  const { group, item } = found;
  const others = itemsOf(group).filter((i) => i.slug !== item.slug).slice(0, 8);
  return (
    <div className="site-wrap site-page">
      <Crumbs items={[{ label: t('site.nav.home'), to: '/' }, { label: t('site.servicesPageTitle'), to: '/services' }, { label: group.title[L], to: `/services/${group.slug}` }, { label: item[L] }]} />
      <h1>{item[L]}</h1>
      <p className="site-sub">{t('site.serviceFor', { group: group.title[L] })}</p>
      <div className="site-two-col">
        <div>
          <p className="site-body">{leadFor(lang, item[L], group.title[L])}</p>
          <h2>{t('site.groupHow')}</h2>
          <ul className="site-points">{group.how[L].map((p) => <li key={p}>{p}</li>)}</ul>
          <h2>{t('site.otherServices', { group: group.title[L] })}</h2>
          <ul className="site-chip-list">
            {others.map((i) => <li key={i.slug}><Link to={`/services/${group.slug}/${i.slug}`}>{i[L]}</Link></li>)}
          </ul>
          <p><Link to={`/services/${group.slug}`}>{t('site.backTo', { group: group.title[L] })}</Link></p>
        </div>
        <aside className="site-side-card">
          <h2>{t('site.enquire')}</h2>
          <p className="cell-sub">{t('site.enquireHint')}</p>
          <ContactButtons topic={`${item.en} (${group.title.en})`} />
          <EnquiryForm service={`${group.title.en}: ${item.en}`} idPrefix="service" />
        </aside>
      </div>
    </div>
  );
}
