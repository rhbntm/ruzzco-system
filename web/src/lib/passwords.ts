import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Staff account passwords (slice 19, Decision 7): scrypt from node:crypto, a random 16-byte salt,
// stored as one string with its parameters so they can change later without breaking old hashes:
//   scrypt$<N>$<r>$<p>$<salt hex>$<hash hex>

const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, options: ScryptOptions, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, length, { ...options, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, PARAMS, KEY_LENGTH);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** True when `password` matches the stored hash. A malformed hash never matches. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const match = /^scrypt\$(\d{1,7})\$(\d{1,3})\$(\d{1,3})\$([0-9a-f]{32})\$([0-9a-f]{64,256})$/.exec(stored ?? "");
  if (!match) return false;
  const [, N, r, p, saltHex, hashHex] = match;
  const expected = Buffer.from(hashHex, "hex");
  try {
    const key = await derive(password, Buffer.from(saltHex, "hex"), { N: Number(N), r: Number(r), p: Number(p) }, expected.length);
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// A hash of a random password, checked when the username is unknown, so an unknown username takes
// as long as a wrong password (Decision 6: both get the same answer).
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash() {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

export const USERNAME_RULE = "Usernames are 3 to 32 characters: letters, digits, dot, underscore or hyphen.";
export const PASSWORD_MIN = 8;
// scrypt hashes anything, but a megabyte password is only a way to load the server.
export const PASSWORD_MAX = 128;
export const PASSWORD_RULE = `Passwords are at least ${PASSWORD_MIN} characters.`;

/** The stored form of a username (lower-case), or null when it breaks the rule. */
export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9._-]{3,32}$/.test(username) ? username : null;
}

export function passwordProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.length < PASSWORD_MIN) return PASSWORD_RULE;
  if (value.length > PASSWORD_MAX) return `Passwords are at most ${PASSWORD_MAX} characters.`;
  return null;
}
