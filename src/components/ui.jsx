import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ChevronRight, Loader2, X } from 'lucide-react';

export function Spinner({ label }) {
  return (
    <span className="spinner" role="status">
      <Loader2 size={16} className="spin" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Loading({ label = 'Loading...' }) {
  return <div className="state-box"><Spinner label={label} /></div>;
}

export function ErrorNote({ error, onRetry, retryLabel = 'Try again' }) {
  if (!error) return null;
  return (
    <div className="note note-error" role="alert">
      <AlertCircle size={16} />
      <span>{error.message || String(error)}</span>
      {onRetry && <button type="button" className="link-btn" onClick={onRetry}>{retryLabel}</button>}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="state-box">
      <b>{title}</b>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Badge({ tone = 'slate', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Card({ title, actions, children, className = '', flush = false }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          {title && <h3>{title}</h3>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'card-body flush' : 'card-body'}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, crumbs = [], actions }) {
  return (
    <div className="page-top-strip">
      <div>
        {crumbs.length > 0 && (
          <div className="breadcrumbs-nav">
            {crumbs.map((c, i) => (
              <span key={i} className="crumb">
                {i > 0 && <ChevronRight size={12} />}
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span className="crumb-current">{c.label}</span>}
              </span>
            ))}
          </div>
        )}
        <div className="page-headline-block">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="page-action-buttons">{actions}</div>}
    </div>
  );
}

/** Label + control + error text, wired together for screen readers. */
export function Field({ label, hint, error, children, optional }) {
  const id = useId();
  const control = typeof children === 'function' ? children({ id, 'aria-invalid': Boolean(error) || undefined }) : children;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {optional && <span className="field-optional"> ({optional})</span>}
      </label>
      {control}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide = false }) {
  const dialog = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector('input, select, textarea, button:not(.modal-close)')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog}>
        <header className="modal-header">
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function Button({ variant = 'primary', size, pending, children, className = '', ...rest }) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`}
      disabled={pending || rest.disabled}
      {...rest}
    >
      {pending && <Loader2 size={14} className="spin" />}
      {children}
    </button>
  );
}
