/**
 * Password hashing with scrypt (built into Node, no native dependency).
 * Parameters (N=2^14, r=8, p=5) follow the OWASP-recommended equivalent set.
 * Stored format: scrypt$N$r$p$<salt b64>$<hash b64>
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 2 ** 14, r: 8, p: 5 };
const KEYLEN = 32;
const MAXMEM = 128 * 1024 * 1024;

export async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(plain, salt, KEYLEN, { ...PARAMS, maxmem: MAXMEM });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(plain, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(plain, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: MAXMEM,
  });
  return crypto.timingSafeEqual(actual, expected);
}

// A real hash to compare against when the email is unknown, so response time
// does not reveal which addresses have accounts.
const decoyPromise = hashPassword(crypto.randomBytes(18).toString('hex'));
export async function burnPasswordCheck(plain) {
  await verifyPassword(plain, await decoyPromise);
}

/** A hash nobody knows the password for; used for invited users who have not set one yet. */
export async function unusablePasswordHash() {
  return hashPassword(crypto.randomBytes(32).toString('hex'));
}
