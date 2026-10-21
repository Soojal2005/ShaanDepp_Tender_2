import { useRef, useState } from 'react';
import { Check, Download, Trash2, Upload } from 'lucide-react';
import { Badge, Button, ErrorNote } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useAction } from '../../lib/hooks.js';

export const STAGE_KEYS = ['intake', 'detail_study', 'eligibility', 'technical_prep', 'financial_strategy', 'prebid', 'submission', 'evaluation', 'follow_up'];

/** Where the case is on the nine-step path. `label(key)` gives the display name. */
export function Stepper({ stage, label }) {
  const at = stage === 'closed' ? STAGE_KEYS.length : STAGE_KEYS.indexOf(stage);
  return (
    <ol className="stepper" aria-label="Progress">
      {STAGE_KEYS.map((key, i) => (
        <li key={key} className={i < at ? 'done' : i === at ? 'current' : ''} aria-current={i === at ? 'step' : undefined}>
          <span className="dot">{i < at ? <Check size={12} /> : i + 1}</span>
          <span className="name">{label(key)}</span>
        </li>
      ))}
    </ol>
  );
}

const ALL_SLOTS = ['tender_document', 'compliance_checklist', 'technical_bid', 'boq', 'proof_of_submission', 'emd_receipt', 'work_order', 'other'];
export const STATUS_TONE = { pending: 'slate', pass: 'green', fail: 'red', na: 'slate' };

export function Fact({ label, children }) {
  return <div className="fact"><div className="fact-label">{label}</div><div className="fact-value">{children}</div></div>;
}

/**
 * Documents of a case. A client sees only shared documents and may add some;
 * staff see everything and choose per document whether the client can see it.
 */
export function DocumentsPanel({ caseData, staff, onChange }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { pending, run } = useAction();
  const file = useRef(null);
  const [slot, setSlot] = useState(staff ? 'technical_bid' : 'tender_document');
  const [share, setShare] = useState(false);
  const [error, setError] = useState(null);
  const slots = staff ? ALL_SLOTS : ['tender_document', 'boq', 'emd_receipt', 'other'];
  const closed = caseData.stage === 'closed';
  const slotName = (k) => t(`desk.slots.${k}`);

  const send = async () => {
    const f = file.current?.files?.[0];
    if (!f) return;
    setError(null);
    const form = new FormData();
    form.append('slot', slot);
    if (staff) form.append('visibility', share ? 'shared' : 'internal_only');
    form.append('file', f);
    const out = await run(() => api.post(`/cases/${caseData.id}/documents`, form));
    if (!out.ok) return setError(out.error);
    toast.success(t('desk.uploaded'));
    file.current.value = '';
    onChange();
  };
  const act = async (fn) => { const out = await run(fn); if (!out.ok) toast.error(out.error.message); else onChange(); };
  const size = (b) => (b === null ? '' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  return (
    <>
      {caseData.documents.length === 0 ? <p className="cell-sub">{t('desk.noDocs')}</p> : (
        <ul className="doc-list">
          {caseData.documents.map((d) => (
            <li key={d.id}>
              <div style={{ minWidth: 0 }}>
                <a href={api.url(`/cases/${caseData.id}/documents/${d.id}/file`)} download className="cell-title">{d.name}</a>
                <div className="cell-sub">{slotName(d.slot)} · {size(d.sizeBytes)} · {formatDateTime(d.createdAt, lang)}{d.uploadedBy ? ` · ${d.uploadedBy}` : ''}</div>
              </div>
              <div className="doc-actions">
                {staff && <Badge tone={d.visibility === 'shared' ? 'green' : 'slate'}>{d.visibility === 'shared' ? 'Shared with client' : 'Internal'}</Badge>}
                <a className="btn btn-outline btn-sm" href={api.url(`/cases/${caseData.id}/documents/${d.id}/file`)} download><Download size={13} />{t('desk.download')}</a>
                {staff && <Button size="sm" variant="outline" onClick={() => act(() => api.patch(`/cases/${caseData.id}/documents/${d.id}`, { visibility: d.visibility === 'shared' ? 'internal_only' : 'shared' }))}>{d.visibility === 'shared' ? 'Make internal' : 'Share'}</Button>}
                {staff && <Button size="sm" variant="ghost" aria-label="Delete document" onClick={() => { if (window.confirm(`Delete ${d.name}?`)) act(() => api.delete(`/cases/${caseData.id}/documents/${d.id}`)); }}><Trash2 size={13} /></Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!closed && (
        <div className="upload-row">
          <select className="select" aria-label={t('desk.chooseSlot')} value={slot} onChange={(e) => setSlot(e.target.value)}>
            {slots.map((k) => <option key={k} value={k}>{slotName(k)}</option>)}
          </select>
          <input ref={file} type="file" aria-label={t('desk.chooseFile')} />
          {staff && <label className="check-row" style={{ margin: 0 }}><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />Share with client</label>}
          <Button pending={pending} onClick={send}><Upload size={14} />{pending ? t('desk.uploading') : t('desk.upload')}</Button>
        </div>
      )}
      <p className="cell-sub" style={{ marginTop: 6 }}>{t('desk.uploadHint')}</p>
      <ErrorNote error={error} />
    </>
  );
}
