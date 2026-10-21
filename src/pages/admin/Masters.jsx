import { useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { api } from '../../lib/api.js';
import { useAction, useAsync } from '../../lib/hooks.js';

const TIERS = ['Central', 'State', 'PSU', 'Municipal'];

// One definition per master list drives the table, the form and the API calls.
const KINDS = {
  departments: {
    label: 'Departments', singular: 'department', path: '/masters/departments', listKey: 'departments',
    columns: [['name', 'Name'], ['nameHi', 'Hindi'], ['tier', 'Tier'], ['aliases', 'Also matched as']],
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'nameHi', label: 'Hindi name' },
      { key: 'tier', label: 'Tier', type: 'select', options: TIERS, default: 'Central' },
      { key: 'aliases', label: 'Aliases', type: 'tags', hint: 'Comma-separated spellings and abbreviations used by data sources (e.g. NHAI, N.H.A.I).' },
      { key: 'isActive', label: 'Offered in filters', type: 'bool', default: true },
    ],
  },
  categories: {
    label: 'Categories', singular: 'category', path: '/masters/categories', listKey: 'categories',
    columns: [['name', 'Name'], ['nameHi', 'Hindi'], ['aliases', 'Also matched as']],
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'nameHi', label: 'Hindi name' },
      { key: 'aliases', label: 'Aliases', type: 'tags', hint: 'Comma-separated names data sources use for this category.' },
      { key: 'isActive', label: 'Offered in filters', type: 'bool', default: true },
    ],
  },
  states: {
    label: 'States & UTs', singular: 'state', path: '/masters/states', listKey: 'states',
    columns: [['name', 'Name'], ['nameHi', 'Hindi'], ['code', 'Code'], ['aliases', 'Also matched as']],
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'nameHi', label: 'Hindi name' },
      { key: 'code', label: 'Code' },
      { key: 'aliases', label: 'Aliases', type: 'tags' },
    ],
  },
};

const toForm = (kind, item) =>
  Object.fromEntries(
    KINDS[kind].fields.map((f) => {
      const value = item ? item[f.key] : f.default;
      if (f.type === 'tags') return [f.key, (value ?? []).join(', ')];
      if (f.type === 'bool') return [f.key, value ?? true];
      return [f.key, value ?? ''];
    })
  );

const toPayload = (kind, form) =>
  Object.fromEntries(
    KINDS[kind].fields.map((f) => {
      const v = form[f.key];
      if (f.type === 'tags') return [f.key, v.split(',').map((s) => s.trim()).filter(Boolean)];
      if (f.type === 'bool') return [f.key, Boolean(v)];
      const trimmed = typeof v === 'string' ? v.trim() : v;
      return [f.key, trimmed === '' && f.key !== 'name' ? null : trimmed];
    })
  );

