import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.jsx';
import RequestHelp from '../../components/desk/RequestHelp.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader } from '../../components/ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime, formatInr } from '../../lib/format.js';
import { useAsync } from '../../lib/hooks.js';

const OUTCOME_TONE = { pending: 'blue', l1: 'green', not_l1: 'slate', cancelled: 'slate', withdrawn: 'slate' };

function Progress({ index }) {
  const total = 9; // closed is not a step of work
  return (
    <div className="stage-bar" role="img" aria-label={`${Math.min(index + 1, total)} / ${total}`}>
      {Array.from({ length: total }, (_, i) => <span key={i} className={i <= index ? 'on' : ''} />)}
    </div>
  );
}

function DeadlineText({ c }) {
  const { lang } = useI18n();
  if (!c.deadline) return '-';
  const risky = c.stage !== 'closed' && c.hoursToDeadline !== null && c.hoursToDeadline <= 72 && c.hoursToDeadline > -1;
  return <span style={risky ? { color: '#B91C1C', fontWeight: 600 } : undefined}>{formatDateTime(c.deadline, lang)}</span>;
}

function ClientDesk() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [scope, setScope] = useState('open');
  const [asking, setAsking] = useState(false);
  const data = useAsync(async () => (await api.get('/cases', { query: { scope } })).cases, [scope]);
  return (
    <>
      <PageHeader title={t('desk.title')} subtitle={t('desk.subtitle')} crumbs={[{ label: t('nav.home'), to: '/app' }, { label: t('nav.desk') }]}
        actions={<Button onClick={() => setAsking(true)}><Plus size={15} />{t('desk.newRequest')}</Button>} />
      <div className="tabs" role="tablist">
        {[['open', t('desk.tabOpen')], ['closed', t('desk.tabClosed')]].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={scope === key} className={`tab ${scope === key ? 'active' : ''}`} onClick={() => setScope(key)}>{label}</button>
        ))}
      </div>
      <Card flush>
        {data.loading && !data.data && <Loading label={t('common.loading')} />}
        <ErrorNote error={data.error} onRetry={data.reload} retryLabel={t('common.retry')} />
        {data.data?.length === 0 && <Empty title={t('desk.empty')}>{t('desk.emptyHint')}</Empty>}
        {data.data?.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('desk.colTender')}</th><th>{t('desk.colStage')}</th><th>{t('desk.colDeadline')}</th><th>{t('desk.colOwner')}</th></tr></thead>
            <tbody>{data.data.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => navigate(`/app/desk/${c.id}`)}>
                <td style={{ maxWidth: 360 }}><div className="cell-title">{c.title}</div><div className="cell-sub">{c.ref}{c.department ? ` · ${c.department}` : ''}</div></td>
                <td>
                  <div>{t(`desk.stage.${c.stage}`)} {c.outcome !== 'pending' && <Badge tone={OUTCOME_TONE[c.outcome]}>{t(`desk.outcome.${c.outcome}`)}</Badge>}</div>
                  <Progress index={c.stageIndex} />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}><DeadlineText c={c} /></td>
                <td>{c.assignedName ?? <span className="cell-sub">{t('desk.unassigned')}</span>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      {asking && <RequestHelp onClose={() => setAsking(false)} />}
      <span hidden>{lang}</span>
    </>
  );
}

