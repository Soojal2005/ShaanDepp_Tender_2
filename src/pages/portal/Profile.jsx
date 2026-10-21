import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { can, useAuth } from '../../auth/AuthContext.jsx';
import { isStrongPassword } from '../auth/ResetPassword.jsx';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime, formatNumber } from '../../lib/format.js';
import { useAction, useAsync } from '../../lib/hooks.js';

function ProfileForm() {
  const { user, refresh } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const { pending, run } = useAction();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');

  // Language is chosen with the EN / HI switch in the header, which also saves it to the profile.
  const save = async (e) => {
    e.preventDefault();
    const result = await run(() => api.patch('/auth/me', { name: name.trim(), phone: phone.trim() || null }));
    if (!result.ok) return toast.error(result.error.message);
    await refresh();
    toast.success(t('profile.saved'));
  };

  return (
    <Card title={t('profile.myProfile')}>
      <form onSubmit={save}>
        <Field label={t('common.name')}>
          {(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} required />}
        </Field>
        <Field label={t('common.email')}>
          {(p) => <input {...p} className="input" value={user.email} disabled />}
        </Field>
        <Field label={t('common.phone')} optional={t('common.optional')}>
          {(p) => <input {...p} className="input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />}
        </Field>
        <Button type="submit" pending={pending} disabled={!name.trim()}>{pending ? t('common.saving') : t('common.save')}</Button>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const { t } = useI18n();
  const toast = useToast();
  const { pending, run } = useAction();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const weak = next.length > 0 && !isStrongPassword(next);
  const mismatch = confirm.length > 0 && confirm !== next;

  const save = async (e) => {
    e.preventDefault();
    const result = await run(() => api.post('/auth/change-password', { currentPassword: current, newPassword: next }));
    if (!result.ok) return toast.error(result.error.message);
    setCurrent(''); setNext(''); setConfirm('');
    toast.success(t('profile.passwordChanged'));
  };

  return (
    <Card title={t('profile.changePassword')}>
      <form onSubmit={save}>
        <Field label={t('profile.currentPassword')}>
          {(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}
        </Field>
        <Field label={t('auth.newPassword')} error={weak ? t('auth.weak') : null}>
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />}
        </Field>
        <Field label={t('auth.confirmPassword')} error={mismatch ? t('auth.mismatch') : null}>
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
        </Field>
        <Button type="submit" pending={pending} disabled={!current || !isStrongPassword(next) || next !== confirm}>
          {t('profile.changePassword')}
        </Button>
      </form>
    </Card>
  );
}

function PlanSummary() {
  const { organization } = useAuth();
  const { t, lang } = useI18n();
  if (!organization) return null;
  const { plan, alertCap, seatsUsed, seatLimit, maxAlertProfiles } = organization;
  return (
    <Card title={t('profile.plan')}>
      {!plan ? (
        <p style={{ color: 'var(--slate-500)' }}>{t('profile.noPlan')}</p>
      ) : (
        <dl className="kv">
          <dt>{t('profile.planName')}</dt><dd>{plan.name}</dd>
          <dt>{t('profile.dailyCap')}</dt><dd>{t('profile.perDay', { n: formatNumber(alertCap, lang) })}</dd>
          <dt>{t('profile.profiles')}</dt><dd>{t('profile.upTo', { n: maxAlertProfiles })}</dd>
          <dt>{t('profile.logins')}</dt>
          <dd>
            {t('profile.loginsUsed', { used: seatsUsed, limit: seatLimit })}
            <div className="meter"><span style={{ width: `${Math.min(100, (seatsUsed / Math.max(1, seatLimit)) * 100)}%` }} /></div>
          </dd>
        </dl>
      )}
    </Card>
  );
}

function InviteModal({ onClose, onDone }) {
  const { t } = useI18n();
  const { pending, run } = useAction();
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'subscriber' });
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const result = await run(() =>
      api.post('/org/members', { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined, role: form.role })
    );
    if (!result.ok) return setError(result.error);
    onDone();
  };

  return (
    <Modal
      title={t('profile.inviteTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="invite-form" pending={pending} disabled={!form.name.trim() || !form.email.trim()}>{t('profile.invite')}</Button>
        </>
      }
    >
      <ErrorNote error={error} />
      <form id="invite-form" onSubmit={submit}>
        <Field label={t('common.name')}>{(p) => <input {...p} className="input" value={form.name} onChange={set('name')} required />}</Field>
        <Field label={t('common.email')}>{(p) => <input {...p} className="input" type="email" value={form.email} onChange={set('email')} required />}</Field>
        <div className="form-grid">
          <Field label={t('common.phone')} optional={t('common.optional')}>{(p) => <input {...p} className="input" value={form.phone} onChange={set('phone')} inputMode="tel" />}</Field>
          <Field label={t('common.role')}>
            {(p) => (
              <select {...p} className="select" value={form.role} onChange={set('role')}>
                <option value="subscriber">{t('roles.subscriber')}</option>
                <option value="tenant_admin">{t('roles.tenant_admin')}</option>
              </select>
            )}
          </Field>
        </div>
      </form>
    </Modal>
  );
}

