import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const FALLBACK = { phone: '+91 82698 68808', email: 'info@synquic.com', whatsappNumber: '918269868808', registration: { business: 'BHOP260407SE000586', gst: '23APSPT2592R1ZR' } };
let cached = null;
let inflight = null;

/** Contact details come from the server so they can change without a new build. */
export function useSiteConfig() {
  const [config, setConfig] = useState(cached ?? FALLBACK);
  useEffect(() => {
    if (cached) return;
    inflight ??= api.get('/public/site-config').then((c) => { cached = { ...FALLBACK, ...c }; return cached; }).catch(() => FALLBACK);
    let live = true;
    inflight.then((c) => { if (live) setConfig(c); });
    return () => { live = false; };
  }, []);
  return config;
}

export const telHref = (phone) => `tel:${String(phone).replace(/[^+\d]/g, '')}`;
export const whatsappHref = (number, text) => `https://wa.me/${String(number).replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

const upsert = (selector, create) => {
  let el = document.head.querySelector(selector);
  if (!el) { el = create(); document.head.appendChild(el); }
  return el;
};

/** Per-page title, description, canonical address and social preview tags. */
export function useSeo({ title, description, path }) {
  useEffect(() => {
    document.title = title;
    const origin = window.location.origin;
    const set = (selector, make, attr, value) => { if (value) upsert(selector, make).setAttribute(attr, value); };
    const meta = (name) => () => Object.assign(document.createElement('meta'), { name });
    const prop = (property) => () => { const m = document.createElement('meta'); m.setAttribute('property', property); return m; };
    set('meta[name="description"]', meta('description'), 'content', description);
    set('meta[property="og:title"]', prop('og:title'), 'content', title);
    set('meta[property="og:description"]', prop('og:description'), 'content', description);
    set('meta[property="og:type"]', prop('og:type'), 'content', 'website');
    set('meta[property="og:url"]', prop('og:url'), 'content', `${origin}${path}`);
    set('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), 'href', `${origin}${path}`);
  }, [title, description, path]);
}
