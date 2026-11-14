// The phone's side of staff sign-in (slice 19). A barber signs in on their phone at the start of
// each business day. The phone always asks the shop PC first; only when the PC can't be reached
// does it check the password itself, against a verifier saved at its last online sign-in
// (Decisions 8 to 11). Signing in never changes who a sale is credited to: that stays the
// phone's assignment. It only decides whether the POS starts a new ticket.
//
// Everything here takes `now` and the storage as arguments, so `npm run test:local-session` runs
// it in Node. Network calls live in lib/sign-in-client.ts.

import { manilaToday, parseBusinessDate } from "./business-date";

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** What the server answers about an account (POST /api/v1/auth/login, GET /api/v1/auth/session). */
export type SignedInAccount = {
  id: string;
  username: string;
  name: string;
  role: "OWNER" | "BARBER" | "CASHIER";
  barberId: string | null;
  barberName: string | null;
  passwordChangedAt: string | null;
};

/** The phone's sign-in for today. `mode` says whether the PC or the phone checked the password. */
export type LocalSession = {
  userId: string;
  username: string;
  barberId: string;
  barberName: string;
  passwordChangedAt: string | null;
  businessDate: string; // Manila YYYY-MM-DD
  expiresAt: number; // ms: the end of that business day
  mode: "online" | "offline";
};

/** Saved at each online sign-in, replaced at the next. Never the password itself. */
export type Verifier = {
  userId: string;
  username: string;
  barberId: string;
  barberName: string;
  passwordChangedAt: string | null;
  salt: string; // hex
  iterations: number;
  hash: string; // hex, PBKDF2-SHA-256
};

export type Backoff = { failures: number; lockedUntil: number };

export const SESSION_KEY = "ruzzco_staff_session";
export const VERIFIER_KEY = "ruzzco_staff_verifier";
export const BACKOFF_KEY = "ruzzco_staff_backoff";

// Decision 8: 600,000 iterations; lower only if a real low-end phone takes over 2 s, never below
// 210,000 (and record the figure in the session log).
export const VERIFIER_ITERATIONS = 600_000;
export const VERIFIER_MIN_ITERATIONS = 210_000;

// Decision 8: after 5 wrong offline tries the phone waits 1 minute, doubling to 15 minutes.
export const OFFLINE_FREE_TRIES = 5;
export const OFFLINE_FIRST_WAIT_MS = 60_000;
export const OFFLINE_MAX_WAIT_MS = 15 * 60_000;

// ── Storage ──────────────────────────────────────────────────────────────────

function readJson<T>(storage: KeyValueStorage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: KeyValueStorage, key: string, value: unknown) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the phone asks for sign-in again next time.
  }
}

