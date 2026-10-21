import { Link, useParams } from 'react-router-dom';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { can, useAuth } from '../../auth/AuthContext.jsx';
import BundleView from '../../components/report/BundleView.jsx';
import { Card, Empty, ErrorNote, Loading, PageHeader } from '../../components/ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { useAsync } from '../../lib/hooks.js';

const STAFF_ROLES = new Set(['analyst', 'case_manager', 'platform_admin']);

export function Reports() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const data = useAsync(async () => (await api.get('/reports/bundles')).bundles, []);
  const crumbs = [{ label: t('nav.home'), to: '/app' }, { label: t('nav.reports') }];
  return (
    <>
      <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} crumbs={crumbs} />
      {STAFF_ROLES.has(user.role) && <div className="note note-info">{t('reports.staffNote')} {can(user, 'reports:release') && <Link to="/app/admin/reports">{t('nav.weeklyReports')}</Link>}</div>}
      {data.loading && !data.data && <Loading label={t('common.loading')} />}
      <ErrorNote error={data.error} onRetry={data.reload} retryLabel={t('common.retry')} />
      {data.data?.length === 0 && !STAFF_ROLES.has(user.role) && <Card><Empty title={t('reports.lockerEmpty')}>{t('reports.lockerEmptyHint')}</Empty></Card>}
      {data.data?.length > 0 && (
        <div className="report-list">
          {data.data.map((b) => (
            <Card key={b.id} className="report-row">
              <div className="report-row-inner" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <div>
                  <div className="cell-title">{b.title}</div>
                  <div className="cell-sub">{t('reports.released', { date: formatDate(b.releasedAt, lang) })}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Link className="btn btn-primary btn-sm" to={`/app/reports/${b.id}`}>{t('reports.open')}</Link>
                  <a className="btn btn-outline btn-sm" href={api.url(`/reports/bundles/${b.id}/pdf`)} download><FileText size={13} />{t('reports.pdf')}</a>
                  <a className="btn btn-outline btn-sm" href={api.url(`/reports/bundles/${b.id}/xlsx`)} download><FileSpreadsheet size={13} />{t('reports.xlsx')}</a>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export function ReportDetail() {
  const { t } = useI18n();
  const { bundleId } = useParams();
  const data = useAsync(async () => (await api.get(`/reports/bundles/${bundleId}`)).bundle, [bundleId]);
  const b = data.data;
  const crumbs = [{ label: t('nav.home'), to: '/app' }, { label: t('nav.reports'), to: '/app/reports' }, { label: b?.title ?? '...' }];
  return (
    <>
      <PageHeader title={b?.title ?? t('reports.title')} subtitle={t('reports.downloadBoth')} crumbs={crumbs}
        actions={b && (
          <>
            <a className="btn btn-outline" href={api.url(`/reports/bundles/${b.id}/pdf`)} download><Download size={14} />{t('reports.pdf')}</a>
            <a className="btn btn-outline" href={api.url(`/reports/bundles/${b.id}/xlsx`)} download><Download size={14} />{t('reports.xlsx')}</a>
          </>
        )} />
      {data.loading && !b && <Loading label={t('common.loading')} />}
      <ErrorNote error={data.error} onRetry={data.reload} retryLabel={t('common.retry')} />
      {b && <BundleView snapshot={b.snapshot} />}
      <p><Link className="btn btn-outline btn-sm" to="/app/reports">{t('reports.back')}</Link></p>
    </>
  );
}

export default Reports;
