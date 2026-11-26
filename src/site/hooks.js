import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const FALLBACK = { phone: '+91 79743 92235', email: 'shantanu.trivedi@procure-brain.in', whatsappNumber: '919301039191', registration: { business: 'BHOP260407SE000586', gst: '23APSPT2592R1ZR' } };
export function normalizeSiteConfig(config = {}) {
  const phone = String(config.phone || '').replace(/\D/g, '');
  const whatsapp = String(config.whatsappNumber || '').replace(/\D/g, '');
  return {
    ...FALLBACK, ...config,
    phone: !phone || phone.endsWith('8269868808') ? FALLBACK.phone : config.phone,
    email: !config.email || config.email.trim().toLowerCase() === 'info@synquic.com' ? FALLBACK.email : config.email,
    whatsappNumber: !whatsapp || whatsapp.endsWith('8269868808') ? FALLBACK.whatsappNumber : config.whatsappNumber,
  };
}
let cached = null;
let inflight = null;

/** Contact details come from the server so they can change without a new build. */
export function useSiteConfig() {
  const [config, setConfig] = useState(cached ?? FALLBACK);
  useEffect(() => {
    if (cached) return;
    inflight ??= api.get('/public/site-config').then((c) => { cached = normalizeSiteConfig(c); return cached; }).catch(() => FALLBACK);
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
