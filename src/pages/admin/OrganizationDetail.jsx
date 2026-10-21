import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Mail, UserPlus } from 'lucide-react';
import { Badge, Button, Card, ErrorNote, Field, Loading, Modal, PageHeader } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useAction, useAsync } from '../../lib/hooks.js';
import { statusTone } from './Organizations.jsx';

const CLIENT_ROLES = [['subscriber', 'Subscriber'], ['tenant_admin', 'Account admin']];
const STAFF_ROLES = [['analyst', 'Analyst'], ['case_manager', 'Case manager'], ['platform_admin', 'Platform admin']];
const roleLabel = Object.fromEntries([...CLIENT_ROLES, ...STAFF_ROLES]);

function OrgForm({ org, plans, onSaved }) {
  const toast = useToast();
  const { pending, run } = useAction();
  const [form, setForm] = useState(null);

  useEffect(() => {
    setForm({
      name: org.name, domain: org.domain ?? '', gstin: org.gstin ?? '', contactName: org.contactName ?? '',
      contactPhone: org.contactPhone ?? '', planCode: org.plan?.code ?? '', status: org.status, language: org.language,
      alertCapOverride: org.alertCapOverride ?? '', seatLimitOverride: org.seatLimitOverride ?? '',
    });
  }, [org]);
  if (!form) return null;
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const orNull = (v) => (v === '' ? null : v);
  const num = (v) => (v === '' ? null : Number(v));

  const save = async (e) => {
    e.preventDefault();
    const result = await run(() =>
      api.patch(`/admin/organizations/${org.id}`, {
        name: form.name.trim(), domain: orNull(form.domain.trim()), gstin: orNull(form.gstin.trim()),
        contactName: orNull(form.contactName.trim()), contactPhone: orNull(form.contactPhone.trim()),
        planCode: orNull(form.planCode), status: form.status, language: form.language,
        alertCapOverride: num(form.alertCapOverride), seatLimitOverride: num(form.seatLimitOverride),
      })
    );
    if (!result.ok) return toast.error(result.error.message);
    toast.success('Organization saved');
    onSaved();
  };

  return (
    <Card title="Details">
      <form onSubmit={save}>
        <div className="form-grid">
          <Field label="Name">{(p) => <input {...p} className="input" value={form.name} onChange={set('name')} required />}</Field>
          <Field label="Status">
            {(p) => (
              <select {...p} className="select" value={form.status} onChange={set('status')} disabled={org.isStaffOrg}>
                <option>Active</option><option>Pending</option><option>Suspended</option>
              </select>
            )}
          </Field>
          {!org.isStaffOrg && (
            <>
              <Field label="Plan">
                {(p) => (
                  <select {...p} className="select" value={form.planCode} onChange={set('planCode')}>
                    <option value="">No plan</option>
                    {plans.map((pl) => <option key={pl.code} value={pl.code}>{pl.name} ({pl.daily_alert_cap}/day, {pl.max_seats} logins)</option>)}
                  </select>
                )}
              </Field>
              <Field label="GSTIN" optional="optional">{(p) => <input {...p} className="input" value={form.gstin} onChange={set('gstin')} maxLength={15} />}</Field>
              <Field label="Alert ceiling override" optional="optional" hint="Leave empty to use the plan's ceiling.">
                {(p) => <input {...p} className="input" type="number" min="1" max="500" value={form.alertCapOverride} onChange={set('alertCapOverride')} />}
              </Field>
              <Field label="Login limit override" optional="optional" hint="Leave empty to use the plan's limit.">
                {(p) => <input {...p} className="input" type="number" min="1" max="50" value={form.seatLimitOverride} onChange={set('seatLimitOverride')} />}
              </Field>
              <Field label="Contact person" optional="optional">{(p) => <input {...p} className="input" value={form.contactName} onChange={set('contactName')} />}</Field>
              <Field label="Contact phone" optional="optional">{(p) => <input {...p} className="input" value={form.contactPhone} onChange={set('contactPhone')} />}</Field>
            </>
          )}
          <Field label="Domain" optional="optional">{(p) => <input {...p} className="input" value={form.domain} onChange={set('domain')} />}</Field>
          <Field label="Language">
            {(p) => (
              <select {...p} className="select" value={form.language} onChange={set('language')}>
                <option value="EN">English</option><option value="HI">Hindi</option>
              </select>
            )}
          </Field>
        </div>
        <Button type="submit" pending={pending}>Save changes</Button>
      </form>
    </Card>
  );
}

