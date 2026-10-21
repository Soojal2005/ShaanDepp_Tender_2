import { useEffect, useState } from 'react';
import { AlertTriangle, Eye, RefreshCw, RotateCcw, Send, XCircle } from 'lucide-react';
import { useToast } from '../../components/Toast.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Loading, Modal, PageHeader } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useAsync } from '../../lib/hooks.js';

const tone = { queued: 'blue', sending: 'blue', sent: 'green', failed: 'red', dry_run: 'amber', cancelled: 'slate' };

function Usage({ label, used, limit }) {
  return (
    <div style={{ minWidth: 200 }}>
      <div className="cell-sub">{label}</div>
      <b className="tabular-nums">{used} / {limit.toLocaleString('en-IN')}</b>
      <div className="meter"><span style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} /></div>
    </div>
  );
}

function MessageModal({ id, onClose }) {
  const data = useAsync(() => api.get(`/admin/mail/messages/${id}`), [id]);
  const m = data.data?.message;
  return (
    <Modal wide title={m ? m.subject : 'Message'} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      {data.loading && !m && <Loading />}
      <ErrorNote error={data.error} />
      {m && (
        <>
          <dl className="kv" style={{ marginBottom: 14 }}>
            <dt>To</dt><dd>{m.recipient}</dd>
            <dt>Kind</dt><dd>{m.kind}{m.profile_name ? ` · ${m.profile_name}` : ''}</dd>
            <dt>Status</dt><dd><Badge tone={tone[m.status]}>{m.status}</Badge> after {m.attempts} attempt(s){m.last_error ? ` · ${m.last_error}` : ''}</dd>
          </dl>
          {data.data.attempts.length > 0 && (
            <ul className="doc-list" style={{ marginBottom: 14 }}>
              {data.data.attempts.map((a, i) => <li key={i}><span>{formatDateTime(a.attempted_at)} · <b>{a.outcome}</b>{a.detail ? ` · ${a.detail}` : ''}</span><span className="cell-sub">{a.response_code ?? ''}</span></li>)}
            </ul>
          )}
          {/* Rendered in a sandbox with no scripts, so message HTML cannot run anything here. */}
          <iframe title="Message preview" className="mail-preview" sandbox="" srcDoc={m.html_body} />
        </>
      )}
    </Modal>
  );
}

