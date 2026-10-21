import { useState } from 'react';
import { BellRing, Eye, Pause, Pencil, Play, Plus, Send, Trash2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MultiPick, TagInput } from '../../components/forms.jsx';
import { useToast } from '../../components/Toast.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader } from '../../components/ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { formatDate, formatInr } from '../../lib/format.js';
import { useAction, useAsync } from '../../lib/hooks.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TENDER_TYPES = ['Works', 'Goods', 'Services'];
const lakh = (rupees) => (rupees === null || rupees === undefined ? '' : String(rupees / 100000));
const rupees = (text) => (text === '' ? null : Math.round(Number(text) * 100000));

const blank = () => ({
  name: '', keywords: [], excludeKeywords: [], categoryIds: [], departmentIds: [], stateIds: [], tenderTypes: [],
  valueMin: '', valueMax: '', includeUnknownValue: true, recipientEmails: [], frequency: 'daily', weeklyDay: 1,
});
const fromProfile = (p) => ({ ...p, valueMin: lakh(p.valueMin), valueMax: lakh(p.valueMax) });

function ProfileForm({ initial, masters, onClose, onSaved }) {
  const { t } = useI18n();
  const { pending, run } = useAction();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(null);
  const set = (patch) => setForm({ ...form, ...patch });
  const editing = Boolean(initial.id);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const body = {
      name: form.name.trim(), keywords: form.keywords, excludeKeywords: form.excludeKeywords,
      categoryIds: form.categoryIds, departmentIds: form.departmentIds, stateIds: form.stateIds,
      tenderTypes: form.tenderTypes, valueMin: rupees(form.valueMin), valueMax: rupees(form.valueMax),
      includeUnknownValue: form.includeUnknownValue, recipientEmails: form.recipientEmails,
      frequency: form.frequency, weeklyDay: Number(form.weeklyDay),
    };
    const result = await run(() => (editing ? api.patch(`/alert-profiles/${initial.id}`, body) : api.post('/alert-profiles', body)));
    if (!result.ok) return setError(result.error);
    onSaved(editing);
  };

  return (
    <Modal wide title={editing ? t('alerts.edit') : t('alerts.new')} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="alert-form" pending={pending} disabled={!form.name.trim()}>{t('common.save')}</Button></>}>
      <ErrorNote error={error} />
      <form id="alert-form" onSubmit={submit}>
        <Field label={t('alerts.name')}>
          {(p) => <input {...p} className="input" value={form.name} maxLength={150} placeholder={t('alerts.namePlaceholder')} onChange={(e) => set({ name: e.target.value })} required />}
        </Field>
        <Field label={t('alerts.keywords')} hint={t('alerts.keywordsHint')}>
          {(p) => <TagInput id={p.id} ariaLabel={t('alerts.keywords')} value={form.keywords} onChange={(keywords) => set({ keywords })} placeholder="water meter, hospital..." />}
        </Field>
        <Field label={t('alerts.exclude')} hint={t('alerts.excludeHint')}>
          {(p) => <TagInput id={p.id} ariaLabel={t('alerts.exclude')} value={form.excludeKeywords} onChange={(excludeKeywords) => set({ excludeKeywords })} placeholder="cctv, surveillance..." />}
        </Field>
        <div className="form-grid">
          <Field label={t('alerts.categories')}>
            {(p) => <MultiPick id={p.id} ariaLabel={t('alerts.categories')} anyLabel={t('alerts.anyCategory')} options={masters.categories} value={form.categoryIds} onChange={(categoryIds) => set({ categoryIds })} />}
          </Field>
          <Field label={t('alerts.departments')}>
            {(p) => <MultiPick id={p.id} ariaLabel={t('alerts.departments')} anyLabel={t('alerts.anyDepartment')} options={masters.departments} value={form.departmentIds} onChange={(departmentIds) => set({ departmentIds })} />}
          </Field>
          <Field label={t('alerts.states')}>
            {(p) => <MultiPick id={p.id} ariaLabel={t('alerts.states')} anyLabel={t('alerts.anyState')} options={masters.states} value={form.stateIds} onChange={(stateIds) => set({ stateIds })} />}
          </Field>
          <Field label={t('alerts.tenderTypes')}>
            {() => (
              <div className="chip-row">
                {TENDER_TYPES.map((ty) => {
                  const on = form.tenderTypes.some((x) => x.toLowerCase() === ty.toLowerCase());
                  return (
                    <button key={ty} type="button" aria-pressed={on} className={`scope-pill-chip ${on ? 'selected' : ''}`}
                      onClick={() => set({ tenderTypes: on ? form.tenderTypes.filter((x) => x.toLowerCase() !== ty.toLowerCase()) : [...form.tenderTypes, ty] })}>{ty}</button>
                  );
                })}
                {form.tenderTypes.length === 0 && <span className="tag-any">{t('alerts.anyType')}</span>}
              </div>
            )}
          </Field>
        </div>
        <Field label={t('alerts.value')}>
          {() => (
            <div style={{ display: 'flex', gap: 10 }}>
              <input className="input" type="number" min="0" step="any" placeholder={t('search.min')} aria-label={`${t('alerts.value')} ${t('search.min')}`} value={form.valueMin} onChange={(e) => set({ valueMin: e.target.value })} />
              <input className="input" type="number" min="0" step="any" placeholder={t('search.max')} aria-label={`${t('alerts.value')} ${t('search.max')}`} value={form.valueMax} onChange={(e) => set({ valueMax: e.target.value })} />
            </div>
          )}
        </Field>
        <label className="check-row">
          <input type="checkbox" checked={form.includeUnknownValue} onChange={(e) => set({ includeUnknownValue: e.target.checked })} />
          {t('alerts.includeUnknown')}
        </label>
        <Field label={t('alerts.recipients')} hint={t('alerts.recipientsHint')}>
          {(p) => <TagInput id={p.id} ariaLabel={t('alerts.recipients')} value={form.recipientEmails} validate={(v) => EMAIL.test(v)} max={10} onChange={(recipientEmails) => set({ recipientEmails })} placeholder="name@company.com" />}
        </Field>
        <div className="form-grid">
          <Field label={t('alerts.frequency')}>
            {(p) => (
              <select {...p} className="select" value={form.frequency} onChange={(e) => set({ frequency: e.target.value })}>
                <option value="daily">{t('alerts.daily')}</option><option value="alternate_day">{t('alerts.alternate')}</option><option value="weekly">{t('alerts.weekly')}</option>
              </select>
            )}
          </Field>
          {form.frequency === 'weekly' && (
            <Field label={t('alerts.on')}>
              {(p) => (
                <select {...p} className="select" value={form.weeklyDay} onChange={(e) => set({ weeklyDay: e.target.value })}>
                  {t('alerts.days').map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              )}
            </Field>
          )}
        </div>
      </form>
    </Modal>
  );
}

