import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { useAction, useAsync } from '../../lib/hooks.js';

export const statusTone = { Active: 'green', Suspended: 'red', Pending: 'amber' };

function NewOrganization({ plans, onClose, onCreated }) {
  const { pending, run } = useAction();
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    name: '', planCode: plans[0]?.code ?? '', gstin: '', contactName: '', contactPhone: '', language: 'EN',
    adminName: '', adminEmail: '',
  });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const result = await run(() =>
      api.post('/admin/organizations', {
        name: form.name.trim(),
        planCode: form.planCode,
        gstin: form.gstin.trim() || undefined,
        contactName: form.contactName.trim() || undefined,
        contactPhone: form.contactPhone.trim() || undefined,
        language: form.language,
        admin: { name: form.adminName.trim(), email: form.adminEmail.trim() },
      })
    );
    if (!result.ok) return setError(result.error);
    onCreated(result.value.organization);
  };

  return (
    <Modal
      wide
      title="New subscriber organization"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="new-org-form" pending={pending}
            disabled={!form.name.trim() || !form.adminName.trim() || !form.adminEmail.trim()}>Create and invite admin</Button>
        </>
      }
    >
      <ErrorNote error={error} />
      <form id="new-org-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Organization name">{(p) => <input {...p} className="input" value={form.name} onChange={set('name')} required />}</Field>
          <Field label="Plan">
            {(p) => (
              <select {...p} className="select" value={form.planCode} onChange={set('planCode')}>
                {plans.filter((pl) => pl.is_active).map((pl) => (
                  <option key={pl.code} value={pl.code}>{pl.name} ({pl.daily_alert_cap} alerts/day)</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="GSTIN" optional="optional" hint="15 characters, e.g. 23APSPT2592R1ZR">
            {(p) => <input {...p} className="input" value={form.gstin} onChange={set('gstin')} maxLength={15} />}
          </Field>
          <Field label="Default language">
            {(p) => (
              <select {...p} className="select" value={form.language} onChange={set('language')}>
                <option value="EN">English</option><option value="HI">Hindi</option>
              </select>
            )}
          </Field>
          <Field label="Contact person" optional="optional">{(p) => <input {...p} className="input" value={form.contactName} onChange={set('contactName')} />}</Field>
          <Field label="Contact phone" optional="optional">{(p) => <input {...p} className="input" value={form.contactPhone} onChange={set('contactPhone')} />}</Field>
        </div>
        <h4 style={{ margin: '6px 0 10px', fontSize: 13 }}>First account administrator</h4>
        <div className="form-grid">
          <Field label="Name">{(p) => <input {...p} className="input" value={form.adminName} onChange={set('adminName')} required />}</Field>
          <Field label="Email" hint="They receive a link to set their password.">
            {(p) => <input {...p} className="input" type="email" value={form.adminEmail} onChange={set('adminEmail')} required />}
          </Field>
        </div>
      </form>
    </Modal>
  );
}

export default function Organizations() {
  const navigate = useNavigate();
  const toast = useToast();
  const orgs = useAsync(async () => (await api.get('/admin/organizations')).organizations, []);
  const plans = useAsync(async () => (await api.get('/admin/plans')).plans, []);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Organizations"
        subtitle="Subscriber accounts, their plans and logins."
        crumbs={[{ label: 'Administration' }, { label: 'Organizations' }]}
        actions={<Button onClick={() => setCreating(true)} disabled={!plans.data}><Plus size={15} />New organization</Button>}
      />
      <Card flush>
        {orgs.loading && !orgs.data && <Loading />}
        <ErrorNote error={orgs.error} onRetry={orgs.reload} />
        {orgs.data?.length === 0 && <Empty title="No organizations yet" />}
        {orgs.data && orgs.data.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Organization</th><th>Plan</th><th>Logins</th><th>Alert ceiling</th><th>Status</th><th>Created</th></tr></thead>
              <tbody>
                {orgs.data.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => navigate(`/app/admin/organizations/${o.id}`)}>
                    <td>
                      <div className="cell-title">{o.name} {o.isStaffOrg && <Badge tone="purple">Shan-Deep staff</Badge>}</div>
                      <div className="cell-sub">{o.gstin || o.domain || '-'}</div>
                    </td>
                    <td>{o.plan?.name ?? '-'}</td>
                    <td className="tabular-nums">{o.isStaffOrg ? `${o.seatsUsed} staff` : `${o.seatsUsed} / ${o.seatLimit}`}</td>
                    <td className="tabular-nums">{o.isStaffOrg ? '-' : `${o.alertCap}/day`}</td>
                    <td><Badge tone={statusTone[o.status]}>{o.status}</Badge></td>
                    <td>{formatDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && plans.data && (
        <NewOrganization
          plans={plans.data}
          onClose={() => setCreating(false)}
          onCreated={(org) => { setCreating(false); toast.success(`${org.name} created. An invitation email has been queued.`); navigate(`/app/admin/organizations/${org.id}`); }}
        />
      )}
    </>
  );
}