function EditModal({ kind, item, onClose, onSaved }) {
  const def = KINDS[kind];
  const { pending, run } = useAction();
  const [form, setForm] = useState(() => toForm(kind, item));
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const body = toPayload(kind, form);
    const result = await run(() => (item ? api.patch(`${def.path}/${item.id}`, body) : api.post(def.path, body)));
    if (!result.ok) return setError(result.error);
    onSaved();
  };

  return (
    <Modal
      title={`${item ? 'Edit' : 'Add'} ${def.singular}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="master-form" pending={pending} disabled={!String(form.name).trim()}>Save</Button>
        </>
      }
    >
      <ErrorNote error={error} />
      <form id="master-form" onSubmit={submit}>
        {def.fields.map((f) =>
          f.type === 'bool' ? (
            <label key={f.key} className="check-row">
              <input type="checkbox" checked={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} />
              {f.label}
            </label>
          ) : (
            <Field key={f.key} label={f.label} hint={f.hint}>
              {(p) =>
                f.type === 'select' ? (
                  <select {...p} className="select" value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>
                    {f.options.map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input {...p} className="input" value={form[f.key]} required={f.required} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                )
              }
            </Field>
          )
        )}
      </form>
    </Modal>
  );
}

function ListTab({ kind, items, onChanged }) {
  const def = KINDS[kind];
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new, object = existing
  const toast = useToast();
  return (
    <Card
      title={`${def.label} (${items.length})`}
      flush
      actions={<Button size="sm" onClick={() => setEditing(null)}><Plus size={14} />Add</Button>}
    >
      {items.length === 0 ? <Empty title={`No ${def.label.toLowerCase()} yet`} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>{def.columns.map(([, label]) => <th key={label}>{label}</th>)}{kind !== 'states' && <th>Status</th>}<th /></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  {def.columns.map(([key]) => (
                    <td key={key} className={key === 'name' ? 'cell-title' : ''}>
                      {key === 'aliases' ? (item.aliases.length ? item.aliases.join(', ') : '-') : (item[key] ?? '-')}
                    </td>
                  ))}
                  {kind !== 'states' && <td><Badge tone={item.isActive ? 'green' : 'slate'}>{item.isActive ? 'Offered' : 'Hidden'}</Badge></td>}
                  <td><div className="row-actions"><Button size="sm" variant="outline" onClick={() => setEditing(item)}><Pencil size={13} />Edit</Button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing !== undefined && (
        <EditModal
          kind={kind}
          item={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); toast.success('Saved'); onChanged(); }}
        />
      )}
    </Card>
  );
}

function CitiesTab({ states }) {
  const toast = useToast();
  const [stateId, setStateId] = useState(states.find((s) => s.name === 'Madhya Pradesh')?.id ?? states[0]?.id);
  const cities = useAsync(async () => (await api.get('/masters/cities', { query: { stateId } })).cities, [stateId]);
  const [name, setName] = useState('');
  const { pending, run } = useAction();

  const add = async (e) => {
    e.preventDefault();
    const result = await run(() => api.post('/masters/cities', { stateId, name: name.trim() }));
    if (!result.ok) return toast.error(result.error.message);
    setName('');
    toast.success('City added');
    cities.reload();
  };

  return (
    <Card title="Cities" flush>
      <div style={{ padding: '14px 20px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid #F1F5F9' }}>
        <select className="select" style={{ width: 240 }} value={stateId} onChange={(e) => setStateId(Number(e.target.value))} aria-label="State">
          {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <form onSubmit={add} style={{ display: 'flex', gap: 8 }}>
          <input className="input" style={{ width: 200 }} placeholder="New city" value={name} onChange={(e) => setName(e.target.value)} aria-label="New city" />
          <Button type="submit" size="sm" pending={pending} disabled={name.trim().length < 2}><Plus size={14} />Add city</Button>
        </form>
      </div>
      {cities.loading && !cities.data && <Loading />}
      <ErrorNote error={cities.error} onRetry={cities.reload} />
      {cities.data && (
        <div style={{ padding: '14px 20px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {cities.data.length === 0 ? <span style={{ color: 'var(--slate-500)' }}>No cities listed for this state yet. New cities are also suggested automatically when tender data arrives.</span>
            : cities.data.map((c) => <Badge key={c.id} tone="blue">{c.name}</Badge>)}
        </div>
      )}
    </Card>
  );
}

export default function Masters() {
  const [tab, setTab] = useState('departments');
  const masters = useAsync(() => api.get('/masters', { query: { all: 1 } }), []);
  const tabs = useMemo(() => [...Object.entries(KINDS).map(([key, d]) => [key, d.label]), ['cities', 'Cities']], []);

  return (
    <>
      <PageHeader
        title="Master lists"
        subtitle="These lists drive every filter and are used to tidy incoming tender data. Aliases teach the importer which spellings mean the same thing."
        crumbs={[{ label: 'Administration' }, { label: 'Master lists' }]}
      />
      <div className="tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {masters.loading && !masters.data && <Loading />}
      <ErrorNote error={masters.error} onRetry={masters.reload} />
      {masters.data && tab !== 'cities' && (
        <ListTab key={tab} kind={tab} items={masters.data[KINDS[tab].listKey]} onChanged={masters.reload} />
      )}
      {masters.data && tab === 'cities' && <CitiesTab states={masters.data.states} />}
    </>
  );
}
