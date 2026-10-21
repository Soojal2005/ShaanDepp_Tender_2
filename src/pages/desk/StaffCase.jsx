import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { can, useAuth } from '../../auth/AuthContext.jsx';
import { Badge, Button, Card, Field } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { api } from '../../lib/api.js';
import { formatDate, formatDateTime, formatInr } from '../../lib/format.js';
import { useAction, useAsync } from '../../lib/hooks.js';
import { DocumentsPanel, Fact, Stepper, STATUS_TONE } from './parts.jsx';

const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 5.5 * 3_600_000);
  return d.toISOString().slice(0, 16);
};
const fromLocalInput = (v) => (v ? new Date(`${v}:00+05:30`).toISOString() : null);

/** Runs a save, toasts the outcome and refreshes the case. */
function useSaver(reload) {
  const toast = useToast();
  const { pending, run } = useAction();
  const save = async (fn, message = 'Saved') => {
    const out = await run(fn);
    if (!out.ok) { toast.error(out.error.message); return false; }
    toast.success(message);
    reload();
    return true;
  };
  return { save, pending };
}

function Overview({ c, stages, reload }) {
  const { user } = useAuth();
  const { save, pending } = useSaver(reload);
  const team = useAsync(async () => (await api.get('/cases/team')).team, []);
  const [summary, setSummary] = useState(c.summary ?? '');
  const [deadline, setDeadline] = useState(toLocalInput(c.deadline));
  const [estimated, setEstimated] = useState(c.estimatedValue ?? '');
  const [emd, setEmd] = useState(c.emdAmount ?? '');
  const canAssign = can(user, 'cases:assign');
  const patch = () => save(() => api.patch(`/cases/${c.id}`, {
    clientSummary: summary.trim() || null, deadline: fromLocalInput(deadline), estimatedValue: estimated === '' ? null : Number(estimated), emdAmount: emd === '' ? null : Number(emd),
  }));
  return (
    <>
      <Card>
        <div className="fact-grid">
          <Fact label="Client">{c.client}</Fact>
          <Fact label="Tender">{c.tenderRef ?? '-'}</Fact>
          <Fact label="Department">{c.department ?? '-'}</Fact>
          <Fact label="Outcome"><Badge tone={c.outcome === 'l1' ? 'green' : c.outcome === 'pending' ? 'blue' : 'slate'}>{c.outcome.replace('_', ' ')}</Badge></Fact>
        </div>
        <Stepper stage={c.stage} label={(k) => stages.find((s) => s.key === k)?.label ?? k} />
        <div className="results-filters" style={{ marginTop: 14 }}>
          <label className="cell-sub">Stage
            <select className="select" style={{ marginLeft: 6 }} aria-label="Stage" value={c.stage} onChange={(e) => save(() => api.post(`/cases/${c.id}/stage`, { stage: e.target.value }), 'Stage updated')}>
              {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="cell-sub">Owner
            <select className="select" style={{ marginLeft: 6 }} aria-label="Owner" disabled={!canAssign} value={c.assignedTo ?? ''}
              onChange={(e) => save(() => api.post(`/cases/${c.id}/assign`, { userId: e.target.value ? Number(e.target.value) : null }), 'Owner updated')}>
              <option value="">Unassigned</option>
              {(team.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {c.stage !== 'closed' && c.outcome === 'pending' && (
            <>
              <Button size="sm" variant="outline" onClick={() => save(() => api.patch(`/cases/${c.id}`, { outcome: 'cancelled' }), 'Marked cancelled')}>Mark cancelled</Button>
              <Button size="sm" variant="outline" onClick={() => save(() => api.patch(`/cases/${c.id}`, { outcome: 'withdrawn' }), 'Marked withdrawn')}>Mark withdrawn</Button>
            </>
          )}
        </div>
        {c.requestNote && <p className="cell-sub" style={{ marginTop: 10 }}>Client note: {c.requestNote}</p>}
      </Card>

      <Card title="Details and summary shared with the client">
        <div className="grid-2">
          <Field label="Submission deadline (India time)">{(p) => <input {...p} className="input" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />}</Field>
          <Field label="Estimated value (₹)">{(p) => <input {...p} className="input" type="number" min="1" value={estimated} onChange={(e) => setEstimated(e.target.value)} />}</Field>
          <Field label="EMD amount (₹)">{(p) => <input {...p} className="input" type="number" min="1" value={emd} onChange={(e) => setEmd(e.target.value)} />}</Field>
        </div>
        <Field label="Summary for the client" hint="Plain language: what the tender needs, how long, any risks. The client reads this.">
          {(p) => <textarea {...p} className="input" rows={5} maxLength={5000} value={summary} onChange={(e) => setSummary(e.target.value)} />}
        </Field>
        <Button pending={pending} onClick={patch}>Save details</Button>
      </Card>
    </>
  );
}

function Checklists({ c, reload }) {
  const { save } = useSaver(reload);
  const [label, setLabel] = useState({ eligibility: '', technical: '' });
  const block = (kind, title) => (
    <Card title={title}>
      <ul className="check-list">
        {c.checklists[kind].map((i) => (
          <li key={i.id}>
            <div style={{ flex: 1 }}>
              <div>{i.label}</div>
              <input className="input" style={{ height: 28, marginTop: 4 }} aria-label={`Note for ${i.label}`} placeholder="Note" defaultValue={i.note ?? ''}
                onBlur={(e) => { if ((e.target.value || null) !== (i.note ?? null)) save(() => api.patch(`/cases/${c.id}/checklist/${i.id}`, { note: e.target.value.trim() || null })); }} />
            </div>
            <select className="select" style={{ width: 120 }} aria-label={`Status of ${i.label}`} value={i.status} onChange={(e) => save(() => api.patch(`/cases/${c.id}/checklist/${i.id}`, { status: e.target.value }))}>
              <option value="pending">Pending</option><option value="pass">Met</option><option value="fail">Not met</option><option value="na">Not applicable</option>
            </select>
            <Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge>
            <Button size="sm" variant="ghost" aria-label={`Remove ${i.label}`} onClick={() => save(() => api.delete(`/cases/${c.id}/checklist/${i.id}`), 'Removed')}><Trash2 size={13} /></Button>
          </li>
        ))}
      </ul>
      <div className="results-filters" style={{ marginTop: 10 }}>
        <input className="input" style={{ flex: 1 }} aria-label={`Add to ${title}`} placeholder="Add a check" value={label[kind]} onChange={(e) => setLabel({ ...label, [kind]: e.target.value })} />
        <Button size="sm" variant="outline" disabled={label[kind].trim().length < 2}
          onClick={async () => { if (await save(() => api.post(`/cases/${c.id}/checklist`, { kind, label: label[kind].trim() }), 'Added')) setLabel({ ...label, [kind]: '' }); }}><Plus size={13} />Add</Button>
      </div>
    </Card>
  );
  return <div className="grid-2">{block('eligibility', 'Eligibility & compliance')}{block('technical', 'Technical bid checklist')}</div>;
}

function Prebid({ c, reload }) {
  const { save } = useSaver(reload);
  const [query, setQuery] = useState('');
  const [answers, setAnswers] = useState({});
  return (
    <Card title="Pre-bid queries">
      {c.prebid.map((p) => (
        <div className="preview-item" style={{ display: 'block' }} key={p.id}>
          <b>{p.query}</b> <span className="cell-sub">{formatDate(p.raisedAt)}</span>
          {p.response ? <div style={{ marginTop: 4 }}><span className="cell-sub">Department: </span>{p.response}</div> : (
            <div className="results-filters" style={{ marginTop: 6 }}>
              <input className="input" style={{ flex: 1 }} aria-label="Department's response" placeholder="Department's response" value={answers[p.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [p.id]: e.target.value })} />
              <Button size="sm" variant="outline" disabled={!(answers[p.id] ?? '').trim()} onClick={() => save(() => api.patch(`/cases/${c.id}/prebid/${p.id}`, { response: answers[p.id].trim() }), 'Response recorded')}>Record response</Button>
            </div>
          )}
        </div>
      ))}
      <div className="results-filters" style={{ marginTop: 10 }}>
        <input className="input" style={{ flex: 1 }} aria-label="New pre-bid query" placeholder="Raise a pre-bid query" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button size="sm" disabled={query.trim().length < 3} onClick={async () => { if (await save(() => api.post(`/cases/${c.id}/prebid`, { query: query.trim() }), 'Query raised')) setQuery(''); }}>Raise query</Button>
      </div>
    </Card>
  );
}

function Strategy({ c, reload }) {
  const { save, pending } = useSaver(reload);
  const [strategy, setStrategy] = useState(c.internal.financialStrategy);
  const [margin, setMargin] = useState(c.internal.marginNotes);
  const [note, setNote] = useState('');
  const ra = c.internal.rateAnalysis;
  return (
    <Card title="Financial bid strategy (internal, never shown to the client)">
      <Field label="Strategy">{(p) => <textarea {...p} className="input" rows={4} value={strategy} onChange={(e) => setStrategy(e.target.value)} />}</Field>
      <Field label="Margin notes">{(p) => <textarea {...p} className="input" rows={2} value={margin} onChange={(e) => setMargin(e.target.value)} />}</Field>
      <Button pending={pending} onClick={() => save(() => api.put(`/cases/${c.id}/internal`, { financialStrategy: strategy, marginNotes: margin }))}>Save strategy</Button>
      <h4 className="drawer-h">Rate analysis from published results</h4>
      {ra ? (
        <div className="note note-info" style={{ display: 'block' }}>
          Taken {formatDateTime(ra.takenAt)} from {ra.basis}: {ra.overall.withRate} awards with a published rate.{' '}
          {ra.band ? `Winning bids landed ${ra.band.lowPct}% to ${ra.band.highPct}% against the estimate (median ${ra.band.medianPct}%)${ra.band.low ? `, which is ${formatInr(ra.band.low)} to ${formatInr(ra.band.high)} for this tender` : ''}.` : ra.bandNote}
        </div>
      ) : <p className="cell-sub">Not attached yet.</p>}
      <Button size="sm" variant="outline" onClick={() => save(() => api.post(`/cases/${c.id}/rate-analysis`), 'Rate analysis attached')}>{ra ? 'Refresh rate analysis' : 'Attach rate analysis'}</Button>
      <h4 className="drawer-h">Internal notes</h4>
      <div className="results-filters">
        <input className="input" style={{ flex: 1 }} aria-label="Internal note" placeholder="Add a note for the team" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" variant="outline" disabled={!note.trim()} onClick={async () => { if (await save(() => api.post(`/cases/${c.id}/notes`, { text: note.trim() }), 'Note added')) setNote(''); }}>Add note</Button>
      </div>
      {c.notes.map((n) => <div className="preview-item" key={n.id} style={{ display: 'block' }}>{n.text}<div className="cell-sub">{n.author} · {formatDateTime(n.createdAt)}</div></div>)}
    </Card>
  );
}

function SubmissionResult({ c, reload }) {
  const { save, pending } = useSaver(reload);
  const s = c.submission;
  const r = c.result;
  const [sub, setSub] = useState({ mode: s?.mode ?? 'online', portalReference: s?.portalReference ?? '', courierName: s?.courierName ?? '', trackingNumber: s?.trackingNumber ?? '' });
  const [res, setRes] = useState({
    technicalStatus: r?.technicalStatus ?? 'pending', financialStatus: r?.financialStatus ?? 'pending', outcome: r?.outcome ?? 'pending',
    ourAmount: r?.ourAmount ?? '', l1Amount: r?.l1Amount ?? '', resultDate: r?.resultDate ?? '', remarks: r?.remarks ?? '',
  });
  const num = (v) => (v === '' ? null : Number(v));
  return (
    <div className="grid-2">
      <Card title="Submission">
        <Field label="How was it submitted?">{(p) => (
          <select {...p} className="select" value={sub.mode} onChange={(e) => setSub({ ...sub, mode: e.target.value })}><option value="online">Online (portal)</option><option value="offline">Offline (courier / speed post)</option></select>)}</Field>
        {sub.mode === 'online'
          ? <Field label="Portal reference">{(p) => <input {...p} className="input" value={sub.portalReference} onChange={(e) => setSub({ ...sub, portalReference: e.target.value })} />}</Field>
          : <><Field label="Courier">{(p) => <input {...p} className="input" value={sub.courierName} onChange={(e) => setSub({ ...sub, courierName: e.target.value })} />}</Field>
            <Field label="Tracking number">{(p) => <input {...p} className="input" value={sub.trackingNumber} onChange={(e) => setSub({ ...sub, trackingNumber: e.target.value })} />}</Field></>}
        <Button pending={pending} onClick={() => save(() => api.put(`/cases/${c.id}/submission`, sub.mode === 'online'
          ? { mode: 'online', portalReference: sub.portalReference.trim() }
          : { mode: 'offline', courierName: sub.courierName.trim() || undefined, trackingNumber: sub.trackingNumber.trim() }), 'Submission recorded')}>Save submission</Button>
        {s && <p className="cell-sub" style={{ marginTop: 8 }}>Recorded {formatDateTime(s.submittedAt)}</p>}
      </Card>
      <Card title="Opening and result">
        <div className="grid-2">
          <Field label="Technical">{(p) => <select {...p} className="select" value={res.technicalStatus} onChange={(e) => setRes({ ...res, technicalStatus: e.target.value })}><option value="pending">Pending</option><option value="qualified">Qualified</option><option value="disqualified">Disqualified</option></select>}</Field>
          <Field label="Financial">{(p) => <select {...p} className="select" value={res.financialStatus} onChange={(e) => setRes({ ...res, financialStatus: e.target.value })}><option value="pending">Pending</option><option value="opened">Opened</option><option value="evaluated">Evaluated</option></select>}</Field>
          <Field label="Result">{(p) => <select {...p} className="select" value={res.outcome} onChange={(e) => setRes({ ...res, outcome: e.target.value })}><option value="pending">Not out yet</option><option value="l1">Won (L1)</option><option value="not_l1">Not L1</option></select>}</Field>
          <Field label="Result date">{(p) => <input {...p} className="input" type="date" value={res.resultDate} onChange={(e) => setRes({ ...res, resultDate: e.target.value })} />}</Field>
          <Field label="Our bid (₹)">{(p) => <input {...p} className="input" type="number" min="1" value={res.ourAmount} onChange={(e) => setRes({ ...res, ourAmount: e.target.value })} />}</Field>
          <Field label="L1 bid (₹)">{(p) => <input {...p} className="input" type="number" min="1" value={res.l1Amount} onChange={(e) => setRes({ ...res, l1Amount: e.target.value })} />}</Field>
        </div>
        <Field label="Remarks" optional="optional">{(p) => <input {...p} className="input" maxLength={2000} value={res.remarks} onChange={(e) => setRes({ ...res, remarks: e.target.value })} />}</Field>
        <Button pending={pending} onClick={() => save(() => api.put(`/cases/${c.id}/result`, { ...res, ourAmount: num(res.ourAmount), l1Amount: num(res.l1Amount), resultDate: res.resultDate || null, remarks: res.remarks.trim() || null }), 'Result recorded')}>Save result</Button>
      </Card>
    </div>
  );
}

function EmdFollowups({ c, reload }) {
  const { save, pending } = useSaver(reload);
  const blank = { instrumentType: 'Bank Guarantee', issuingBank: '', instrumentNumber: '', amount: c.emdAmount ?? '', validTill: '' };
  const [form, setForm] = useState(blank);
  const [fu, setFu] = useState({ kind: 'purchase_order', dueDate: '' });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="grid-2">
      <Card title="EMD">
        {c.emd.map((e) => (
          <div className="preview-item" key={e.id}>
            <div><b>{e.instrumentType}</b>{e.issuingBank ? `, ${e.issuingBank}` : ''}{e.instrumentNumber ? ` (${e.instrumentNumber})` : ''}<div className="cell-sub">{formatInr(e.amount, '-')} · valid till {e.validTill ?? '-'}</div></div>
            <select className="select" style={{ width: 150 }} aria-label="Refund status" value={e.refundStatus}
              onChange={(ev) => save(() => api.patch(`/cases/${c.id}/emd/${e.id}`, { instrumentType: e.instrumentType, issuingBank: e.issuingBank ?? undefined, instrumentNumber: e.instrumentNumber ?? undefined, amount: e.amount, validTill: e.validTill, refundStatus: ev.target.value }))}>
              {['Pending', 'Refunded', 'Forfeited', 'Converted to PBG'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>))}
        <div className="grid-2" style={{ marginTop: 8 }}>
          <Field label="Instrument">{(p) => <select {...p} className="select" value={form.instrumentType} onChange={set('instrumentType')}>{['Bank Guarantee', 'FDR', 'Demand Draft', 'Online Portal', 'Exempted'].map((s) => <option key={s}>{s}</option>)}</select>}</Field>
          <Field label="Bank">{(p) => <input {...p} className="input" value={form.issuingBank} onChange={set('issuingBank')} />}</Field>
          <Field label="Number">{(p) => <input {...p} className="input" value={form.instrumentNumber} onChange={set('instrumentNumber')} />}</Field>
          <Field label="Amount (₹)">{(p) => <input {...p} className="input" type="number" min="1" value={form.amount} onChange={set('amount')} />}</Field>
          <Field label="Valid till">{(p) => <input {...p} className="input" type="date" value={form.validTill} onChange={set('validTill')} />}</Field>
        </div>
        <Button pending={pending} variant="outline" onClick={async () => { if (await save(() => api.post(`/cases/${c.id}/emd`, { ...form, issuingBank: form.issuingBank.trim() || undefined, instrumentNumber: form.instrumentNumber.trim() || undefined, amount: form.amount === '' ? null : Number(form.amount), validTill: form.validTill || null }), 'EMD recorded')) setForm(blank); }}>Add EMD record</Button>
      </Card>
      <Card title="Follow-up after the result">
        {c.followups.length === 0 && <p className="cell-sub">Created automatically when the result is recorded.</p>}
        {c.followups.map((f) => (
          <div className="preview-item" key={f.id}>
            <div><b>{f.kind.replace('_', ' ')}</b><div className="cell-sub">{f.dueDate ? `Due ${f.dueDate}` : 'No due date'}{f.reference ? ` · ${f.reference}` : ''}</div></div>
            {f.status === 'done' ? <Badge tone="green">Done</Badge> : <Button size="sm" variant="outline" onClick={() => { const ref = window.prompt('Reference (receipt, PO or payment number), optional') ?? undefined; save(() => api.patch(`/cases/${c.id}/followups/${f.id}`, { status: 'done', reference: ref?.trim() || undefined }), 'Marked done'); }}>Mark done</Button>}
          </div>))}
        <div className="results-filters" style={{ marginTop: 8 }}>
          <select className="select" aria-label="Follow-up type" value={fu.kind} onChange={(e) => setFu({ ...fu, kind: e.target.value })}><option value="emd_refund">EMD refund</option><option value="purchase_order">Purchase order</option><option value="payment">Payment</option></select>
          <input className="input" type="date" aria-label="Due date" style={{ width: 150 }} value={fu.dueDate} onChange={(e) => setFu({ ...fu, dueDate: e.target.value })} />
          <Button size="sm" variant="outline" onClick={() => save(() => api.post(`/cases/${c.id}/followups`, { kind: fu.kind, dueDate: fu.dueDate || null }), 'Follow-up added')}>Add</Button>
        </div>
      </Card>
    </div>
  );
}

export default function StaffCase({ data, stages, reload }) {
  const c = data;
  return (
    <>
      <Overview c={c} stages={stages} reload={reload} />
      <Checklists c={c} reload={reload} />
      <Prebid c={c} reload={reload} />
      <Strategy c={c} reload={reload} />
      <SubmissionResult c={c} reload={reload} />
      <EmdFollowups c={c} reload={reload} />
      <Card title="Documents"><DocumentsPanel caseData={c} staff onChange={reload} /></Card>
      <Card title="Activity" flush>
        <div className="table-wrap"><table className="table"><tbody>
          {c.activity.map((a) => <tr key={a.id}><td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(a.at)}</td><td>{a.user}</td><td>{a.action}</td></tr>)}
        </tbody></table></div>
      </Card>
    </>
  );
}
