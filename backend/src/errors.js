import { log } from './log.js';

export class HttpError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, { code: 'bad_request', details });
export const unauthorized = (message = 'Sign in required') => new HttpError(401, message, { code: 'unauthorized' });
export const forbidden = (message = 'You do not have access to this') => new HttpError(403, message, { code: 'forbidden' });
export const notFound = (message = 'Not found') => new HttpError(404, message, { code: 'not_found' });
export const conflict = (message, details) => new HttpError(409, message, { code: 'conflict', details });

/** Wraps an async route handler so rejections reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Postgres error classes worth translating into client errors.
const PG_STATUS = {
  '23505': [409, 'That record already exists'],
  '23503': [409, 'This record is referenced elsewhere or points to something that does not exist'],
  '23514': [400, 'A value is outside the allowed range'],
  '23502': [400, 'A required value is missing'],
  '42501': [403, 'You do not have access to this'],
};

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { message: err.message, code: err.code, details: err.details } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Request body is not valid JSON', code: 'bad_json' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { message: 'Request body is too large', code: 'too_large' } });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { message: 'File is too large', code: 'too_large' } });
  }
  const mapped = PG_STATUS[err?.code];
  if (mapped) {
    return res.status(mapped[0]).json({ error: { message: mapped[1], code: 'database_constraint' } });
  }
  log.error('unhandled error', { path: req.path, method: req.method, error: err?.message, stack: err?.stack });
  return res.status(500).json({ error: { message: 'Something went wrong on our side', code: 'internal' } });
}
