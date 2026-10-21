import { Construction } from 'lucide-react';
import { Card, PageHeader } from '../components/ui.jsx';
import { useI18n } from '../i18n/index.jsx';

/** Placeholder for portal sections that are still being connected to live data. */
export default function ComingSoon({ titleKey }) {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t(titleKey)} crumbs={[{ label: t('nav.home'), to: '/app' }, { label: t(titleKey) }]} />
      <Card>
        <div className="state-box">
          <Construction size={28} style={{ color: '#F59E0B' }} />
          <b>{t(titleKey)}</b>
          <p style={{ maxWidth: 420 }}>{t('common.comingSoon')}</p>
        </div>
      </Card>
    </>
  );
}
