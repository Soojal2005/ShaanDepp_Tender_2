/**
 * Thin fetch wrapper for the API. Sessions travel in an httpOnly cookie; the
 * CSRF token returned at sign-in is echoed on every state-changing request.
 * Nothing about identity or role is ever sent from the browser: the server
 * decides that from the session.
 */
const BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let csrfToken = null;
let onUnauthorized = () => {};

export const setCsrfToken = (token) => { csrfToken = token; };
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function toQuery(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function request(method, path, { body, query, signal, raw = false, silent401 = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (UNSAFE.has(method) && csrfToken) headers['x-csrf-token'] = csrfToken;

  let response;
  try {
    response = await fetch(`${BASE}${path}${toQuery(query)}`, {
      method,
      credentials: 'include',
      headers,
      signal,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.', { code: 'network' });
  }

  if (response.status === 401 && !silent401) onUnauthorized();
  if (raw && response.ok) return response;
  if (response.status === 204) return null;

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    throw new ApiError(response.status, data?.error?.message || response.statusText || 'Request failed', {
      code: data?.error?.code,
      details: data?.error?.details,
    });
  }
  return data;
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body: body ?? {} }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
  delete: (path, opts) => request('DELETE', path, opts),
  /** Link for <a href> downloads (cookie is sent automatically on same-origin navigation). */
  url: (path, query) => `${BASE}${path}${toQuery(query)}`,
};