function remove(storage: KeyValueStorage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

export const readLocalSession = (storage: KeyValueStorage) => readJson<LocalSession>(storage, SESSION_KEY);
export const readVerifier = (storage: KeyValueStorage) => readJson<Verifier>(storage, VERIFIER_KEY);
export const readBackoff = (storage: KeyValueStorage): Backoff =>
  readJson<Backoff>(storage, BACKOFF_KEY) ?? { failures: 0, lockedUntil: 0 };

/** Sign out: ends today's session. The verifier stays, so the same barber can sign in offline again. */
export function endLocalSession(storage: KeyValueStorage) {
  remove(storage, SESSION_KEY);
}

export function deleteVerifier(storage: KeyValueStorage) {
  remove(storage, VERIFIER_KEY);
}

// ── Business day ─────────────────────────────────────────────────────────────

/** End of the Manila business day `now` falls in (midnight Manila), in ms. */
export function endOfBusinessDay(now: Date): number {
  return parseBusinessDate(manilaToday(now))!.end.getTime();
}

export function newLocalSession(account: Pick<Verifier, "userId" | "username" | "barberId" | "barberName" | "passwordChangedAt">, mode: LocalSession["mode"], now: Date): LocalSession {
  return {
    userId: account.userId,
    username: account.username,
    barberId: account.barberId,
    barberName: account.barberName,
    passwordChangedAt: account.passwordChangedAt,
    businessDate: manilaToday(now),
    expiresAt: endOfBusinessDay(now),
    mode,
  };
}

/**
 * Why the POS must ask for sign-in now, or null when today's session still holds. A session from
 * another business day has ended; so has one for a barber other than the phone's binding (the
 * phone was moved with the owner PIN).
 */
export function signInNeeded(session: LocalSession | null, now: Date, boundBarberId: string | null): "NONE" | "EXPIRED" | "OTHER_BARBER" | null {
  if (!session) return "NONE";
  if (session.businessDate !== manilaToday(now) || now.getTime() >= session.expiresAt) return "EXPIRED";
  if (boundBarberId && session.barberId !== boundBarberId) return "OTHER_BARBER";
  return null;
}

// ── Back-off (offline tries only) ────────────────────────────────────────────

export function offlineWaitMs(backoff: Backoff, now: Date): number {
  return Math.max(0, backoff.lockedUntil - now.getTime());
}

/** After a wrong offline try: the 5th waits 1 minute, each further one doubles it, up to 15. */
export function afterOfflineFailure(backoff: Backoff, now: Date): Backoff {
  const failures = backoff.failures + 1;
  if (failures < OFFLINE_FREE_TRIES) return { failures, lockedUntil: backoff.lockedUntil };
  const wait = Math.min(OFFLINE_FIRST_WAIT_MS * 2 ** (failures - OFFLINE_FREE_TRIES), OFFLINE_MAX_WAIT_MS);
  return { failures, lockedUntil: now.getTime() + wait };
}

// ── Verifier (Web Crypto) ────────────────────────────────────────────────────

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function pbkdf2(subtle: SubtleCrypto, password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return toHex(new Uint8Array(bits));
}

export async function createVerifier(
  subtle: SubtleCrypto,
  account: Pick<Verifier, "userId" | "username" | "barberId" | "barberName" | "passwordChangedAt">,
  password: string,
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>,
  iterations = VERIFIER_ITERATIONS
): Promise<Verifier> {
  const salt = random(new Uint8Array(16));
  return { ...account, salt: toHex(salt), iterations, hash: await pbkdf2(subtle, password, salt, iterations) };
}

export async function checkVerifier(subtle: SubtleCrypto, verifier: Verifier, password: string): Promise<boolean> {
  if (!/^[0-9a-f]{32}$/.test(verifier.salt) || !/^[0-9a-f]{64}$/.test(verifier.hash) || !(verifier.iterations > 0)) return false;
  const hash = await pbkdf2(subtle, password, fromHex(verifier.salt), verifier.iterations);
  // Compare every character, so the time doesn't depend on where they first differ.
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ verifier.hash.charCodeAt(i);
  return diff === 0;
}

// ── Sign-in (Decisions 8 to 11) ──────────────────────────────────────────────

/** The server's answer to a sign-in, as the phone sees it. */
export type LoginAnswer =
  | { kind: "ok"; account: SignedInAccount }
  | {
      kind: "refused";
      code: "WRONG_PASSWORD" | "INACTIVE" | "PHONE_ASSIGNED" | "OWNER_ON_POS" | "TOO_MANY" | "DEVICE_NOT_APPROVED" | "OTHER";
      message: string;
    }
  // Network error, timeout, or the HTTPS gateway saying the app behind it is down.
  | { kind: "unreachable" };

export type SignInDeps = {
  login: (username: string, password: string) => Promise<LoginAnswer>;
  storage: KeyValueStorage;
  now: () => Date;
  /** The phone's local binding, or null when it has none yet. */
  bound: { barberId: string; barberName: string } | null;
  /** Web Crypto; null where it is missing (no secure context): no offline sign-in then. */
  subtle: SubtleCrypto | null;
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
  iterations?: number;
};

export type SignInResult =
  | { ok: true; session: LocalSession; online: boolean }
  | { ok: false; code: string; message: string; online: boolean };

export const assignedMessage = (barberName: string) => `This phone is assigned to ${barberName}.`;
export const WRONG_PASSWORD_MESSAGE = "Wrong username or password.";

export async function signIn(usernameInput: string, password: string, deps: SignInDeps): Promise<SignInResult> {
  const username = usernameInput.trim().toLowerCase();
  if (!username || !password) return { ok: false, code: "WRONG_PASSWORD", message: WRONG_PASSWORD_MESSAGE, online: false };

  const answer = await deps.login(username, password);

  if (answer.kind === "ok") {
    const { account } = answer;
    if (account.role !== "BARBER" || !account.barberId || !account.barberName) {
      return { ok: false, code: "OWNER_ON_POS", message: "Owner accounts don't record sales.", online: true };
    }
    // Decision 11 on the phone: its own binding decides, even if the server hasn't seen it yet.
    if (deps.bound && deps.bound.barberId !== account.barberId) {
      return { ok: false, code: "PHONE_ASSIGNED", message: assignedMessage(deps.bound.barberName), online: true };
    }
    const facts = {
      userId: account.id,
      username: account.username,
      barberId: account.barberId,
      barberName: account.barberName,
      passwordChangedAt: account.passwordChangedAt,
    };
    // One verifier per phone, replaced at each online sign-in (Decision 8).
    if (deps.subtle) {
      try {
        writeJson(deps.storage, VERIFIER_KEY, await createVerifier(deps.subtle, facts, password, deps.random, deps.iterations));
      } catch {
        deleteVerifier(deps.storage);
      }
    }
    remove(deps.storage, BACKOFF_KEY);
    const session = newLocalSession(facts, "online", deps.now());
    writeJson(deps.storage, SESSION_KEY, session);
    return { ok: true, session, online: true };
  }

  if (answer.kind === "refused") {
    // Decision 9: a server answer is final; never fall back to the verifier after it.
    if (answer.code === "INACTIVE") deleteVerifier(deps.storage);
    if (answer.code === "WRONG_PASSWORD") {
      // The verifier still accepts what the server refuses: the password was changed. Drop it.
      const verifier = readVerifier(deps.storage);
      if (verifier && verifier.username === username && deps.subtle && (await checkVerifier(deps.subtle, verifier, password).catch(() => false))) {
        deleteVerifier(deps.storage);
      }
    }
    return { ok: false, code: answer.code, message: answer.message, online: true };
  }

  // Unreachable: the phone checks the password itself (case 1).
  if (!deps.subtle) {
    return { ok: false, code: "NO_CRYPTO", message: "Can't reach the shop PC, and offline sign-in needs the secure (https) address of the POS.", online: false };
  }
  const now = deps.now();
  const backoff = readBackoff(deps.storage);
  const wait = offlineWaitMs(backoff, now);
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60_000);
    return { ok: false, code: "TOO_MANY", message: `Too many wrong tries. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, online: false };
  }
  const verifier = readVerifier(deps.storage);
  if (!verifier || verifier.username !== username) {
    return { ok: false, code: "NEEDS_PC", message: "Can't reach the shop PC. This account must sign in once with the shop PC on before it can sign in offline on this phone.", online: false };
  }
  if (deps.bound && deps.bound.barberId !== verifier.barberId) {
    return { ok: false, code: "PHONE_ASSIGNED", message: assignedMessage(deps.bound.barberName), online: false };
  }
  if (!(await checkVerifier(deps.subtle, verifier, password).catch(() => false))) {
    writeJson(deps.storage, BACKOFF_KEY, afterOfflineFailure(backoff, now));
    return { ok: false, code: "WRONG_PASSWORD", message: WRONG_PASSWORD_MESSAGE, online: false };
  }
  remove(deps.storage, BACKOFF_KEY);
  const session = newLocalSession(verifier, "offline", now);
  writeJson(deps.storage, SESSION_KEY, session);
  return { ok: true, session, online: false };
}

// ── Recheck while the PC is reachable (Decision 10) ──────────────────────────

export type SessionAnswer =
  | { kind: "ok"; account: SignedInAccount }
  | { kind: "refused"; reason: "NONE" | "EXPIRED" | "PASSWORD_CHANGED" | "INACTIVE" }
  | { kind: "unreachable" };

/**
 * Applies the server's answer about the signed-in account. PASSWORD_CHANGED or INACTIVE end the
 * local session and delete the verifier; anything else (no cookie, an expired cookie, no
 * connection) keeps the local session.
 */
export function applySessionAnswer(answer: SessionAnswer, storage: KeyValueStorage): "kept" | "ended" {
  if (answer.kind === "refused" && (answer.reason === "PASSWORD_CHANGED" || answer.reason === "INACTIVE")) {
    endLocalSession(storage);
    deleteVerifier(storage);
    return "ended";
  }
  return "kept";
}
