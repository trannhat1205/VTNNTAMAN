/**
 * Client-side password hashing helper using Web Crypto API (SHA-256 + per-account salt).
 * Never store or compare plaintext passwords in state, localStorage, or source code.
 */

const HASH_PREFIX = 'sha256:';

export function isHashedPassword(stored: string | undefined | null): boolean {
  return typeof stored === 'string' && stored.startsWith(HASH_PREFIX) && stored.length > HASH_PREFIX.length + 16;
}

export async function hashPassword(rawPassword: string, salt: string): Promise<string> {
  const normalizedSalt = (salt || 'taman_salt').trim().toLowerCase();
  const input = `${normalizedSalt}::${rawPassword}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${HASH_PREFIX}${hex}`;
  }
  // Fallback deterministic digest if Web Crypto subtle is unavailable (e.g. non-secure test runner)
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${HASH_PREFIX}fb_${part1}${part2}_${input.length.toString(16)}`;
}

export async function verifyPassword(
  rawPassword: string,
  storedHash: string | undefined | null,
  salt: string
): Promise<boolean> {
  if (!rawPassword || !storedHash || !isHashedPassword(storedHash)) {
    return false;
  }
  const computed = await hashPassword(rawPassword, salt);
  return computed === storedHash;
}
