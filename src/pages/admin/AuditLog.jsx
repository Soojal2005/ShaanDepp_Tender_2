import { useState } from 'react';
import { Button, Card, Empty, ErrorNote, Loading, PageHeader } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useAsync } from '../../lib/hooks.js';

const PAGE = 100;

export default function AuditLog() {
  const [extra, setExtra] = useState([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);
  const first = useAsync(async () => { setExtra([]); return (await api.get('/admin/audit', { query: { limit: PAGE } })).events; }, []);

  const events = [...(first.data ?? []), ...extra];
  const last = events[events.length - 1];
  const canLoadMore = first.data && (extra.length ? extra.length % PAGE === 0 : first.data.length === PAGE);

  const more = async () => {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = (await api.get('/admin/audit', { query: { limit: PAGE, before: last.id } })).events;
      setExtra((e) => [...e, ...page]);
    } catch (err) {
      setMoreError(err);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Sign-ins, account and plan changes and master-data edits. Entries can be read but never altered or deleted."
        crumbs={[{ label: 'Administration' }, { label: 'Audit log' }]}
        actions={<Button variant="outline" onClick={first.reload}>Refresh</Button>}
      />
      <Card flush>
        {first.loading && !first.data && <Loading />}
        <ErrorNote error={first.error} onRetry={first.reload} />
        {first.data && events.length === 0 && <Empty title="Nothing recorded yet" />}
        {events.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Org</th><th>IP</th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.created_at)}</td>
                    <td>{e.actor_email ?? <span className="cell-sub">anonymous</span>}</td>
                    <td><code>{e.action}</code></td>
                    <td>
                      {e.resource_type}{e.resource_id ? ` #${e.resource_id}` : ''}
                      {e.metadata && <div className="cell-sub" title={JSON.stringify(e.metadata)}>{JSON.stringify(e.metadata).slice(0, 80)}</div>}
                    </td>
                    <td>{e.organization_id ?? '-'}</td>
                    <td className="cell-sub">{e.ip_address ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ErrorNote error={moreError} />
        {canLoadMore && (
          <div style={{ padding: 14, textAlign: 'center' }}>
            <Button variant="outline" pending={loadingMore} onClick={more}>Load older entries</Button>
          </div>
        )}
      </Card>
    </>
  );
}
