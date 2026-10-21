import { useState } from 'react';
import { Mail, MessageCircle, Phone } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, PageHeader } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useAsync } from '../../lib/hooks.js';

const STATUSES = ['New', 'Contacted', 'Qualified', 'Closed'];
const tone = { New: 'blue', Contacted: 'amber', Qualified: 'green', Closed: 'slate' };

function EnquiryCard({ enquiry, onChanged }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

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
        <select className="select" style={{ height: 30, fontSize: 12, width: 130 }} value={enquiry.status} disabled={busy}
          onChange={(e) => update({ status: e.target.value }, `Marked ${e.target.value}`)} aria-label="Status">
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      }
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <Badge tone={tone[enquiry.status]}>{enquiry.status}</Badge>
        <span className="cell-sub">{formatDateTime(enquiry.created_at)}</span>
        {enquiry.service && <Badge tone="purple">{enquiry.service}</Badge>}
        <Badge tone="slate">{enquiry.language === 'HI' ? 'Hindi' : 'English'}</Badge>
      </div>
      {enquiry.message && <p style={{ whiteSpace: 'pre-wrap', color: 'var(--slate-700)', marginBottom: 12 }}>{enquiry.message}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <a className="btn btn-sm btn-outline" href={`mailto:${enquiry.email}`}><Mail size={13} />{enquiry.email}</a>
        {enquiry.phone && <a className="btn btn-sm btn-outline" href={`tel:${enquiry.phone}`}><Phone size={13} />{enquiry.phone}</a>}
        {digits && <a className="btn btn-sm btn-outline" href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} />WhatsApp</a>}
      </div>
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

export default function Enquiries() {
  const [status, setStatus] = useState('');
  const enquiries = useAsync(async () => (await api.get('/admin/enquiries', { query: { status } })).enquiries, [status]);

  return (
    <>
      <PageHeader
        title="Website enquiries"
        subtitle="Leads from the company website. Each one carries the visitor's recorded DPDP consent."
        crumbs={[{ label: 'Administration' }, { label: 'Website enquiries' }]}
        actions={
          <Field label="Show">
            {(p) => (
              <select {...p} className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            )}
          </Field>
        }
      />
      {enquiries.loading && !enquiries.data && <Loading />}
      <ErrorNote error={enquiries.error} onRetry={enquiries.reload} />
      {enquiries.data?.length === 0 && <Card><Empty title="No enquiries">New website enquiries will appear here.</Empty></Card>}
      {enquiries.data?.map((e) => <EnquiryCard key={`${e.id}-${e.status}`} enquiry={e} onChanged={enquiries.reload} />)}
    </>
  );
}
