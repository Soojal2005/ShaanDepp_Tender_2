import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, ErrorNote, Field, Modal } from '../ui.jsx';
import { useToast } from '../Toast.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { useAction } from '../../lib/hooks.js';

/** Raise a submission-desk request, for one tender (tenderId) or for a tender that is not in the feed. */
export default function RequestHelp({ tenderId = null, tenderTitle = '', onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const { pending, run } = useAction();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [existing, setExisting] = useState(null);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const body = tenderId ? { tenderId, note: note.trim() || undefined } : { title: title.trim(), note: note.trim() || undefined };
    const out = await run(() => api.post('/cases', body));
    if (out.ok) {
      toast.success(t('desk.sent'));
      onClose();
      navigate(`/app/desk/${out.value.id}`);
    } else if (out.error.status === 409 && out.error.details?.caseId) {
      setExisting(out.error.details.caseId);
    } else {
      setError(out.error);
    }
  };

  return (
    <Modal title={t('desk.raiseTitle')} onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
        {!existing && <Button type="submit" form="request-form" pending={pending} disabled={!tenderId && title.trim().length < 3}>{t('desk.send')}</Button>}
      </>}>
      <form id="request-form" onSubmit={submit}>
        <p className="cell-sub" style={{ marginBottom: 12 }}>{t('desk.requestIntro')}</p>
        {existing ? (
          <div className="note note-info">
            {t('desk.alreadyOpen')} <Link to={`/app/desk/${existing}`} onClick={onClose}>{t('desk.viewRequest')}</Link>
          </div>
        ) : (
          <>
            {tenderId
              ? <p><b>{tenderTitle}</b></p>
              : <Field label={t('desk.tenderTitle')}>{(p) => <input {...p} className="input" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>}
            <Field label={t('desk.noteLabel')} optional={t('common.optional')}>
              {(p) => <textarea {...p} className="input" rows={4} maxLength={2000} placeholder={t('desk.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
          </>
        )}
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
