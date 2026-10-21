import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Play, RefreshCw, Upload } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useAction, useAsync } from '../../lib/hooks.js';

const tone = { success: 'green', warning: 'amber', failed: 'red', running: 'blue' };

function KeyBanner({ tb }) {
  if (!tb.configured) {
    return <div className="note note-warn"><AlertTriangle size={16} />The Tenderbook API key is not configured on the server, so live tender data is not flowing. Data can still be added with Excel upload.</div>;
  }
  if (tb.keyExpiringSoon) {
    return (
      <div className="note note-warn"><AlertTriangle size={16} />
        The Tenderbook key {tb.keyDaysLeft < 0 ? `expired ${-tb.keyDaysLeft} day(s) ago` : `expires in ${tb.keyDaysLeft} day(s) (${tb.keyValidTill})`}. Renew the subscription and update TENDERBOOK_API_KEY on the server.
      </div>
    );
  }
  return null;
}

function RunSummary({ run }) {
  if (!run) return <span className="cell-sub">No run yet</span>;
  return (
    <div>
      <Badge tone={tone[run.status]}>{run.status}</Badge>{' '}
      <span className="cell-sub">{formatDateTime(run.started_at)}</span>
      <div className="cell-sub">{run.fetched} fetched · {run.inserted} new · {run.updated} updated · {run.skipped} unchanged{run.errors ? ` · ${run.errors} errors` : ''}</div>
      {run.error_message && <div className="cell-sub" style={{ color: '#B91C1C' }}>{run.error_message}</div>}
    </div>
  );
}

