import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Mail, MessageCircle, Phone, UserPlus } from 'lucide-react';
import { can, useAuth } from '../../auth/AuthContext.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useAction, useAsync } from '../../lib/hooks.js';

const STATUSES = ['New', 'Contacted', 'Qualified', 'Closed'];
const tone = { New: 'blue', Contacted: 'amber', Qualified: 'green', Converted: 'green', Closed: 'slate' };

// What role the admin can grant when approving a request. Staff roles land in the Shan-Deep staff organization.
const STAFF_ROLES = ['analyst', 'case_manager', 'platform_admin'];
const ROLE_OPTIONS = [
  { value: 'subscriber', label: 'Subscriber (client user)' },
  { value: 'tenant_admin', label: 'Organization admin (client)' },
  { value: 'analyst', label: 'Analyst (Shan-Deep staff)' },
  { value: 'case_manager', label: 'Case manager (Shan-Deep staff)' },
  { value: 'platform_admin', label: 'Platform admin (Shan-Deep staff)' },
];

/** Approve an access request: create the person's login with a chosen role and target organization. */
function ApproveModal({ enquiry, plans, onClose, onApproved }) {
  const { pending, run } = useAction();
  const [error, setError] = useState(null);
  const [role, setRole] = useState('subscriber');
  const [target, setTarget] = useState('new_org');
  const [orgId, setOrgId] = useState('');
  const [planCode, setPlanCode] = useState(plans[0]?.code ?? '');
  const [orgName, setOrgName] = useState(enquiry.company);
  const [name, setName] = useState(enquiry.name);
  const [personEmail, setPersonEmail] = useState(enquiry.email);
  const orgs = useAsync(async () => (await api.get('/admin/organizations')).organizations, []);
  const isStaff = STAFF_ROLES.includes(role);
  const clientOrgs = (orgs.data ?? []).filter((o) => !o.isStaffOrg);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const body = { role, name: name.trim(), email: personEmail.trim() };
    if (!isStaff) {
      body.target = target;
      if (target === 'existing_org') body.orgId = Number(orgId);
      else { body.orgName = orgName.trim(); body.planCode = planCode; }
    }
    const result = await run(() => api.post(`/admin/enquiries/${enquiry.id}/approve`, body));
    if (!result.ok) return setError(result.error);
    onApproved(result.value);
  };

  const canSubmit = name.trim() && personEmail.trim()
    && (isStaff || (target === 'existing_org' ? orgId : orgName.trim() && planCode));

  return (
    <Modal
      wide
      title="Approve access request"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="approve-form" pending={pending} disabled={!canSubmit}>Approve and send invite</Button>
        </>
      }
    >
      <ErrorNote error={error} />
      <div className="note note-info">The person gets an email to set their password. Company details from the request are carried over, and a starter alert profile is built from their industry and keywords.</div>
      <form id="approve-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Register as (role)">
            {(p) => (
              <select {...p} className="select" value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
          </Field>
          {!isStaff && (
            <Field label="Add to">
              {(p) => (
                <select {...p} className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="new_org">A new organization</option>
                  <option value="existing_org">An existing organization</option>
                </select>
              )}
            </Field>
          )}
          {!isStaff && target === 'new_org' && (
            <>
              <Field label="Organization name">{(p) => <input {...p} className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />}</Field>
              <Field label="Plan">
                {(p) => (
                  <select {...p} className="select" value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                    {plans.filter((pl) => pl.is_active).map((pl) => <option key={pl.code} value={pl.code}>{pl.name} ({pl.daily_alert_cap} alerts/day)</option>)}
                  </select>
                )}
              </Field>
            </>
          )}
          {!isStaff && target === 'existing_org' && (
            <Field label="Organization">
              {(p) => (
                <select {...p} className="select" value={orgId} onChange={(e) => setOrgId(e.target.value)} required>
                  <option value="" disabled>{orgs.loading ? 'Loading…' : 'Select organization'}</option>
                  {clientOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              )}
            </Field>
          )}
        </div>
        {isStaff && <p className="cell-sub" style={{ margin: '0 0 10px' }}>Staff roles are added to the Shan-Deep staff organization.</p>}
        <h4 style={{ margin: '6px 0 10px', fontSize: 13 }}>Person</h4>
        <div className="form-grid">
          <Field label="Name">{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
          <Field label="Email" hint="They receive a link to set their password.">
            {(p) => <input {...p} className="input" type="email" value={personEmail} onChange={(e) => setPersonEmail(e.target.value)} required />}
          </Field>
        </div>
      </form>
    </Modal>
  );
}

const COPY = {
  general: {
    title: 'Website enquiries',
    subtitle: "Leads from the company website. Each one carries the visitor's recorded DPDP consent.",
    empty: 'New website enquiries will appear here.',
  },
  access_request: {
    title: 'Access requests',
    subtitle: 'Businesses asking for a portal account. Contact them, then create their organization to send the invitation.',
    empty: 'Requests from the Request access page will appear here.',
  },
};

function EnquiryCard({ enquiry, kind, canConvert, onConvert, onChanged }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const converted = enquiry.status === 'Converted';

  const update = async (body, done) => {
    setBusy(true);
    try {
      await api.patch(`/admin/enquiries/${enquiry.id}`, body);
      toast.success(done);
      setNote('');
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const digits = (enquiry.phone ?? '').replace(/\D/g, '');
  return (
    <Card
      title={`${enquiry.company} · ${enquiry.name}`}
      actions={
        <select className="select" style={{ height: 30, fontSize: 12, width: 130 }} value={enquiry.status} disabled={busy || converted}
          onChange={(e) => update({ status: e.target.value }, `Marked ${e.target.value}`)} aria-label="Status">
          {(converted ? [...STATUSES, 'Converted'] : STATUSES).map((s) => <option key={s}>{s}</option>)}
        </select>
      }
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <Badge tone={tone[enquiry.status]}>{enquiry.status}</Badge>
        <span className="cell-sub">{formatDateTime(enquiry.created_at)}</span>
        {kind === 'general' && enquiry.service && <Badge tone="purple">{enquiry.service}</Badge>}
        <Badge tone="slate">{enquiry.language === 'HI' ? 'Hindi' : 'English'}</Badge>
      </div>
      {enquiry.message && <p style={{ whiteSpace: 'pre-wrap', color: 'var(--slate-700)', marginBottom: 12 }}>{enquiry.message}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <a className="btn btn-sm btn-outline" href={`mailto:${enquiry.email}`}><Mail size={13} />{enquiry.email}</a>
        {enquiry.phone && <a className="btn btn-sm btn-outline" href={`tel:${enquiry.phone}`}><Phone size={13} />{enquiry.phone}</a>}
        {digits && <a className="btn btn-sm btn-outline" href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} />WhatsApp</a>}
      </div>

      {kind === 'access_request' && (enquiry.gstin || enquiry.city || enquiry.state || enquiry.industry || enquiry.address) && (
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: '0 0 12px', fontSize: 13 }}>
          {enquiry.industry && (<><dt className="cell-sub">Industry</dt><dd style={{ margin: 0 }}>{enquiry.industry}</dd></>)}
          {(enquiry.city || enquiry.state) && (<><dt className="cell-sub">Location</dt><dd style={{ margin: 0 }}>{[enquiry.city, enquiry.state].filter(Boolean).join(', ')}</dd></>)}
          {enquiry.address && (<><dt className="cell-sub">Address</dt><dd style={{ margin: 0 }}>{enquiry.address}</dd></>)}
          {enquiry.gstin && (<><dt className="cell-sub">GSTIN</dt><dd style={{ margin: 0 }}>{enquiry.gstin}</dd></>)}
        </dl>
      )}

      {kind === 'access_request' && (
        <div className="note note-info" style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 }}>
          {converted ? (
            <>
              <span>Organization created {formatDateTime(enquiry.converted_at)}. An invitation went to {enquiry.email}.</span>
              {enquiry.organization_id && (
                <Link className="btn btn-sm btn-outline" to={`/app/admin/organizations/${enquiry.organization_id}`}>
                  <Building2 size={13} />{enquiry.organization_name ?? 'View organization'}
                </Link>
              )}
            </>
          ) : canConvert ? (
            <>
              <span>Ready to onboard? Approve this request, choose their role, and we email {enquiry.name} an invitation.</span>
              <Button size="sm" disabled={busy || enquiry.status === 'Closed'} onClick={() => onConvert(enquiry)}><UserPlus size={13} />Approve &amp; create account</Button>
            </>
          ) : (
            <span>An administrator creates the organization once this request is qualified.</span>
          )}
        </div>
      )}

      {enquiry.followups?.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '0 0 12px', padding: 0, display: 'grid', gap: 6 }} aria-label="Follow-up notes">
          {enquiry.followups.map((f, i) => (
            <li key={i} style={{ fontSize: 13, color: 'var(--slate-700)' }}>
              <span className="cell-sub">{formatDateTime(f.created_at)}{f.author ? ` · ${f.author}` : ''}</span><br />{f.notes}
            </li>
          ))}
        </ul>
      )}
      <p className="cell-sub" style={{ marginBottom: 10 }}>
        Consent recorded {formatDateTime(enquiry.consent_timestamp)} (privacy notice {enquiry.privacy_notice_version}).
      </p>
      <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (note.trim()) update({ note: note.trim() }, 'Note added'); }}>
        <input className="input" placeholder="Add a follow-up note..." value={note} onChange={(e) => setNote(e.target.value)} aria-label="Follow-up note" />
        <Button type="submit" size="sm" variant="outline" disabled={busy || !note.trim()}>Add note</Button>
      </form>
    </Card>
  );
}

