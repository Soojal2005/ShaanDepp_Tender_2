import { Badge, Card } from '../../components/ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { formatDate, formatDateTime, formatInr } from '../../lib/format.js';
import { DocumentsPanel, Fact, Stepper, STATUS_TONE } from './parts.jsx';

function Checklist({ items }) {
  const { t } = useI18n();
  if (!items.length) return <p className="cell-sub">{t('desk.noChecks')}</p>;
  return (
    <ul className="check-list">
      {items.map((i) => (
        <li key={i.id}>
          <div><span>{i.label}</span>{i.note && <div className="cell-sub">{i.note}</div>}</div>
          <Badge tone={STATUS_TONE[i.status]}>{t(`desk.st.${i.status}`)}</Badge>
        </li>
      ))}
    </ul>
  );
}

/** What the client sees of a case. Staff-only material never arrives here: the server does not send it. */
export default function ClientCase({ data, reload }) {
  const { t, lang } = useI18n();
  const c = data;
  const submission = c.submission;
  return (
    <>
      <Card>
        <div className="fact-grid">
          <Fact label={t('desk.deadline')}>{formatDateTime(c.deadline, lang)}</Fact>
          <Fact label={t('desk.estimated')}>{formatInr(c.estimatedValue, t('common.notDisclosed'))}</Fact>
          <Fact label={t('desk.emdAmount')}>{formatInr(c.emdAmount, t('common.notDisclosed'))}</Fact>
          <Fact label={t('desk.assigned')}>{c.assignedName ?? t('desk.unassigned')}</Fact>
        </div>
        <Stepper stage={c.stage} label={(k) => t(`desk.stage.${k}`)} />
        {c.stage === 'closed' && <p className="cell-sub">{t('desk.closedNote')} {t(`desk.outcome.${c.outcome}`)}.</p>}
      </Card>

      <Card title={t('desk.summary')}>
        {c.summary ? <p style={{ whiteSpace: 'pre-wrap' }}>{c.summary}</p> : <p className="cell-sub">{t('desk.noSummary')}</p>}
        {c.requestNote && <p className="cell-sub" style={{ marginTop: 10 }}>{t('desk.requested')}: {c.requestNote}</p>}
      </Card>

      <div className="grid-2">
        <Card title={t('desk.eligibility')}><Checklist items={c.checklists.eligibility} /></Card>
        <Card title={t('desk.technical')}><Checklist items={c.checklists.technical} /></Card>
      </div>

      <Card title={t('desk.prebid')}>
        {c.prebid.length === 0 ? <p className="cell-sub">{t('desk.noPrebid')}</p> : c.prebid.map((p) => (
          <div className="preview-item" key={p.id} style={{ display: 'block' }}>
            <b>{p.query}</b>
            <div className="cell-sub">{formatDate(p.raisedAt, lang)}</div>
            <div style={{ marginTop: 4 }}>{p.response ? <><span className="cell-sub">{t('desk.response')}: </span>{p.response}</> : <span className="cell-sub">{t('desk.awaiting')}</span>}</div>
          </div>
        ))}
      </Card>

      <div className="grid-2">
        <Card title={t('desk.submission')}>
          {!submission ? <p className="cell-sub">{t('desk.notSubmitted')}</p> : (
            <dl className="kv">
              <dt>{submission.mode === 'online' ? t('desk.online') : t('desk.offline')}</dt><dd>{formatDateTime(submission.submittedAt, lang)}</dd>
              {submission.portalReference && <><dt>{t('desk.portalRef')}</dt><dd>{submission.portalReference}</dd></>}
              {submission.courierName && <><dt>{t('desk.courier')}</dt><dd>{submission.courierName}</dd></>}
              {submission.trackingNumber && <><dt>{t('desk.tracking')}</dt><dd>{submission.trackingNumber}</dd></>}
            </dl>
          )}
        </Card>
        <Card title={t('desk.result')}>
          {!c.result || (c.result.outcome === 'pending' && c.result.technicalStatus === 'pending') ? <p className="cell-sub">{t('desk.noResult')}</p> : (
            <dl className="kv">
              <dt>{t('desk.technicalStatus')}</dt><dd>{t(`desk.tech.${c.result.technicalStatus ?? 'pending'}`)}</dd>
              <dt>{t('desk.financialStatus')}</dt><dd>{t(`desk.fin.${c.result.financialStatus ?? 'pending'}`)}</dd>
              {c.result.outcome !== 'pending' && <><dt>{t('desk.result')}</dt><dd><Badge tone={c.result.outcome === 'l1' ? 'green' : 'slate'}>{c.result.outcome === 'l1' ? t('desk.won') : t('desk.notL1')}</Badge></dd></>}
              {c.result.ourAmount !== null && <><dt>{t('desk.ourBid')}</dt><dd>{formatInr(c.result.ourAmount)}</dd></>}
              {c.result.l1Amount !== null && <><dt>{t('desk.l1Bid')}</dt><dd>{formatInr(c.result.l1Amount)}</dd></>}
              {c.result.remarks && <><dt>-</dt><dd>{c.result.remarks}</dd></>}
            </dl>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title={t('desk.emd')}>
          {c.emd.length === 0 ? <p className="cell-sub">{t('desk.noEmd')}</p> : c.emd.map((e) => (
            <dl className="kv" key={e.id}>
              <dt>{t('desk.instrument')}</dt><dd>{e.instrumentType}{e.issuingBank ? `, ${e.issuingBank}` : ''}{e.instrumentNumber ? ` (${e.instrumentNumber})` : ''}</dd>
              <dt>{t('desk.emdAmount')}</dt><dd>{formatInr(e.amount, '-')}</dd>
              <dt>{t('desk.validTill')}</dt><dd>{e.validTill ?? '-'}</dd>
              <dt>{t('desk.refund')}</dt><dd>{e.refundStatus}</dd>
            </dl>))}
        </Card>
        <Card title={t('desk.followups')}>
          {c.followups.length === 0 ? <p className="cell-sub">{t('desk.noFollowups')}</p> : (
            <ul className="check-list">
              {c.followups.map((f) => (
                <li key={f.id}>
                  <div>{t(`desk.fu.${f.kind}`)}<div className="cell-sub">{f.dueDate ? `${t('desk.due')} ${f.dueDate}` : ''}{f.reference ? ` · ${f.reference}` : ''}</div></div>
                  <Badge tone={f.status === 'done' ? 'green' : 'amber'}>{f.status === 'done' ? t('desk.done') : t('desk.pendingStatus')}</Badge>
                </li>))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={t('desk.documents')}>
        <DocumentsPanel caseData={c} staff={false} onChange={reload} />
      </Card>
    </>
  );
}
