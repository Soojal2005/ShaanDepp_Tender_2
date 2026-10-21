import { useState } from 'react';
import { Eye, RefreshCw, Send } from 'lucide-react';
import { can, useAuth } from '../../auth/AuthContext.jsx';
import BundleView from '../../components/report/BundleView.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Loading, Modal, PageHeader } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useAction, useAsync } from '../../lib/hooks.js';

function Preview({ id, onClose }) {
  const data = useAsync(async () => (await api.get(`/admin/reports/bundles/${id}`)).bundle, [id]);
  return (
    <Modal wide title={data.data?.title ?? 'Report preview'} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      {data.loading && !data.data && <Loading />}
      <ErrorNote error={data.error} />
      {data.data && <BundleView snapshot={data.data.snapshot} />}
    </Modal>
  );
}

export default function WeeklyReports() {
  const { user } = useAuth();
  const toast = useToast();
  const { pending, run } = useAction();
  const [period, setPeriod] = useState('');
  const [notify, setNotify] = useState(false);
  const [plan, setPlan] = useState('');
  const [preview, setPreview] = useState(null);

  const bundles = useAsync(() => api.get('/admin/reports/bundles', { query: { period: period || undefined } }), [period]);
  const releases = useAsync(async () => (await api.get('/admin/reports/releases')).releases, []);
  const plans = useAsync(async () => (await api.get('/admin/plans')).plans, []);
  const canGenerate = can(user, 'reports:generate');
  const shownPeriod = period || bundles.data?.defaultPeriod || '';

  const act = async (fn, message) => {
    const out = await run(fn);
    if (!out.ok) return toast.error(out.error.message);
    toast.success(typeof message === 'function' ? message(out.value) : message);
    bundles.reload(); releases.reload();
  };
  const generate = () => act(() => api.post('/admin/reports/generate', shownPeriod ? { periodStart: shownPeriod } : {}),
    ({ result }) => `Generated ${result.generated ?? result.count ?? 0} report(s)`);
  const release = (b) => act(() => api.post('/admin/reports/release', { bundleId: b.id, notify }), `Released to ${b.organization}`);
  const releasePlan = () => act(() => api.post('/admin/reports/release', { planCode: plan, periodStart: shownPeriod, notify }), 'Released to the plan');

  const list = bundles.data?.bundles ?? [];
  return (
    <>
      <PageHeader title="Weekly reports" subtitle="Generate each client's Monday bundle, review it, then release it. Clients only see what has been released to them."
        crumbs={[{ label: 'Home', to: '/app' }, { label: 'Administration' }, { label: 'Weekly reports' }]} />

      <Card title="Week">
        <div className="results-filters">
          <label className="cell-sub" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Week starting (Monday)
            <input className="input" type="date" style={{ width: 160 }} value={shownPeriod} onChange={(e) => setPeriod(e.target.value)} />
          </label>
          {canGenerate && <Button pending={pending} onClick={generate}><RefreshCw size={14} />Generate for all clients</Button>}
          <label className="check-row" style={{ margin: 0 }}>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Email clients when released
          </label>
        </div>
        <div className="results-filters" style={{ marginTop: 12 }}>
          <select className="select" aria-label="Plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="">Release to a whole plan...</option>
            {(plans.data ?? []).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
          <Button variant="outline" disabled={!plan || !shownPeriod} pending={pending} onClick={releasePlan}><Send size={14} />Release to plan</Button>
        </div>
      </Card>

      <Card title={`Bundles${shownPeriod ? ` for week of ${shownPeriod}` : ''}`} flush>
        {bundles.loading && !bundles.data && <Loading />}
        <ErrorNote error={bundles.error} onRetry={bundles.reload} />
        {bundles.data && list.length === 0 && <Empty title="No bundles for this week">Generate them to prepare one per client.</Empty>}
        {list.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Client</th><th>Plan</th><th>Generated</th><th>Status</th><th className="num">Downloads</th><th /></tr></thead>
            <tbody>{list.map((b) => (
              <tr key={b.id}>
                <td className="cell-title">{b.organization}</td><td>{b.planCode ?? '-'}</td><td>{formatDateTime(b.generatedAt)}</td>
                <td>{b.releasedAt ? <Badge tone="green">Released {formatDateTime(b.releasedAt)}</Badge> : <Badge tone="amber">Not released</Badge>}</td>
                <td className="num">{b.downloads}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <Button size="sm" variant="outline" onClick={() => setPreview(b.id)}><Eye size={13} />Preview</Button>{' '}
                  {!b.releasedAt && <Button size="sm" pending={pending} onClick={() => release(b)}><Send size={13} />Release</Button>}
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>

      <Card title="Release log" flush>
        <p className="cell-sub" style={{ padding: '10px 20px 0' }}>Append-only: every release is recorded and cannot be edited or removed.</p>
        {releases.data?.length === 0 && <Empty title="Nothing released yet" />}
        {releases.data?.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>When</th><th>Report</th><th>Client</th><th>Scope</th><th>By</th></tr></thead>
            <tbody>{releases.data.map((r) => (
              <tr key={r.id}><td>{formatDateTime(r.released_at)}</td><td>{r.bundle_title}</td><td>{r.organization_name ?? '-'}</td><td>{r.scope}{r.plan_code ? ` (${r.plan_code})` : ''}</td><td>{r.released_by_name ?? '-'}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {preview && <Preview id={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
