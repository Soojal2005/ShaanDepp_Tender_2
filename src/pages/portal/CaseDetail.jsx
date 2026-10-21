import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Badge, ErrorNote, Loading, PageHeader } from '../../components/ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import ClientCase from '../desk/ClientCase.jsx';
import StaffCase from '../desk/StaffCase.jsx';

export default function CaseDetail() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { caseId } = useParams();
  const staff = ['analyst', 'case_manager', 'platform_admin'].includes(user.role);
  const data = useAsync(() => api.get(`/cases/${caseId}`), [caseId]);
  const c = data.data?.case;
  const crumbs = [{ label: t('nav.home'), to: '/app' }, { label: t('nav.desk'), to: '/app/desk' }, { label: c?.ref ?? '...' }];
  return (
    <>
      <PageHeader title={c?.title ?? t('desk.title')} subtitle={c ? [c.ref, c.department].filter(Boolean).join(' · ') : undefined} crumbs={crumbs}
        actions={c && c.outcome !== 'pending' ? <Badge tone={c.outcome === 'l1' ? 'green' : 'slate'}>{t(`desk.outcome.${c.outcome}`)}</Badge> : null} />
      {data.loading && !c && <Loading label={t('common.loading')} />}
      <ErrorNote error={data.error} onRetry={data.reload} retryLabel={t('common.retry')} />
      {c && (staff ? <StaffCase data={c} stages={data.data.stages} reload={data.reload} /> : <ClientCase data={c} reload={data.reload} />)}
      <p><Link className="btn btn-outline btn-sm" to="/app/desk">{t('desk.back')}</Link></p>
    </>
  );
}