/** One inbox for each kind of website submission: `general` enquiries, and `access_request`s for a portal account. */
export default function Enquiries({ kind = 'general' }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const copy = COPY[kind];
  const canConvert = kind === 'access_request' && can(user, 'orgs:manage');
  const [status, setStatus] = useState('');
  const [converting, setConverting] = useState(null);
  const enquiries = useAsync(async () => (await api.get('/admin/enquiries', { query: { status, kind } })).enquiries, [status, kind]);
  const plans = useAsync(async () => (canConvert ? (await api.get('/admin/plans')).plans : []), [canConvert]);
  const statuses = kind === 'access_request' ? [...STATUSES, 'Converted'] : STATUSES;

  return (
    <>
      <PageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        crumbs={[{ label: 'Administration' }, { label: copy.title }]}
        actions={
          <Field label="Show">
            {(p) => (
              <select {...p} className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>{statuses.map((s) => <option key={s}>{s}</option>)}
              </select>
            )}
          </Field>
        }
      />
      {enquiries.loading && !enquiries.data && <Loading />}
      <ErrorNote error={enquiries.error} onRetry={enquiries.reload} />
      {enquiries.data?.length === 0 && <Card><Empty title={status ? `No ${status.toLowerCase()} ${copy.title.toLowerCase()}` : `No ${copy.title.toLowerCase()}`}>{copy.empty}</Empty></Card>}
      {enquiries.data?.map((e) => (
        <EnquiryCard key={`${e.id}-${e.status}`} enquiry={e} kind={kind} canConvert={canConvert && Boolean(plans.data)} onConvert={setConverting} onChanged={enquiries.reload} />
      ))}
      {converting && plans.data && (
        <ApproveModal
          enquiry={converting}
          plans={plans.data}
          onClose={() => setConverting(null)}
          onApproved={({ organization }) => {
            setConverting(null);
            enquiries.reload();
            if (organization) { toast.success(`${organization.name}: invitation email queued.`); navigate(`/app/admin/organizations/${organization.id}`); }
            else toast.success('Account created. An invitation email has been queued.');
          }}
        />
      )}
    </>
  );
}