function PreviewModal({ profile, onClose }) {
  const { t, lang } = useI18n();
  const data = useAsync(async () => (await api.get(`/alert-profiles/${profile.id}/preview`)).preview, [profile.id]);
  const p = data.data;
  const row = (tender) => (
    <div className="preview-item" key={tender.id}>
      <div>
        <b>{tender.title}</b>
        <div className="cell-sub">{[tender.department, tender.state].filter(Boolean).join(' · ')} · {formatInr(tender.estimatedValue, t('common.notDisclosed'))} · {formatDate(tender.deadline, lang)}</div>
      </div>
      {tender.score !== null && <span className="score-pill">{t('alerts.score')} {tender.score}</span>}
    </div>
  );
  return (
    <Modal wide title={`${t('alerts.previewTitle')}: ${profile.name}`} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>{t('common.close')}</Button>}>
      {data.loading && !p && <Loading label={t('common.loading')} />}
      <ErrorNote error={data.error} />
      {p && (p.included.length === 0 && p.closingSoon.length === 0 ? <p className="cell-sub">{t('alerts.previewNothing')}</p> : (
        <>
          <div className="note note-info">{t('alerts.previewSummary', { matched: p.matched, closing: p.closingSoon.length, held: p.notInDigest, cap: p.cap })}</div>
          {p.closingSoon.length > 0 && <><h4 className="drawer-h">{t('alerts.closingBlock')}</h4>{p.closingSoon.map(row)}</>}
          {p.included.length > 0 && <><h4 className="drawer-h">{t('alerts.topMatches')}</h4>{p.included.map(row)}</>}
        </>
      ))}
    </Modal>
  );
}