function ExcelUpload({ onDone }) {
  const toast = useToast();
  const fileInput = useRef(null);
  const [kind, setKind] = useState('tenders');
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const { pending, run } = useAction();

  const send = async (dryRun) => {
    setError(null);
    const body = new FormData();
    body.append('kind', kind);
    body.append('dryRun', String(dryRun));
    body.append('file', file);
    const out = await run(() => api.post('/admin/ingestion/excel', body));
    if (!out.ok) return setError(out.error);
    setResult(out.value.result);
    if (!dryRun) { toast.success(`Imported: ${out.value.result.inserted} new, ${out.value.result.updated} updated`); onDone(); }
  };

  return (
    <Card title="Excel upload (fallback and manual entries)">
      <p className="cell-sub" style={{ marginBottom: 12 }}>For tenders or results the API does not carry. Download the template, fill it in, check it with a preview, then import. Uploading an ID again updates that record.</p>
      <ErrorNote error={error} />
      <div className="form-grid">
        <Field label="What are you uploading?">
          {(p) => (
            <select {...p} className="select" value={kind} onChange={(e) => { setKind(e.target.value); setResult(null); }}>
              <option value="tenders">Tenders</option><option value="results">Tender results (awards)</option>
            </select>
          )}
        </Field>
        <Field label="Workbook (.xlsx)">
          {(p) => <input {...p} ref={fileInput} className="input" type="file" accept=".xlsx" style={{ paddingTop: 6 }} onChange={(e) => { setFile(e.target.files[0] ?? null); setResult(null); }} />}
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <a className="btn btn-outline" href={api.url(`/admin/ingestion/templates/${kind}.xlsx`)} download><Download size={15} />Download template</a>
        <Button variant="outline" disabled={!file} pending={pending} onClick={() => send(true)}>Preview (no changes)</Button>
        <Button disabled={!file} pending={pending} onClick={() => send(false)}><Upload size={15} />Import</Button>
      </div>
      {result && (
        <div style={{ marginTop: 16 }}>
          <div className={`note ${result.errors.length ? 'note-warn' : 'note-success'}`}>
            <CheckCircle2 size={16} />
            {result.dryRun ? 'Preview: ' : 'Done: '}{result.valid} of {result.total} rows are valid
            {!result.dryRun && ` · ${result.inserted} new, ${result.updated} updated, ${result.skipped} unchanged`}
            {result.errors.length > 0 && ` · ${result.errors.length} row(s) need fixing`}
          </div>
          {result.errors.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table className="table">
                <thead><tr><th>Row</th><th>Problem</th></tr></thead>
                <tbody>{result.errors.map((e) => <tr key={e.row}><td>{e.row}</td><td>{e.messages.join('; ')}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function BackfillModal({ onClose, onStarted }) {
  const { pending, run } = useAction();
  const [form, setForm] = useState({ kind: 'tenders', from: '', to: '', filter: '' });
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    let filter = {};
    if (form.filter.trim()) {
      try { filter = JSON.parse(form.filter); } catch { return setError({ message: 'The vendor filter must be valid JSON, e.g. {"state": "Madhya Pradesh"}' }); }
    }
    const out = await run(() => api.post('/admin/ingestion/backfill', { kind: form.kind, from: form.from, to: form.to, filter }));
    if (!out.ok) return setError(out.error);
    onStarted(out.value.message);
  };
  return (
    <Modal title="Back-fill a date range" onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="backfill-form" pending={pending} disabled={!form.from || !form.to}>Start back-fill</Button></>}>
      <ErrorNote error={error} />
      <form id="backfill-form" onSubmit={submit}>
        <p className="cell-sub" style={{ marginBottom: 12 }}>Re-reads the feed and stores only records published (or awarded) inside the chosen dates. It runs in the background; progress shows in the run list.</p>
        <Field label="Feed">
          {(p) => <select {...p} className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="tenders">Tenders</option><option value="results">Results</option></select>}
        </Field>
        <div className="form-grid">
          <Field label="From">{(p) => <input {...p} className="input" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} required />}</Field>
          <Field label="To">{(p) => <input {...p} className="input" type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} required />}</Field>
        </div>
        <Field label="Vendor filter (JSON)" optional="optional" hint="Sent to the vendor as-is. Use the filter fields in the Tenderbook API documentation to narrow the pull.">
          {(p) => <textarea {...p} className="textarea" value={form.filter} onChange={(e) => setForm({ ...form, filter: e.target.value })} placeholder='{"state": "Madhya Pradesh"}' />}
        </Field>
      </form>
    </Modal>
  );
}

function Suggestions({ onChanged }) {
  const toast = useToast();
  const list = useAsync(async () => (await api.get('/admin/ingestion/suggestions')).suggestions, []);
  const masters = useAsync(() => api.get('/masters', { query: { all: 1 } }), []);
  const [choice, setChoice] = useState({});

  const act = async (fn, message) => {
    try { await fn(); toast.success(message); await list.reload(); onChanged(); } catch (err) { toast.error(err.message); }
  };
  const optionsFor = (kind) => ({ department: masters.data?.departments, category: masters.data?.categories, state: masters.data?.states }[kind] ?? []);

  return (
    <Card title={`Names to review${list.data ? ` (${list.data.length})` : ''}`} flush>
      <p className="cell-sub" style={{ padding: '12px 20px 0' }}>The feed used these names and none matched your master lists. Map each to an existing entry (it is remembered for next time), create a new entry, or ignore it.</p>
      {list.loading && !list.data && <Loading />}
      <ErrorNote error={list.error} onRetry={list.reload} />
      {list.data?.length === 0 && <Empty title="Nothing to review">Every name in the feed matches your master lists.</Empty>}
      {list.data?.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Kind</th><th>Name in the feed</th><th>Seen</th><th>Map to</th><th /></tr></thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id}>
                  <td><Badge tone="purple">{s.kind}</Badge></td>
                  <td className="cell-title">{s.raw_value}</td>
                  <td className="tabular-nums">{s.seen_count}×</td>
                  <td>
                    {s.kind === 'city' ? '-' : (
                      <select className="select" style={{ height: 32, fontSize: 12, minWidth: 220 }} aria-label={`Map ${s.raw_value}`}
                        value={choice[s.id] ?? ''} onChange={(e) => setChoice({ ...choice, [s.id]: e.target.value })}>
                        <option value="">Choose an entry...</option>
                        {optionsFor(s.kind).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <Button size="sm" disabled={!choice[s.id]} onClick={() => act(() => api.post(`/admin/ingestion/suggestions/${s.id}/map`, { masterId: Number(choice[s.id]) }), `Mapped "${s.raw_value}"`)}>Map</Button>
                      {s.kind !== 'state' && (
                        <Button size="sm" variant="outline" onClick={() => act(() => api.post(`/admin/ingestion/suggestions/${s.id}/map`, { create: { name: s.raw_value } }), `Created "${s.raw_value}"`)}>Create new</Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => act(() => api.post(`/admin/ingestion/suggestions/${s.id}/ignore`), 'Ignored')}>Ignore</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function Ingestion() {
  const toast = useToast();
  const status = useAsync(() => api.get('/admin/ingestion/status'), []);
  const [backfill, setBackfill] = useState(false);
  const [running, setRunning] = useState(null);

  const runNow = async (kind) => {
    setRunning(kind);
    try {
      const { result } = await api.post('/admin/ingestion/run', { kind });
      toast[result.status === 'failed' ? 'error' : 'success'](`${kind}: ${result.status}. ${result.inserted} new, ${result.updated} updated, ${result.skipped} unchanged.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRunning(null);
      status.reload();
    }
  };

  if (status.loading && !status.data) return <Loading />;
  if (status.error && !status.data) return <ErrorNote error={status.error} onRetry={status.reload} />;
  const { tenderbook: tb, counts, runs, bySource } = status.data;

  return (
    <>
      <PageHeader
        title="Data feeds"
        subtitle="Where tender data comes from, how recent it is, and how to fix or add to it."
        crumbs={[{ label: 'Administration' }, { label: 'Data feeds' }]}
        actions={<Button variant="outline" onClick={status.reload}><RefreshCw size={15} />Refresh</Button>}
      />
      <KeyBanner tb={tb} />

      <div className="kpi-cards-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {[['Tenders stored', counts.tenders], ['Results stored', counts.awards], ['Tenders with unmatched department', counts.unmapped_departments], ['Names awaiting review', counts.open_suggestions]].map(([label, value]) => (
          <div className="kpi-metric-card" key={label}><div className="kpi-numbers-wrap"><div className="kpi-big-value tabular-nums">{value}</div><div className="kpi-label-text">{label}</div></div></div>
        ))}
      </div>

      <Card title="Tenderbook (licensed API feed)"
        actions={tb.configured && (
          <>
            <Button size="sm" pending={running === 'tenders'} disabled={Boolean(running)} onClick={() => runNow('tenders')}><Play size={13} />Sync tenders now</Button>
            <Button size="sm" variant="outline" pending={running === 'results'} disabled={Boolean(running)} onClick={() => runNow('results')}><Play size={13} />Sync results now</Button>
            <Button size="sm" variant="outline" onClick={() => setBackfill(true)}>Back-fill dates</Button>
          </>
        )}>
        <dl className="kv">
          <dt>Scheduled sync</dt><dd>{tb.scheduledSyncEnabled ? `On, every ${tb.intervalMinutes} minutes` : 'Off (set TENDERBOOK_SYNC=on once the API key is in place)'}</dd>
          <dt>API key</dt><dd>{tb.configured ? `Configured${tb.keyValidTill ? ` · valid till ${tb.keyValidTill}` : ''}` : 'Not configured'}</dd>
          <dt>Last tenders sync</dt><dd><RunSummary run={tb.lastTenders} /></dd>
          <dt>Last results sync</dt><dd><RunSummary run={tb.lastResults} /></dd>
        </dl>
      </Card>

      <ExcelUpload onDone={status.reload} />
      <Suggestions onChanged={status.reload} />

      <Card title="Recent runs" flush>
        {runs.length === 0 ? <Empty title="No runs yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Feed</th><th>Trigger</th><th>Status</th><th className="num">Fetched</th><th className="num">New</th><th className="num">Updated</th><th className="num">Errors</th><th>Notes</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.started_at)}</td>
                    <td>{r.provider_id} / {r.kind}</td><td>{r.trigger}</td>
                    <td><Badge tone={tone[r.status]}>{r.status}</Badge></td>
                    <td className="num">{r.fetched}</td><td className="num">{r.inserted}</td><td className="num">{r.updated}</td><td className="num">{r.errors}</td>
                    <td className="cell-sub" style={{ maxWidth: 360 }}>{(r.warnings ?? []).slice(0, 2).join(' · ') || r.error_message || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {bySource.length > 0 && (
        <Card title="Stored tenders by source">
          <div className="chip-row">{bySource.map((s) => <Badge key={s.provider_id} tone="blue">{s.provider_id}: {s.tenders} (latest {formatDateTime(s.latest)})</Badge>)}</div>
        </Card>
      )}

      {backfill && <BackfillModal onClose={() => setBackfill(false)} onStarted={(m) => { setBackfill(false); toast.success(m); setTimeout(status.reload, 1500); }} />}
    </>
  );
}