function InviteMember({ org, onClose, onDone }) {
  const { pending, run } = useAction();
  const roles = org.isStaffOrg ? STAFF_ROLES : CLIENT_ROLES;
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: roles[0][0] });
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const result = await run(() =>
      api.post(`/admin/organizations/${org.id}/members`, {
        name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined, role: form.role,
      })
    );
    if (!result.ok) return setError(result.error);
    onDone();
  };

  return (
    <Modal
      title={`Invite to ${org.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="invite-member-form" pending={pending} disabled={!form.name.trim() || !form.email.trim()}>Send invitation</Button>
        </>
      }
    >
      <ErrorNote error={error} />
      <form id="invite-member-form" onSubmit={submit}>
        <Field label="Name">{(p) => <input {...p} className="input" value={form.name} onChange={set('name')} required />}</Field>
        <Field label="Email">{(p) => <input {...p} className="input" type="email" value={form.email} onChange={set('email')} required />}</Field>
        <div className="form-grid">
          <Field label="Phone" optional="optional">{(p) => <input {...p} className="input" value={form.phone} onChange={set('phone')} />}</Field>
          <Field label="Role">
            {(p) => (
              <select {...p} className="select" value={form.role} onChange={set('role')}>
                {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            )}
          </Field>
        </div>
      </form>
    </Modal>
  );
}

export default function OrganizationDetail() {
  const { orgId } = useParams();
  const toast = useToast();
  const detail = useAsync(() => api.get(`/admin/organizations/${orgId}`), [orgId]);
  const plans = useAsync(async () => (await api.get('/admin/plans')).plans, []);
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const act = async (member, fn, doneMessage) => {
    setBusyId(member.id);
    try {
      await fn();
      if (doneMessage) toast.success(doneMessage);
      await detail.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error && !detail.data) return <ErrorNote error={detail.error} onRetry={detail.reload} />;
  const { organization: org, members } = detail.data;
  const roles = org.isStaffOrg ? STAFF_ROLES : CLIENT_ROLES;

  return (
    <>
      <PageHeader
        title={org.name}
        subtitle={org.isStaffOrg ? 'Shan-Deep staff accounts' : `${org.plan?.name ?? 'No plan'} · ${org.seatsUsed} of ${org.seatLimit} logins in use`}
        crumbs={[{ label: 'Administration' }, { label: 'Organizations', to: '/app/admin/organizations' }, { label: org.name }]}
        actions={<Badge tone={statusTone[org.status]}>{org.status}</Badge>}
      />
      {plans.data && <OrgForm org={org} plans={plans.data} onSaved={detail.reload} />}

      <Card title="People" flush actions={<Button size="sm" onClick={() => setInviting(true)}><UserPlus size={14} />Invite</Button>}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td><div className="cell-title">{m.name}</div><div className="cell-sub">{m.email}</div></td>
                  <td>
                    <select className="select" style={{ height: 30, fontSize: 12, width: 150 }} value={m.role} disabled={busyId === m.id}
                      onChange={(e) => act(m, () => api.patch(`/admin/organizations/${org.id}/members/${m.id}`, { role: e.target.value }), `${m.name} is now ${roleLabel[e.target.value]}`)}>
                      {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </td>
                  <td><Badge tone={m.isActive ? 'green' : 'slate'}>{m.isActive ? 'Active' : 'Inactive'}</Badge></td>
                  <td>{m.lastLoginAt ? formatDateTime(m.lastLoginAt) : 'Never'}</td>
                  <td>
                    <div className="row-actions">
                      <Button size="sm" variant="outline" disabled={busyId === m.id || !m.isActive}
                        onClick={() => act(m, () => api.post(`/admin/users/${m.id}/reset-password`), 'Password reset email queued')}>
                        <Mail size={13} />Reset password
                      </Button>
                      <Button size="sm" variant={m.isActive ? 'danger' : 'outline'} disabled={busyId === m.id}
                        onClick={() => act(m, () => api.patch(`/admin/organizations/${org.id}/members/${m.id}`, { isActive: !m.isActive }), m.isActive ? `${m.name} deactivated` : `${m.name} reactivated`)}>
                        {m.isActive ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {inviting && (
        <InviteMember
          org={org}
          onClose={() => setInviting(false)}
          onDone={() => { setInviting(false); toast.success('Invitation sent'); detail.reload(); }}
        />
      )}
    </>
  );
}
