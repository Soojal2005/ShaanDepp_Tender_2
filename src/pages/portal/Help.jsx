import { ExternalLink, Mail, MessageCircle, Phone } from 'lucide-react';
import { Card, ErrorNote, Loading, PageHeader } from '../../components/ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';

function Contact() {
  const { t } = useI18n();
  const site = useAsync(() => api.get('/public/site-config'), []);
  if (site.loading && !site.data) return <Loading />;
  if (site.error) return <ErrorNote error={site.error} onRetry={site.reload} retryLabel={t('common.retry')} />;
  const { phone, email, whatsappNumber } = site.data;
  return (
    <Card title={t('help.contact')}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <a className="btn btn-outline" href={`tel:${phone.replace(/\s/g, '')}`}><Phone size={15} />{t('help.callUs')} · {phone}</a>
        <a className="btn btn-outline" href={`mailto:${email}`}><Mail size={15} />{t('help.emailUs')} · {email}</a>
        <a className="btn btn-outline" href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noopener noreferrer">
          <MessageCircle size={15} />{t('help.whatsapp')}
        </a>
      </div>
    </Card>
  );
}

export default function Help() {
  const { t } = useI18n();
  const portals = t('help.portals');
  const faq = t('help.faq');
  return (
    <>
      <PageHeader title={t('help.title')} subtitle={t('help.subtitle')} crumbs={[{ label: t('nav.home'), to: '/app' }, { label: t('nav.help') }]} />

      <Contact />

      <Card title={t('help.portalsTitle')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {portals.map((p) => (
            <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer"
              style={{ textDecoration: 'none', padding: 14, border: '1px solid #E2E8F0', borderRadius: 10, background: '#fff', display: 'block' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 700, color: 'var(--slate-900)' }}>
                {p.name}<ExternalLink size={14} style={{ color: '#0066FF' }} />
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--slate-500)', marginTop: 2 }}>{p.sub}</div>
            </a>
          ))}
        </div>
      </Card>

      <Card title={t('help.faqTitle')}>
        {faq.map((item, i) => (
          <details key={i} style={{ padding: '12px 0', borderBottom: i < faq.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--slate-900)' }}>{item.q}</summary>
            <p style={{ marginTop: 8, color: 'var(--slate-600)', lineHeight: 1.6 }}>{item.a}</p>
          </details>
        ))}
      </Card>
    </>
  );
}
