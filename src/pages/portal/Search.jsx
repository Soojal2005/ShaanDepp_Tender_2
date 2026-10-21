import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, Bookmark, Download, SlidersHorizontal, Trash2 } from 'lucide-react';
import TenderCard from '../../components/tender/TenderCard.jsx';
import TenderDrawer from '../../components/tender/TenderDrawer.jsx';
import { useToast } from '../../components/Toast.jsx';
import { Button, Empty, ErrorNote, Field, Loading, Modal, PageHeader } from '../../components/ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { EMPTY_FILTERS, activeFilterCount, filtersFrom, lakhToRupees, rupeesToLakh, toParams, toQuery } from '../../lib/filters.js';
import { useAction, useAsync } from '../../lib/hooks.js';

const PAGE_SIZE = 20;
const SCOPES = ['title', 'description', 'boq'];

function FacetGroup({ title, items, selected, onToggle, extra }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const known = new Map(items.map((i) => [i.id, i]));
  // Always show what is selected, even if the current results no longer include it.
  const rows = [...items, ...selected.filter((id) => !known.has(id)).map((id) => ({ id, label: extra?.labelOf(id) ?? `#${id}`, count: 0 }))];
  const shown = expanded ? rows : rows.slice(0, 6);
  return (
    <div className="facet-filter-group">
      <div className="facet-group-label-row"><span>{title}</span></div>
      <div className="facet-group-body">
        {shown.length === 0 && <span className="cell-sub">-</span>}
        {shown.map((item) => (
          <label key={item.id} className="facet-checkbox-row">
            <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
              <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
            </span>
            <span className="facet-badge-counter tabular-nums">{item.count}</span>
          </label>
        ))}
        {rows.length > 6 && (
          <button type="button" className="facet-show-more-link" onClick={() => setExpanded(!expanded)}>{expanded ? t('search.showLess') : t('search.showMore')}</button>
        )}
        {extra && (
          <select className="select" style={{ height: 32, fontSize: 12 }} value="" aria-label={title}
            onChange={(e) => { if (e.target.value) onToggle(Number(e.target.value)); }}>
            <option value="">+ {title}</option>
            {extra.options.filter((o) => !selected.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

function SaveSearchModal({ filters, onClose, onSaved }) {
  const { t } = useI18n();
  const { pending, run } = useAction();
  const [name, setName] = useState(filters.q ? filters.q.slice(0, 60) : '');
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    const result = await run(() => api.post('/saved-searches', { name: name.trim(), filters: toQuery(filters) }));
    if (!result.ok) return setError(result.error);
    onSaved();
  };
  return (
    <Modal title={t('search.saveTitle')} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="save-search-form" pending={pending} disabled={!name.trim()}>{t('common.save')}</Button></>}>
      <ErrorNote error={error} />
      <form id="save-search-form" onSubmit={submit}>
        <Field label={t('search.saveName')} hint={t('search.saveHint')}>
          {(p) => <input {...p} className="input" value={name} maxLength={150} onChange={(e) => setName(e.target.value)} required />}
        </Field>
      </form>
    </Modal>
  );
}

function CreateAlertModal({ filters, onClose, onCreated }) {
  const { t } = useI18n();
  const { pending, run } = useAction();
  const [name, setName] = useState(filters.q ? filters.q.slice(0, 60) : '');
  const [frequency, setFrequency] = useState('daily');
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    const result = await run(() => api.post('/alert-profiles/from-filters', { name: name.trim(), frequency, filters: toQuery(filters) }));
    if (!result.ok) return setError(result.error);
    onCreated();
  };
  return (
    <Modal title={t('alerts.fromFiltersTitle')} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="from-filters-form" pending={pending} disabled={!name.trim()}>{t('alerts.new')}</Button></>}>
      <ErrorNote error={error} />
      <p className="cell-sub" style={{ marginBottom: 12 }}>{t('alerts.fromFiltersHint')}</p>
      <form id="from-filters-form" onSubmit={submit}>
        <Field label={t('alerts.name')}>{(p) => <input {...p} className="input" value={name} maxLength={150} onChange={(e) => setName(e.target.value)} required />}</Field>
        <Field label={t('alerts.frequency')}>
          {(p) => (
            <select {...p} className="select" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              <option value="daily">{t('alerts.daily')}</option><option value="alternate_day">{t('alerts.alternate')}</option><option value="weekly">{t('alerts.weekly')}</option>
            </select>
          )}
        </Field>
      </form>
    </Modal>
  );
}

function SavedSearchMenu({ onPick }) {
  const { t } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const list = useAsync(async () => (open ? (await api.get('/saved-searches')).searches : null), [open]);
  const remove = async (id) => {
    try { await api.delete(`/saved-searches/${id}`); toast.success(t('search.deleted')); list.reload(); } catch (err) { toast.error(err.message); }
  };
  return (
    <div style={{ position: 'relative' }}>
      <Button variant="outline" onClick={() => setOpen(!open)} aria-expanded={open}><Bookmark size={15} />{t('search.savedSearches')}</Button>
      {open && (
        <div className="user-menu" style={{ width: 300, right: 0 }} role="menu">
          {list.loading && !list.data && <Loading />}
          {list.data?.length === 0 && <p className="cell-sub" style={{ padding: 8 }}>{t('search.noSaved')}</p>}
          {list.data?.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center' }}>
              <button type="button" role="menuitem" style={{ flex: 1 }} onClick={() => { setOpen(false); onPick(s.filters); }}>{s.name}</button>
              <button type="button" aria-label={`${t('watch.delete')} ${s.name}`} style={{ width: 32, justifyContent: 'center' }} onClick={() => remove(s.id)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Search() {
  const { t } = useI18n();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFrom(params), [params]);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const openId = Number(params.get('tender')) || null;

  const masters = useAsync(() => api.get('/masters'), []);
  const searchKey = toParams(filters, { page }).toString();
  const results = useAsync(
    () => api.get('/tenders', { query: toQuery(filters, { facets: 1, page, pageSize: PAGE_SIZE }) }),
    [searchKey]
  );

  const [overrides, setOverrides] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingAlert, setCreatingAlert] = useState(false);
  const [qText, setQText] = useState(filters.q);
  const [excludeText, setExcludeText] = useState(filters.exclude);

  const go = useCallback((next, { resetPage = true, keepTender = true } = {}) => {
    setParams(toParams(next, { page: resetPage ? undefined : page, tender: keepTender ? openId : undefined }));
  }, [openId, page, setParams]);
  const update = (patch) => go({ ...filters, ...patch });

  // Typing in the keyword boxes applies after a short pause; URL changes from elsewhere refresh the boxes.
  useEffect(() => { setQText(filters.q); setExcludeText(filters.exclude); }, [filters.q, filters.exclude]);
  const timer = useRef(null);
  const typed = (key, setter) => (e) => {
    setter(e.target.value);
    clearTimeout(timer.current);
    const value = e.target.value;
    timer.current = setTimeout(() => update({ [key]: value }), 450);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const toggleIn = (key) => (id) => update({ [key]: filters[key].includes(id) ? filters[key].filter((x) => x !== id) : [...filters[key], id] });
  const toggleScope = (scope) => {
    const current = filters.scope.length ? filters.scope : SCOPES;
    const next = current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope];
    update({ scope: next.length === SCOPES.length || next.length === 0 ? [] : next });
  };

  const toggleWatch = async (tender) => {
    const watched = overrides[tender.id] ?? tender.watchlisted;
    setBusyId(tender.id);
    try {
      if (watched) await api.delete(`/tenders/${tender.id}/watch`); else await api.put(`/tenders/${tender.id}/watch`, {});
      setOverrides((o) => ({ ...o, [tender.id]: !watched }));
      toast.success(watched ? t('tender.removedWatch') : t('tender.addedWatch'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const openTender = (tender) => setParams(toParams(filters, { page: page > 1 ? page : undefined, tender: tender.id }));
  const closeTender = useCallback(() => setParams(toParams(filters, { page: page > 1 ? page : undefined })), [filters, page, setParams]);

  const data = results.data;
  const facets = data?.facets;
  const nameOf = (list, id) => list?.find((x) => x.id === id)?.name;
  const stateOptions = masters.data?.states ?? [];
  const activeCount = activeFilterCount(filters);
  const scopeOn = (s) => (filters.scope.length ? filters.scope.includes(s) : true);
  const sortValue = filters.sort || data?.sort || 'deadline';

  const goToPage = (p) => { setParams(toParams(filters, { page: p > 1 ? p : undefined, tender: openId })); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <>
      <PageHeader
        title={t('search.title')}
        subtitle={t('search.subtitle')}
        crumbs={[{ label: t('nav.home'), to: '/app' }, { label: t('nav.search') }]}
        actions={
          <>
            <SavedSearchMenu onPick={(saved) => go(filtersFrom(saved))} />
            <Button variant="outline" onClick={() => setSaving(true)}><Bookmark size={15} />{t('search.saveSearch')}</Button>
            <Button variant="outline" onClick={() => setCreatingAlert(true)}><Bell size={15} />{t('alerts.fromFilters')}</Button>
            <a className="btn-export-excel-primary" style={{ textDecoration: 'none' }} href={api.url('/tenders/export.xlsx', toQuery(filters))} download>
              <Download size={15} /><span>{t('search.exportExcel')}</span>
            </a>
          </>
        }
      />

      <div className="content-two-columns">
        <aside className={`facet-filters-card ${filtersOpen ? 'open' : ''}`} aria-label={t('search.filters')}>
          <div className="facet-card-title-row">
            <h3><SlidersHorizontal size={15} />{t('search.filters')}{activeCount > 0 && ` (${activeCount})`}</h3>
            {activeCount > 0 && <button type="button" className="facet-reset-link" onClick={() => go(EMPTY_FILTERS)}>{t('search.reset')}</button>}
          </div>

          <div className="facet-filter-group">
            <div className="facet-group-label-row"><span>{t('search.keywords')}</span></div>
            <input className="facet-input-box" value={qText} placeholder={t('search.keywordsPlaceholder')} onChange={typed('q', setQText)} aria-label={t('search.keywords')} />
            <div className="scope-chips-row" role="group" aria-label={t('search.scope')}>
              {SCOPES.map((s) => (
                <button key={s} type="button" aria-pressed={scopeOn(s)} className={`scope-pill-chip ${scopeOn(s) ? 'selected' : ''}`} onClick={() => toggleScope(s)}>
                  {t(`search.scope${s[0].toUpperCase()}${s.slice(1)}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="facet-filter-group">
            <div className="facet-group-label-row"><span>{t('search.exclude')}</span></div>
            <input className="exclude-filter-input" value={excludeText} placeholder={t('search.excludePlaceholder')} onChange={typed('exclude', setExcludeText)} aria-label={t('search.exclude')} />
            <div className="exclude-hint-msg">{t('search.excludeHint')}</div>
          </div>

          <div className="facet-filter-group">
            <div className="facet-group-label-row"><span>{t('search.status')}</span></div>
            <select className="select" value={filters.status} onChange={(e) => update({ status: e.target.value })} aria-label={t('search.status')}>
              <option value="open">{t('search.open')}</option>
              <option value="closing_soon">{t('search.closingSoon')}</option>
              <option value="closed">{t('search.closed')}</option>
              <option value="all">{t('search.allStatus')}</option>
            </select>
          </div>

          <div className="facet-filter-group">
            <div className="facet-group-label-row"><span>{t('alerts.alertMatches')}</span></div>
            <select className="select" value={filters.alerts} onChange={(e) => update({ alerts: e.target.value })} aria-label={t('alerts.alertMatches')}>
              <option value="any">{t('alerts.any')}</option>
              <option value="matched">{t('alerts.matchedAny')}</option>
              <option value="in_digest">{t('alerts.emailed')}</option>
              <option value="not_in_digest">{t('alerts.heldBack')}</option>
            </select>
          </div>

          <FacetGroup title={t('search.department')} items={facets?.departments ?? []} selected={filters.departmentIds} onToggle={toggleIn('departmentIds')}
            extra={{ options: masters.data?.departments ?? [], labelOf: (id) => nameOf(masters.data?.departments, id) }} />
          <FacetGroup title={t('search.state')} items={facets?.states ?? []} selected={filters.stateIds} onToggle={toggleIn('stateIds')}
            extra={{ options: stateOptions, labelOf: (id) => nameOf(stateOptions, id) }} />
          <FacetGroup title={t('search.category')} items={facets?.categories ?? []} selected={filters.categoryIds} onToggle={toggleIn('categoryIds')}
            extra={{ options: masters.data?.categories ?? [], labelOf: (id) => nameOf(masters.data?.categories, id) }} />

          {(facets?.tenderTypes?.length ?? 0) > 0 && (
            <div className="facet-filter-group">
              <div className="facet-group-label-row"><span>{t('search.tenderType')}</span></div>
              <div className="chip-row">
                {facets.tenderTypes.map((ty) => {
                  const on = filters.tenderTypes.includes(ty.label.toLowerCase());
                  return (
                    <button key={ty.label} type="button" aria-pressed={on} className={`scope-pill-chip ${on ? 'selected' : ''}`}
                      onClick={() => update({ tenderTypes: on ? filters.tenderTypes.filter((x) => x !== ty.label.toLowerCase()) : [...filters.tenderTypes, ty.label.toLowerCase()] })}>
                      {ty.label} ({ty.count})
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="facet-filter-group">
            <div className="facet-group-label-row"><span>{t('search.value')}</span></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="facet-input-box" type="number" min="0" placeholder={t('search.min')} aria-label={`${t('search.value')} ${t('search.min')}`}
                defaultValue={rupeesToLakh(filters.valueMin)} key={`min-${filters.valueMin}`} onBlur={(e) => update({ valueMin: lakhToRupees(e.target.value) })} />
              <input className="facet-input-box" type="number" min="0" placeholder={t('search.max')} aria-label={`${t('search.value')} ${t('search.max')}`}
                defaultValue={rupeesToLakh(filters.valueMax)} key={`max-${filters.valueMax}`} onBlur={(e) => update({ valueMax: lakhToRupees(e.target.value) })} />
            </div>
            <div className="field-hint" style={{ marginTop: 4 }}>{t('search.valueHint')}</div>
          </div>

          {[['deadline', 'deadlineFrom', 'deadlineTo'], ['published', 'publishFrom', 'publishTo']].map(([label, from, to]) => (
            <div key={label} className="facet-filter-group">
              <div className="facet-group-label-row"><span>{t(`search.${label}`)}</span></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="facet-input-box" type="date" value={filters[from]} aria-label={`${t(`search.${label}`)} ${t('search.from')}`} onChange={(e) => update({ [from]: e.target.value })} />
                <input className="facet-input-box" type="date" value={filters[to]} aria-label={`${t(`search.${label}`)} ${t('search.to')}`} onChange={(e) => update({ [to]: e.target.value })} />
              </div>
            </div>
          ))}
        </aside>

        <section className="tender-feed-column">
          <div className="result-bar">
            <div>
              <button type="button" className="btn btn-outline btn-sm filter-toggle" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>
                <SlidersHorizontal size={14} />{t('search.filters')}{activeCount > 0 && ` (${activeCount})`}
              </button>{' '}
              {data && <span className="count" role="status">{data.total === 1 ? t('search.foundOne') : t('search.found', { n: data.total.toLocaleString('en-IN') })}</span>}
            </div>
            <div className="feed-sort-controls">
              <label htmlFor="sort" className="cell-sub">{t('search.sort')}</label>
              <select id="sort" className="feed-sort-select" value={sortValue} onChange={(e) => update({ sort: e.target.value })}>
                {filters.q && <option value="relevance">{t('search.sortRelevance')}</option>}
                <option value="deadline">{t('search.sortDeadline')}</option>
                <option value="published">{t('search.sortPublished')}</option>
                <option value="value">{t('search.sortValue')}</option>
              </select>
            </div>
          </div>

          <ErrorNote error={results.error} onRetry={results.reload} retryLabel={t('common.retry')} />
          {results.loading && !data && <Loading label={t('common.loading')} />}
          {data && data.items.length === 0 && <div className="card"><Empty title={t('search.noResults')}>{t('search.noResultsHint')}</Empty></div>}
          <div style={{ opacity: results.loading && data ? 0.55 : 1, transition: 'opacity 0.15s', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {data?.items.map((item) => (
              <TenderCard key={item.id} tender={{ ...item, watchlisted: overrides[item.id] ?? item.watchlisted }}
                busy={busyId === item.id} onOpen={openTender} onToggleWatch={toggleWatch} />
            ))}
          </div>

          {data && data.pages > 1 && (
            <nav className="pager" aria-label="Pagination">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>{t('common.previous')}</Button>
              <span className="cell-sub">{t('search.page', { p: data.page, n: data.pages })}</span>
              <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => goToPage(page + 1)}>{t('common.next')}</Button>
            </nav>
          )}
        </section>
      </div>

      {openId && (
        <TenderDrawer
          key={openId}
          tenderId={openId}
          onClose={closeTender}
          onWatchChange={(id, watched) => setOverrides((o) => ({ ...o, [id]: watched }))}
        />
      )}
      {creatingAlert && <CreateAlertModal filters={filters} onClose={() => setCreatingAlert(false)} onCreated={() => { setCreatingAlert(false); toast.success(t('alerts.createdFromSearch')); }} />}
      {saving && <SaveSearchModal filters={filters} onClose={() => setSaving(false)} onSaved={() => { setSaving(false); toast.success(t('search.saved')); }} />}
    </>
  );
}
