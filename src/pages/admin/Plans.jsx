import { useState } from 'react';
import { Button, Card, ErrorNote, Loading, PageHeader } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';

function PlanRow({ plan, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: plan.name, dailyAlertCap: plan.daily_alert_cap, maxSeats: plan.max_seats,
    maxAlertProfiles: plan.max_alert_profiles, isActive: plan.is_active,
  });
  const [pending, setPending] = useState(false);
  const dirty =
    form.name !== plan.name || Number(form.dailyAlertCap) !== plan.daily_alert_cap ||
    Number(form.maxSeats) !== plan.max_seats || Number(form.maxAlertProfiles) !== plan.max_alert_profiles ||
    form.isActive !== plan.is_active;

  const save = async () => {
    setPending(true);
    try {
      await api.put(`/admin/plans/${plan.id}`, {
        name: form.name.trim(), dailyAlertCap: Number(form.dailyAlertCap), maxSeats: Number(form.maxSeats),
        maxAlertProfiles: Number(form.maxAlertProfiles), isActive: form.isActive,
      });
      toast.success(`${form.name} saved`);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPending(false);
    }
  };

  const num = (key, min, max) => (
    <input className="input" type="number" min={min} max={max} style={{ width: 90 }} value={form[key]}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })} aria-label={key} />
  );

  return (
    <tr>
      <td><input className="input" style={{ width: 150 }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Plan name" /></td>
      <td className="cell-sub">{plan.code}</td>
      <td>{num('dailyAlertCap', 1, 500)}</td>
      <td>{num('maxSeats', 1, 50)}</td>
      <td>{num('maxAlertProfiles', 1, 100)}</td>
      <td>
        <label className="check-row" style={{ margin: 0 }}>
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Offered
        </label>
      </td>
      <td><Button size="sm" pending={pending} disabled={!dirty || !form.name.trim()} onClick={save}>Save</Button></td>
    </tr>
  );
}

export default function Plans() {
  const plans = useAsync(async () => (await api.get('/admin/plans')).plans, []);
  return (
    <>
      <PageHeader
        title="Plans"
        subtitle="The alert ceiling is what makes one package different from another. Changes apply to every organization on the plan."
        crumbs={[{ label: 'Administration' }, { label: 'Plans' }]}
      />
      <Card flush>
        {plans.loading && !plans.data && <Loading />}
        <ErrorNote error={plans.error} onRetry={plans.reload} />
        {plans.data && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Code</th><th>Alerts / day</th><th>Logins</th><th>Alert profiles</th><th>Availability</th><th /></tr></thead>
              <tbody>{plans.data.map((p) => <PlanRow key={`${p.id}-${p.name}-${p.daily_alert_cap}-${p.max_seats}-${p.max_alert_profiles}-${p.is_active}`} plan={p} onSaved={plans.reload} />)}</tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