function ProfileCard({ profile: p, masters, onEdit, onChanged }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const names = (list, ids) => ids.map((id) => list.find((x) => x.id === id)?.name).filter(Boolean);

  const act = async (fn, message) => {
    setBusy(true);
    try { const out = await fn(); if (message) toast.success(typeof message === 'function' ? message(out) : message); await onChanged(); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const chips = [
    ...p.keywords.map((k) => ['blue', k]), ...p.excludeKeywords.map((k) => ['red', `− ${k}`]),
    ...names(masters.categories, p.categoryIds).map((n) => ['purple', n]), ...names(masters.departments, p.departmentIds).map((n) => ['slate', n]),
    ...names(masters.states, p.stateIds).map((n) => ['green', n]), ...p.tenderTypes.map((n) => ['amber', n]),
    ...(p.valueMin !== null || p.valueMax !== null ? [['slate', `₹ ${p.valueMin !== null ? formatInr(p.valueMin) : '0'} – ${p.valueMax !== null ? formatInr(p.valueMax) : '∞'}`]] : []),
  ];
  const freq = { daily: t('alerts.daily'), alternate_day: t('alerts.alternate'), weekly: `${t('alerts.weekly')} · ${t('alerts.days')[p.weeklyDay]}` }[p.frequency];

  return (
    <Card className="alert-card">
      <div className="alert-card-head">
        <div>
          <h3>{p.name}</h3>
          <div className="cell-sub">{freq} · {p.recipientEmails.join(', ')}</div>
        </div>
        <Badge tone={p.status === 'active' ? 'green' : 'amber'}>{p.status === 'active' ? t('alerts.active') : t('alerts.paused')}</Badge>
      </div>
      <div className="alert-meta">{chips.length ? chips.map(([tone, text], i) => <Badge key={i} tone={tone}>{text}</Badge>) : <span className="cell-sub">{t('alerts.anyCategory')} · {t('alerts.anyDepartment')} · {t('alerts.anyState')}</span>}</div>
      <div className="cell-sub">
        {t('alerts.lastEmail')}: {p.lastDigest ? t('alerts.lastSummary', { date: formatDate(p.lastDigest.date, lang), included: p.lastDigest.included, matched: p.lastDigest.matched }) : t('alerts.neverSent')}
      </div>
      <div className="alert-actions">
        <Button size="sm" variant="outline" onClick={() => onEdit(p)}><Pencil size={13} />{t('common.edit')}</Button>
        <Button size="sm" variant="outline" onClick={() => setPreviewing(true)}><Eye size={13} />{t('alerts.preview')}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => act(async () => (await api.post(`/alert-profiles/${p.id}/test`)).dryRun, (dry) => (dry ? t('alerts.testDry') : t('alerts.testQueued', { email: user.email })))}><Send size={13} />{t('alerts.sendTest')}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => api.patch(`/alert-profiles/${p.id}`, { status: p.status === 'active' ? 'paused' : 'active' }), t('alerts.saved'))}>
          {p.status === 'active' ? <><Pause size={13} />{t('alerts.pause')}</> : <><Play size={13} />{t('alerts.resume')}</>}
        </Button>
        <Button size="sm" variant="danger" onClick={() => setDeleting(true)}><Trash2 size={13} />{t('alerts.delete')}</Button>
      </div>
      {previewing && <PreviewModal profile={p} onClose={() => setPreviewing(false)} />}
      {deleting && (
        <Modal title={t('alerts.deleteTitle')} onClose={() => setDeleting(false)}
          footer={<><Button variant="outline" onClick={() => setDeleting(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" pending={busy} onClick={() => act(() => api.delete(`/alert-profiles/${p.id}`), t('alerts.deleted')).then(() => setDeleting(false))}>{t('alerts.delete')}</Button></>}>
          <p>{t('alerts.deleteBody', { name: p.name })}</p>
        </Modal>
      )}
    </Card>
  );
}

export default function Alerts() {
  const { t } = useI18n();
  const toast = useToast();
  const { organization, refresh } = useAuth();
  const profiles = useAsync(async () => (await api.get('/alert-profiles')).profiles, []);
  const masters = useAsync(() => api.get('/masters'), []);
  const [editing, setEditing] = useState(null);

  const used = profiles.data?.length ?? 0;
  const max = organization?.maxAlertProfiles ?? 5;
  const atLimit = used >= max;

  return (
    <>
      <PageHeader
        title={t('alerts.title')}
        subtitle={t('alerts.subtitle')}
        crumbs={[{ label: t('nav.home'), to: '/app' }, { label: t('nav.alerts') }]}
        actions={<Button disabled={atLimit || !masters.data} onClick={() => setEditing(blank())}><Plus size={15} />{t('alerts.new')}</Button>}
      />
      <div className="note note-info">
        <BellRing size={16} />
        <span>{t('alerts.limit', { max, used })} {organization?.alertCap && t('alerts.ceiling', { n: organization.alertCap })} {atLimit && t('alerts.limitReached', { max })}</span>
      </div>

      {(profiles.loading && !profiles.data) || (masters.loading && !masters.data) ? <Loading label={t('common.loading')} /> : null}
      <ErrorNote error={profiles.error ?? masters.error} onRetry={() => { profiles.reload(); masters.reload(); }} retryLabel={t('common.retry')} />
      {profiles.data?.length === 0 && <Card><Empty title={t('alerts.empty')}>{t('alerts.emptyHint')}</Empty></Card>}
      {masters.data && profiles.data?.map((p) => (
        <ProfileCard key={`${p.id}-${p.status}-${p.name}`} profile={p} masters={masters.data} onEdit={(x) => setEditing(fromProfile(x))} onChanged={() => Promise.all([profiles.reload(), refresh()])} />
      ))}

      <Card title={t('alerts.howTitle')}>
        <ol className="how-list">{t('alerts.how').map((line) => <li key={line}>{line}</li>)}</ol>
      </Card>

      {editing && masters.data && (
        <ProfileForm initial={editing} masters={masters.data} onClose={() => setEditing(null)}
          onSaved={(wasEdit) => { setEditing(null); toast.success(wasEdit ? t('alerts.saved') : t('alerts.created')); profiles.reload(); refresh(); }} />
      )}
    </>
  );
}
