import crypto from 'node:crypto';
import argon2 from 'argon2';
import config from '../config/index.js';

const argonOptions = {
  type: argon2.argon2id,
  memoryCost: config.auth.argon.memoryCost,
  timeCost: config.auth.argon.timeCost,
  parallelism: config.auth.argon.parallelism,
};

export const hashPassword = (plain) => argon2.hash(plain, argonOptions);

/**
 * Verify a password. Never throws on a malformed hash — a corrupted row must
 * read as "wrong password", not as a 500 that tells an attacker something.
 */
export async function verifyPassword(hash, plain) {
  if (!hash) {
    // Constant-ish work so "no password set" and "wrong password" take
    // comparable time and cannot be distinguished by a stopwatch.
    await argon2.hash(plain, argonOptions).catch(() => {});
    return false;
  }
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** True when the hash was made with weaker parameters than we now use. */
export function needsRehash(hash) {
  try {
    return argon2.needsRehash(hash, argonOptions);
  } catch {
    return false;
  }
}

/** URL-safe random token for refresh tokens, password resets and visitor ids. */
export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');

/** SHA-256 of a token. We store this, never the token itself. */
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Stable content hash used to skip re-indexing unchanged knowledge. */
export const checksum = (value) =>
  crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

/** Timing-safe string comparison. */
export function safeEqual(a = '', b = '') {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
