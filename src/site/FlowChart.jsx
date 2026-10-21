import { useState } from 'react';
import { useI18n } from '../i18n/index.jsx';
import { FLOW } from '../content/services.js';

/** Nine steps from request to follow-up; choosing one shows what happens there. */
export default function FlowChart() {
  const { t, lang } = useI18n();
  const [active, setActive] = useState(0);
  const pick = (step) => step[lang === 'HI' ? 'hi' : 'en'];
  const [title, body] = pick(FLOW[active]);
  return (
    <div className="flow">
      <ol className="flow-steps" role="tablist" aria-label={t('site.flowTitle')}>
        {FLOW.map((step, i) => (
          <li key={step.key}>
            <button type="button" role="tab" aria-selected={i === active} className={`flow-step ${i === active ? 'active' : ''} ${i < active ? 'past' : ''}`}
              onClick={() => setActive(i)} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)}>
              <span className="flow-num">{i + 1}</span>
              <span className="flow-name">{pick(step)[0]}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="flow-detail" role="tabpanel" aria-live="polite">
        <h3>{active + 1}. {title}</h3>
        <p>{body}</p>
      </div>
    </div>
  );
}
