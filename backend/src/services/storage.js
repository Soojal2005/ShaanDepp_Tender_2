/**
 * File storage for the submission desk's document vault. Files live on disk
 * under STORAGE_DIR; the database keeps only a key. Everything that touches the
 * disk goes through here so a key can never point outside STORAGE_DIR, and an
 * upload is accepted only if its bytes match what its extension claims.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { badRequest } from '../errors.js';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const SIGNATURES = {
  pdf: [Buffer.from('%PDF')],
  png: [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  jpg: [Buffer.from([0xff, 0xd8, 0xff])],
  jpeg: [Buffer.from([0xff, 0xd8, 0xff])],
  zip: [Buffer.from('PK\x03\x04')],
  docx: [Buffer.from('PK\x03\x04')],
  xlsx: [Buffer.from('PK\x03\x04')],
  doc: [Buffer.from([0xd0, 0xcf, 0x11, 0xe0])],
  xls: [Buffer.from([0xd0, 0xcf, 0x11, 0xe0])],
};
const TEXT = new Set(['txt', 'csv']);
export const ALLOWED_EXTENSIONS = [...Object.keys(SIGNATURES), ...TEXT];

export const extensionOf = (name) => path.extname(String(name)).slice(1).toLowerCase();

/** A safe display name: no path parts, no control characters, bounded length. */
export function cleanFileName(name) {
  const base = path.basename(String(name).replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '').trim();
  return (base || 'file').slice(0, 150);
}

/** Throws a 400 unless the bytes match the extension. */
export function checkUpload(name, buffer) {
  const ext = extensionOf(name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) throw badRequest(`Files of type .${ext || '?'} are not accepted. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.`);
  if (!buffer?.length) throw badRequest('The file is empty');
  if (buffer.length > MAX_UPLOAD_BYTES) throw badRequest('The file is larger than 15 MB');
  if (TEXT.has(ext)) {
    if (buffer.subarray(0, 4096).includes(0)) throw badRequest('This does not look like a text file');
    return ext;
  }
  if (!SIGNATURES[ext].some((sig) => buffer.subarray(0, sig.length).equals(sig))) {
    throw badRequest(`This file does not look like a real .${ext} file`);
  }
  return ext;
}

const root = () => path.resolve(config.storageDir);

function resolveKey(key) {
  const full = path.resolve(root(), key);
  if (full !== root() && !full.startsWith(root() + path.sep)) throw new Error('Storage key escapes the storage directory');
  return full;
}

export async function saveFile(folder, name, buffer) {
  const ext = checkUpload(name, buffer);
  const key = `${folder}/${crypto.randomUUID()}.${ext}`;
  const full = resolveKey(key);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, buffer, { flag: 'wx' });
  return { key, size: buffer.length };
}

export const openFile = (key) => fs.createReadStream(resolveKey(key));
export const fileExists = (key) => fs.existsSync(resolveKey(key));
export async function removeFile(key) {
  await fs.promises.rm(resolveKey(key), { force: true });
}
