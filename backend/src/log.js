/** Minimal structured logger: one JSON line per event, silent under test. */
import { config } from './config.js';

function emit(level, msg, fields) {
  if (config.isTest && level !== 'error') return;
  const line = { t: new Date().toISOString(), level, msg, ...fields };
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(config.isProd ? JSON.stringify(line) : `[${level}] ${msg}${fields ? ' ' + JSON.stringify(fields) : ''}`);
}

export const log = {
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
};
