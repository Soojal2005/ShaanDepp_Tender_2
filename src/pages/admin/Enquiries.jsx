import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Mail, MessageCircle, Phone, UserPlus } from 'lucide-react';
import { can, useAuth } from '../../auth/AuthContext.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, PageHeader } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useAsync } from '../../lib/hooks.js';
import { NewOrganization } from './Organizations.jsx';

const STATUSES = ['New', 'Contacted', 'Qualified', 'Closed'];
const tone = { New: 'blue', Contacted: 'amber', Qualified: 'green', Converted: 'green', Closed: 'slate' };

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
              <span>Ready to onboard? Create the organization and we email {enquiry.name} an invitation.</span>
              <Button size="sm" disabled={busy || enquiry.status === 'Closed'} onClick={() => onConvert(enquiry)}><UserPlus size={13} />Create organization</Button>
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
        <NewOrganization
          plans={plans.data}
          fromEnquiryId={converting.id}
          prefill={{
            name: converting.company, contactName: converting.name, contactPhone: converting.phone ?? '',
            language: converting.language, adminName: converting.name, adminEmail: converting.email,
          }}
          onClose={() => setConverting(null)}
          onCreated={(org) => { setConverting(null); toast.success(`${org.name} created. An invitation email has been queued.`); navigate(`/app/admin/organizations/${org.id}`); }}
        />
      )}
    </>
  );
}
