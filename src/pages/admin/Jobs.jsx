import { useState } from 'react';
import { Play, RefreshCw } from 'lucide-react';
import { useToast } from '../../components/Toast.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Loading, PageHeader } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useAsync } from '../../lib/hooks.js';

const tone = { success: 'green', failed: 'red', running: 'blue' };
const summary = (detail) => (detail ? Object.entries(detail).filter(([k, v]) => k !== 'activity' && typeof v !== 'object' && v !== 0 && v !== null).map(([k, v]) => `${k}: ${v}`).join(' · ') : '');

export default function Jobs() {
  const toast = useToast();
  const data = useAsync(() => api.get('/admin/jobs'), []);
  const [running, setRunning] = useState(null);

  const run = async (name, force = false) => {
    setRunning(name);
    try {
      await api.post(`/admin/jobs/${name}/run`, force ? { force: true } : {});
      toast.success('Finished');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRunning(null);
      data.reload();
    }
  };

  if (data.loading && !data.data) return <Loading />;
  if (data.error && !data.data) return <ErrorNote error={data.error} onRetry={data.reload} />;

  return (
    <>
      <PageHeader title="Background jobs" subtitle="Scheduled work: data sync, daily alerts, email sending and reminders."
        crumbs={[{ label: 'Administration' }, { label: 'Background jobs' }]}
        actions={<Button variant="outline" onClick={data.reload}><RefreshCw size={15} />Refresh</Button>} />
      {!data.data.schedulerRunning && <div className="note note-warn">The scheduler is not running in this process (JOBS_ENABLED=off). Jobs only run when started here.</div>}

      <Card flush>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Job</th><th>Schedule</th><th>Last run</th><th /></tr></thead>
            <tbody>
              {data.data.jobs.map((j) => (
                <tr key={j.name}>
                  <td><div className="cell-title">{j.label} {!j.enabled && <Badge tone="slate">off</Badge>}</div><div className="cell-sub" style={{ maxWidth: 420 }}>{j.description}</div></td>
                  <td><code>{j.schedule}</code><div className="cell-sub">{j.timezone}</div></td>
                  <td>{j.last ? <><Badge tone={tone[j.last.status]}>{j.last.status}</Badge> <span className="cell-sub">{formatDateTime(j.last.started_at)}</span><div className="cell-sub">{j.last.error ?? summary(j.last.detail)}</div></> : <span className="cell-sub">Not run yet</span>}</td>
                  <td>
                    <div className="row-actions">
                      <Button size="sm" variant="outline" pending={running === j.name} disabled={Boolean(running)} onClick={() => run(j.name)}><Play size={13} />Run now</Button>
                      {j.name === 'digests' && <Button size="sm" variant="outline" disabled={Boolean(running)} onClick={() => run(j.name, true)} title="Send today even if a profile already ran or is not due by frequency">Run all now</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Recent runs" flush>
        {data.data.recent.length === 0 ? <Empty title="No runs recorded yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Job</th><th>Trigger</th><th>Status</th><th>Result</th></tr></thead>
              <tbody>
                {data.data.recent.map((r) => (
                  <tr key={r.id}><td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.started_at)}</td><td>{r.job}</td><td>{r.trigger}</td>
                    <td><Badge tone={tone[r.status]}>{r.status}</Badge></td><td className="cell-sub">{r.error ?? summary(r.detail)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
