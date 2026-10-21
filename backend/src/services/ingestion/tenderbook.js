/**
 * Client for the Tenderbook (Metalbook) vendor API. The key is read from
 * configuration on the server only; it never appears in a response, a log line
 * or an error message. `fetchImpl` is injectable so tests never touch the network.
 */
import { config } from '../../config.js';

export class SourceError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = 'SourceError';
    this.status = status;
    this.retryable = retryable;
  }
}

const authHeader = (key) => (/^api-key\s/i.test(key) ? key : `api-key ${key}`);

export function createTenderbookClient({
  baseUrl = config.tenderbook.baseUrl,
  apiKey = config.tenderbook.apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
} = {}) {
  if (!apiKey) throw new SourceError('Tenderbook API key is not configured');

  async function post(path, { page = 0, size = 100, filter = {} } = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}?fetchAll=true&page=${page}&size=${size}`, {
        method: 'POST',
        headers: { Authorization: authHeader(apiKey), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(filter ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const why = err?.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
      throw new SourceError(`Tenderbook ${why}`, { retryable: true });
    }
    if (response.status === 401 || response.status === 403) {
      throw new SourceError('Tenderbook rejected the API key (expired or revoked). Renew the subscription key.', { status: response.status });
    }
    if (response.status === 429 || response.status >= 500) {
      throw new SourceError(`Tenderbook is unavailable (HTTP ${response.status})`, { status: response.status, retryable: true });
    }
    if (!response.ok) throw new SourceError(`Tenderbook returned HTTP ${response.status}`, { status: response.status });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new SourceError('Tenderbook returned a response that is not JSON');
    }
    if (!data || !Array.isArray(data.content)) {
      throw new SourceError('Tenderbook response has an unexpected shape (no "content" list). The API may have changed.');
    }
    return {
      content: data.content,
      totalElements: Number(data.total_elements) || 0,
      totalPages: Number(data.total_pages) || 0,
      page: Number(data.number) || 0,
    };
  }

  return {
    tenders: (args) => post('/mb/vendor/getTenders', args),
    results: (args) => post('/mb/vendor/getTenderResults', args),
  };
}