function Team() {
  const { user, organization, refresh } = useAuth();
  const { t, lang } = useI18n();
  const toast = useToast();
  const manage = can(user, 'members:manage');
  const members = useAsync(async () => (await api.get('/org/members')).members, []);
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const update = async (member, patch) => {
    setBusyId(member.id);
    try {
      await api.patch(`/org/members/${member.id}`, patch);
      await Promise.all([members.reload(), refresh()]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card
      title={t('profile.team')}
      actions={manage && <Button size="sm" onClick={() => setInviting(true)}><UserPlus size={14} />{t('profile.invite')}</Button>}
      flush
    >
      <p style={{ padding: '12px 20px 0', fontSize: 12, color: 'var(--slate-500)' }}>
        {t('profile.teamHint', { n: organization?.seatLimit ?? 3 })}
      </p>
      {members.loading && !members.data ? <Loading label={t('common.loading')} /> : null}
      <ErrorNote error={members.error} onRetry={members.reload} retryLabel={t('common.retry')} />
      {members.data && members.data.length === 0 && <Empty title="-" />}
      {members.data && members.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.name')}</th><th>{t('common.role')}</th><th>{t('common.status')}</th>
                <th>{t('profile.lastLogin')}</th>{manage && <th />}
              </tr>
            </thead>
            <tbody>
              {members.data.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="cell-title">{m.name} {m.id === user.id && <Badge tone="blue">{t('profile.you')}</Badge>}</div>
                    <div className="cell-sub">{m.email}</div>
                  </td>
                  <td>{t(`roles.${m.role}`)}</td>
                  <td><Badge tone={m.isActive ? 'green' : 'slate'}>{m.isActive ? t('common.active') : t('common.inactive')}</Badge></td>
                  <td>{m.lastLoginAt ? formatDateTime(m.lastLoginAt, lang) : t('profile.never')}</td>
                  {manage && (
                    <td>
                      {m.id !== user.id && (
                        <div className="row-actions">
                          <Button size="sm" variant="outline" disabled={busyId === m.id}
                            onClick={() => update(m, { role: m.role === 'tenant_admin' ? 'subscriber' : 'tenant_admin' })}>
                            {m.role === 'tenant_admin' ? t('profile.makeMember') : t('profile.makeAdmin')}
                          </Button>
                          <Button size="sm" variant={m.isActive ? 'danger' : 'outline'} disabled={busyId === m.id}
                            onClick={() => update(m, { isActive: !m.isActive })}>
                            {m.isActive ? t('profile.deactivate') : t('profile.reactivate')}
                          </Button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {inviting && (
        <InviteModal
          onClose={() => setInviting(false)}
          onDone={async () => { setInviting(false); toast.success(t('profile.inviteSent')); await Promise.all([members.reload(), refresh()]); }}
        />
      )}
    </Card>
  );
}

export default function Profile() {
  const { user } = useAuth();
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('profile.title')} subtitle={t('profile.subtitle')} crumbs={[{ label: t('nav.home'), to: '/app' }, { label: t('nav.profile') }]} />
      <div className="grid-2">
        <ProfileForm />
        <PasswordForm />
      </div>
      {!user.isStaff && <PlanSummary />}
      {!user.isStaff && <Team />}
    </>
  );
}
