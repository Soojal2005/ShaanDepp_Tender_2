import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Search } from 'lucide-react';
import { describe } from '../../content/serviceDescriptions.js';
import { GROUPS, findGroup, findItem, itemsOf, leadFor } from '../../content/services.js';
import { useI18n } from '../../i18n/index.jsx';
import EnquiryForm, { ContactButtons } from '../../site/EnquiryForm.jsx';
import { useSeo } from '../../site/hooks.js';
import { GROUP_ICONS } from './Home.jsx';
import { SiteNotFound } from './Info.jsx';

/** One service in the two-column list: name, one-line description, arrow. */
function ServiceRow({ g, i, L, lang, showGroup }) {
  return (
    <li>
      <Link className="svb-item" to={`/services/${g.slug}/${i.slug}`}>
        <span>
          <b>{i[L]}</b>
          <small>{showGroup ? `${g.title[L]} · ` : ''}{describe(g.slug, i.slug, lang)}</small>
        </span>
        <ArrowRight size={20} aria-hidden="true" />
      </Link>
    </li>
  );
}

/**
 * Our services: the groups down a teal sidebar, the chosen group's services in two columns on white.
 * The group lives in the URL (?group=…) so it can be shared and the back button works. Search covers
 * every group, by name or description.
 */
export function ServicesIndex() {
  const { t, lang } = useI18n();
  const L = lang === 'HI' ? 'hi' : 'en';
  const [params] = useSearchParams();
  const [text, setText] = useState('');
  useSeo({ title: t('site.seo.servicesTitle'), description: t('site.servicesSub'), path: '/services' });
  const active = findGroup(params.get('group')) ?? GROUPS[0];
  // On phones the groups are a sideways strip: keep the chosen one in view.
  const strip = useRef(null);
  useEffect(() => {
    const ul = strip.current; const on = ul?.querySelector('.is-on');
    if (ul && on && ul.scrollWidth > ul.clientWidth) ul.scrollLeft = on.offsetLeft - (ul.clientWidth - on.offsetWidth) / 2;
  }, [active.slug]);
  const needle = text.trim().toLowerCase();
  const matches = useMemo(() => (needle
    ? GROUPS.flatMap((g) => itemsOf(g)
      .filter((i) => `${i.en} ${i.hi} ${describe(g.slug, i.slug, 'EN')} ${describe(g.slug, i.slug, 'HI')}`.toLowerCase().includes(needle))
      .map((i) => ({ g, i })))
    : []), [needle]);

  return (
    <div className="svb">
      <div className="svb-frame">
        <div className="svb-head">
          <h1>{t('site.servicesPageTitle')}</h1>
          <label className="svb-search">
            <Search size={20} aria-hidden="true" />
            <input type="search" aria-label={t('site.search')} placeholder={t('site.search')} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        </div>
        <nav className="svb-side" aria-label={t('site.servicesPageTitle')}>
          <ul ref={strip}>
            {GROUPS.map((g) => {
              const Icon = GROUP_ICONS[g.icon];
              const on = !needle && g === active;
              return (
                <li key={g.slug}>
                  <Link to={{ search: `?group=${g.slug}` }} replace className={on ? 'is-on' : undefined} aria-current={on ? 'page' : undefined} onClick={() => setText('')}>
                    <Icon size={22} strokeWidth={1.6} aria-hidden="true" /><span>{g.title[L]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <section className="svb-body" aria-live="polite">
          {needle ? (
            <>
              <h2>{t('site.search')}: “{text.trim()}”</h2>
              {matches.length === 0
                ? <p className="svb-empty">{t('site.noMatch')}</p>
                : <ul className="svb-list">{matches.map(({ g, i }) => <ServiceRow key={`${g.slug}/${i.slug}`} g={g} i={i} L={L} lang={lang} showGroup />)}</ul>}
            </>
          ) : (
            <>
              <h2><Link to={`/services/${active.slug}`}>{active.title[L]}</Link></h2>
              <ul className="svb-list">{itemsOf(active).map((i) => <ServiceRow key={i.slug} g={active} i={i} L={L} lang={lang} />)}</ul>
            </>
          )}
        </section>
      </div>
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