export default function MailQueue() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [viewing, setViewing] = useState(null);
  const overview = useAsync(() => api.get('/admin/mail/status'), []);
  const messages = useAsync(async () => (await api.get('/admin/mail/messages', { query: { status, limit: 50 } })).messages, [status]);
  const bounces = useAsync(async () => (await api.get('/admin/mail/bounces')).bounces, []);

  useEffect(() => {
    const timer = setInterval(() => { overview.reload(); messages.reload(); }, 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const act = async (fn, message) => {
    try { await fn(); if (message) toast.success(message); overview.reload(); messages.reload(); bounces.reload(); } catch (err) { toast.error(err.message); }
  };

  if (overview.loading && !overview.data) return <Loading />;
  if (overview.error && !overview.data) return <ErrorNote error={overview.error} onRetry={overview.reload} />;
  const o = overview.data;
  const count = (s) => o.counts.byStatus[s] ?? 0;

  return (
    <>
      <PageHeader
        title="Mail queue"
        subtitle="Every alert, reminder and account email passes through here before it is sent from your Microsoft 365 mailbox."
        crumbs={[{ label: 'Administration' }, { label: 'Mail queue' }]}
        actions={<><Button variant="outline" onClick={() => { overview.reload(); messages.reload(); }}><RefreshCw size={15} />Refresh</Button>
          <Button onClick={() => act(() => api.post('/admin/mail/drain'), 'Queue processed')}><Send size={15} />Send now</Button></>}
      />

      {o.mode === 'dry_run' ? (
        <div className="note note-warn"><AlertTriangle size={16} /><span><b>Dry-run mode.</b> Emails are saved as files in <code>{o.outboxDir}</code> and are <b>not delivered</b>. To send for real, set MAIL_MODE=live with the Microsoft 365 app credentials (see the setup guide).</span></div>
      ) : (
        <div className="note note-success">Sending live from <b>{o.sender}</b> through Microsoft Graph. Copies are kept in that mailbox's Sent Items.</div>
      )}
      {o.pause && (
        <div className="note note-error"><AlertTriangle size={16} /><span>Sending is paused until {formatDateTime(o.pause.until)}: {o.pause.reason}</span>
          <button type="button" className="link-btn" onClick={() => act(() => api.post('/admin/mail/resume'), 'Sending resumed')}>Resume now</button></div>
      )}

      <Card>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {[['Waiting', count('queued') + count('sending')], ['Sent', count('sent')], ['Failed', count('failed')], ['Dry run', count('dry_run')]].map(([label, n]) => (
            <div key={label}><div className="kpi-big-value tabular-nums">{n}</div><div className="kpi-label-text">{label}</div></div>
          ))}
          <Usage label="Sent in the last minute" used={o.counts.sentLastMinute} limit={o.limits.perMinute} />
          <Usage label="Sent in the last 24 hours" used={o.counts.sentLastDay} limit={o.limits.perDay} />
        </div>
      </Card>

      <Card title="Messages" flush actions={
        <select className="select" style={{ height: 32, width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All</option>{['queued', 'sent', 'failed', 'dry_run', 'cancelled'].map((s) => <option key={s}>{s}</option>)}
        </select>}>
        {messages.loading && !messages.data && <Loading />}
        {messages.data?.length === 0 && <Empty title="No messages" />}
        {messages.data?.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>#</th><th>To</th><th>Subject</th><th>Status</th><th className="num">Tries</th><th>Created</th><th /></tr></thead>
              <tbody>
                {messages.data.map((m) => (
                  <tr key={m.id}>
                    <td>{m.id}</td>
                    <td><div className="cell-title">{m.recipient}</div><div className="cell-sub">{m.kind}</div></td>
                    <td style={{ maxWidth: 340 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.subject}</div>{m.last_error && <div className="cell-sub" style={{ color: '#B91C1C' }}>{m.last_error}</div>}</td>
                    <td><Badge tone={tone[m.status]}>{m.status}</Badge></td>
                    <td className="num">{m.attempts}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(m.created_at)}</td>
                    <td>
                      <div className="row-actions">
                        <Button size="sm" variant="outline" onClick={() => setViewing(m.id)} aria-label={`View message ${m.id}`}><Eye size={13} /></Button>
                        {['failed', 'cancelled'].includes(m.status) && <Button size="sm" variant="outline" onClick={() => act(() => api.post(`/admin/mail/messages/${m.id}/retry`), 'Queued again')}><RotateCcw size={13} />Retry</Button>}
                        {m.status === 'queued' && <Button size="sm" variant="danger" onClick={() => act(() => api.post(`/admin/mail/messages/${m.id}/cancel`), 'Cancelled')}><XCircle size={13} />Cancel</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Bounced addresses (${bounces.data?.length ?? 0})`} flush>
        <p className="cell-sub" style={{ padding: '12px 20px 0' }}>Permanent failures are never mailed again until cleared. {o.bouncePolling ? 'Delivery-failure notices are read from the sending mailbox automatically.' : 'Automatic reading of delivery failures is off (GRAPH_BOUNCE_POLL).'}</p>
        {bounces.data?.length === 0 ? <Empty title="No bounces recorded" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Address</th><th>Type</th><th>When</th><th>Detail</th><th /></tr></thead>
              <tbody>
                {bounces.data?.map((b) => (
                  <tr key={b.id}>
                    <td className="cell-title">{b.recipient_email}</td><td><Badge tone={b.bounce_type === 'soft' ? 'amber' : 'red'}>{b.bounce_type}</Badge></td>
                    <td>{formatDateTime(b.created_at)}</td><td className="cell-sub" style={{ maxWidth: 380 }}>{(b.raw_diagnostic ?? '').slice(0, 140)}</td>
                    <td><div className="row-actions"><Button size="sm" variant="outline" onClick={() => act(() => api.delete(`/admin/mail/bounces/${b.id}`), 'Cleared')}>Clear</Button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {viewing && <MessageModal id={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
