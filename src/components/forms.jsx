import { useState } from 'react';
import { X } from 'lucide-react';

/** Type a value, press Enter (or comma) to turn it into a removable chip. */
export function TagInput({ id, value, onChange, placeholder, validate, max = 30, ariaLabel }) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState(null);

  const commit = () => {
    const parts = draft.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const part of parts) {
      if (validate && !validate(part)) { setProblem(`"${part}" is not valid`); return; }
      if (!next.some((v) => v.toLowerCase() === part.toLowerCase()) && next.length < max) next.push(part);
    }
    setProblem(null);
    setDraft('');
    onChange(next);
  };

  return (
    <div>
      <div className="tag-box">
        {value.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
            <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((v) => v !== tag))}><X size={12} /></button>
          </span>
        ))}
        <input
          id={id}
          aria-label={ariaLabel}
          value={draft}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
            else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={commit}
        />
      </div>
      {problem && <span className="field-error">{problem}</span>}
    </div>
  );
}

/** Pick several entries from a list: chosen ones show as chips, the dropdown adds more. */
export function MultiPick({ id, options, value, onChange, anyLabel, ariaLabel }) {
  const byId = new Map(options.map((o) => [o.id, o]));
  return (
    <div>
      <div className="tag-box">
        {value.length === 0 && <span className="tag-any">{anyLabel}</span>}
        {value.map((v) => (
          <span key={v} className="tag-chip">
            {byId.get(v)?.name ?? `#${v}`}
            <button type="button" aria-label={`Remove ${byId.get(v)?.name ?? v}`} onClick={() => onChange(value.filter((x) => x !== v))}><X size={12} /></button>
          </span>
        ))}
      </div>
      <select id={id} className="select" style={{ marginTop: 6 }} value="" aria-label={ariaLabel}
        onChange={(e) => { if (e.target.value) onChange([...value, Number(e.target.value)]); }}>
        <option value="">+ {ariaLabel}</option>
        {options.filter((o) => !value.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}