function StaffDesk() {
  const navigate = useNavigate();
  const [scope, setScope] = useState('open');
  const [stage, setStage] = useState('');
  const [mine, setMine] = useState('');
  const [text, setText] = useState('');
  const { user } = useAuth();
  const summary = useAsync(() => api.get('/cases/summary'), []);
  const list = useAsync(async () => (await api.get('/cases', { query: { scope, stage: stage || undefined, text: text || undefined, assignedTo: mine === 'me' ? user.id : mine || undefined } })).cases, [scope, stage, mine, text]);
  const s = summary.data;
  const record = (rows, title) => (
    <Card title={title} flush>
      {rows.length === 0 ? <p className="cell-sub" style={{ padding: 20 }}>No cases yet.</p> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th /><th className="num">Won</th><th className="num">Not L1</th><th className="num">Open</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.label}><td className="cell-title">{r.label}</td><td className="num">{r.won}</td><td className="num">{r.lost}</td><td className="num">{r.open}</td></tr>)}</tbody>
        </table></div>
      )}
    </Card>
  );
  return (
    <>
      <PageHeader title="Submission Desk" subtitle="Every client request, from intake to follow-up." crumbs={[{ label: 'Home', to: '/app' }, { label: 'Submission Desk' }]}
        actions={<NewForClient onCreated={(id) => navigate(`/app/desk/${id}`)} />} />
      <ErrorNote error={summary.error} onRetry={summary.reload} />
      {s && (
        <>
          <div className="kpi-cards-grid">
            {[['Open cases', s.open], ['Unassigned', s.unassigned], ['Deadline within 72 hours', s.atRisk.length], ['EMD outstanding', s.emdOutstanding.amount ? formatInr(s.emdOutstanding.amount) : '-', `${s.emdOutstanding.instruments} instrument(s)`]].map(([label, value, note]) => (
              <div key={label} className="kpi-metric-card"><div className="kpi-numbers-wrap"><div className="kpi-big-value tabular-nums">{value}</div><div className="kpi-label-text">{label}</div>{note && <div className="cell-sub">{note}</div>}</div></div>
            ))}
          </div>
          <Card title="Open cases by stage">
            <div className="stage-counts">
              {s.stages.map((x) => (
                <button key={x.key} type="button" className={`stage-count ${stage === x.key ? 'active' : ''}`} onClick={() => { setStage(stage === x.key ? '' : x.key); setScope('open'); }}>
                  <b>{x.count}</b><span>{x.label}</span>
                </button>
              ))}
            </div>
          </Card>
          {s.atRisk.length > 0 && (
            <Card title="Deadline risk: not yet submitted" flush>
              <div className="table-wrap"><table className="table"><tbody>{s.atRisk.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => navigate(`/app/desk/${c.id}`)}>
                  <td><div className="cell-title">{c.title}</div><div className="cell-sub">{c.ref} · {c.client}</div></td>
                  <td>{c.stageLabel}</td><td><DeadlineText c={c} /></td><td>{c.assignedName ?? <Badge tone="amber">Unassigned</Badge>}</td>
                </tr>))}</tbody></table></div>
            </Card>
          )}
          {s.followupsDue.length > 0 && (
            <Card title="Follow-ups due this week" flush>
              <div className="table-wrap"><table className="table"><tbody>{s.followupsDue.map((f) => (
                <tr key={f.id} className="clickable" onClick={() => navigate(`/app/desk/${f.caseId}`)}>
                  <td className="cell-title">{f.kind.replace('_', ' ')}</td><td>{f.title}<div className="cell-sub">{f.client}</div></td><td>{f.dueDate}</td><td>{f.assignedName ?? '-'}</td>
                </tr>))}</tbody></table></div>
            </Card>
          )}
          <div className="grid-2">{record(s.byClient, 'Record by client')}{record(s.byDepartment, 'Record by department')}</div>
        </>
      )}

      <Card title="Cases" flush actions={
        <div className="results-filters">
          <select className="select" style={{ height: 32 }} aria-label="Show" value={scope} onChange={(e) => setScope(e.target.value)}><option value="open">Open</option><option value="closed">Closed</option><option value="all">All</option></select>
          <select className="select" style={{ height: 32 }} aria-label="Owner" value={mine} onChange={(e) => setMine(e.target.value)}><option value="">Anyone</option><option value="me">Mine</option><option value="unassigned">Unassigned</option></select>
          <input className="input" style={{ height: 32, width: 190 }} placeholder="Search tender or client" aria-label="Search cases" value={text} onChange={(e) => setText(e.target.value)} />
        </div>}>
        {list.loading && !list.data && <Loading />}
        {list.data?.length === 0 && <Empty title="No cases match" />}
        {list.data?.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Tender</th><th>Client</th><th>Stage</th><th>Deadline</th><th>Owner</th></tr></thead>
            <tbody>{list.data.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => navigate(`/app/desk/${c.id}`)}>
                <td style={{ maxWidth: 340 }}><div className="cell-title">{c.title}</div><div className="cell-sub">{c.ref}{c.department ? ` · ${c.department}` : ''}</div></td>
                <td>{c.client}</td>
                <td><div>{c.stageLabel} {c.outcome !== 'pending' && <Badge tone={OUTCOME_TONE[c.outcome]}>{c.outcome.replace('_', ' ')}</Badge>}</div><Progress index={c.stageIndex} /></td>
                <td style={{ whiteSpace: 'nowrap' }}><DeadlineText c={c} /></td>
                <td>{c.assignedName ?? <Badge tone="amber">Unassigned</Badge>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

/** Staff raising a request on a client's behalf (a phone or WhatsApp request). */
function NewForClient({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [orgId, setOrgId] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const orgs = useAsync(async () => (open ? (await api.get('/cases/clients')).clients : null), [open]);
  const send = async (e) => {
    e.preventDefault();
    try {
      const out = await api.post('/cases', { orgId: Number(orgId), title: title.trim(), note: note.trim() || undefined });
      onCreated(out.id);
    } catch (err) { setError(err); }
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus size={15} />New request for a client</Button>
      {open && <NewModal {...{ orgs, orgId, setOrgId, title, setTitle, note, setNote, error, send, onClose: () => setOpen(false) }} />}
    </>
  );
}

function NewModal({ orgs, orgId, setOrgId, title, setTitle, note, setNote, error, send, onClose }) {
  return (
    <Modal title="New request for a client" onClose={onClose} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="staff-new" disabled={!orgId || title.trim().length < 3}>Create case</Button></>}>
      <form id="staff-new" onSubmit={send}>
        <Field label="Client">{(p) => (
          <select {...p} className="select" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">Choose a client...</option>
            {(orgs.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>)}
        </Field>
        <Field label="Tender title or number">{(p) => <input {...p} className="input" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Note" optional="optional">{(p) => <textarea {...p} className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

export default function Desk() {
  const { user } = useAuth();
  return ['analyst', 'case_manager', 'platform_admin'].includes(user.role) ? <StaffDesk /> : <ClientDesk />;
}
