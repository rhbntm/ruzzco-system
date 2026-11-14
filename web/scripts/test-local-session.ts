/**
 * The phone's offline sign-in (slice 19, src/lib/local-session.ts), in Node only: the verifier,
 * the business-day rollover at Manila midnight, the offline back-off, and the online-first rules
 * (Decisions 8 to 11). The server is replaced by a scripted answer; storage is a Map.
 *
 *   npm run test:local-session
 */
import { webcrypto } from "node:crypto";
import {
  BACKOFF_KEY,
  OFFLINE_FIRST_WAIT_MS,
  OFFLINE_MAX_WAIT_MS,
  SESSION_KEY,
  VERIFIER_ITERATIONS,
  VERIFIER_KEY,
  afterOfflineFailure,
  applySessionAnswer,
  checkVerifier,
  createVerifier,
  endLocalSession,
  endOfBusinessDay,
  offlineWaitMs,
  readBackoff,
  readLocalSession,
  readVerifier,
  signIn,
  signInNeeded,
  type KeyValueStorage,
  type LoginAnswer,
  type SignInDeps,
  type SignedInAccount,
} from "../src/lib/local-session";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const random = <T extends Uint8Array<ArrayBuffer>>(bytes: T) => webcrypto.getRandomValues(bytes);
// Fast for the test; the real figure is checked once below.
const ITERATIONS = 1_000;

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const BAYANI: SignedInAccount = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "bayani",
  name: "Bayani",
  role: "BARBER",
  barberId: "barber-bayani",
  barberName: "Bayani",
  passwordChangedAt: "2026-11-14T02:00:00.000Z",
};
const VINCE: SignedInAccount = { ...BAYANI, id: "22222222-2222-4222-8222-222222222222", username: "vince", name: "Vince", barberId: "barber-vince", barberName: "Vince" };
const OWNER: SignedInAccount = { ...BAYANI, id: "33333333-3333-4333-8333-333333333333", username: "mart", name: "Mart", role: "OWNER", barberId: null, barberName: null };
const PASSWORD = "correct horse";

// 2026-11-14 15:00 in Manila.
const AFTERNOON = new Date("2026-11-14T07:00:00.000Z");

function deps(storage: KeyValueStorage, answer: LoginAnswer | ((u: string, p: string) => LoginAnswer), overrides: Partial<SignInDeps> = {}) {
  const calls: string[] = [];
  const d: SignInDeps = {
    login: async (username, password) => {
      calls.push(username);
      return typeof answer === "function" ? answer(username, password) : answer;
    },
    storage,
    now: () => AFTERNOON,
    bound: { barberId: "barber-bayani", barberName: "Bayani" },
    subtle,
    random,
    iterations: ITERATIONS,
    ...overrides,
  };
  return { d, calls };
}

// The server knows Bayani's password, refuses everyone else.
const server = (password = PASSWORD) => (username: string, typed: string): LoginAnswer => {
  if (username === "bayani" && typed === password) return { kind: "ok", account: BAYANI };
  if (username === "vince" && typed === password) return { kind: "ok", account: VINCE };
  return { kind: "refused", code: "WRONG_PASSWORD", message: "Wrong username or password." };
};
const OFFLINE: LoginAnswer = { kind: "unreachable" };

async function verifierChecks() {
  console.log("Verifier (Decision 8)");
  const facts = { userId: BAYANI.id, username: "bayani", barberId: "barber-bayani", barberName: "Bayani", passwordChangedAt: null };
  const verifier = await createVerifier(subtle, facts, PASSWORD, random, ITERATIONS);
  check("stores no password", !JSON.stringify(verifier).includes(PASSWORD));
  check("the right password matches", await checkVerifier(subtle, verifier, PASSWORD));
  check("a wrong password does not", !(await checkVerifier(subtle, verifier, "correct hors")));
  check("a tampered hash does not", !(await checkVerifier(subtle, { ...verifier, hash: "0".repeat(64) }, PASSWORD)));
  check("a malformed salt never matches", !(await checkVerifier(subtle, { ...verifier, salt: "zz" }, PASSWORD)));
  const again = await createVerifier(subtle, facts, PASSWORD, random, ITERATIONS);
  check("each verifier has its own salt", again.salt !== verifier.salt && again.hash !== verifier.hash);
  const started = Date.now();
  const real = await createVerifier(subtle, facts, PASSWORD, random);
  const ms = Date.now() - started;
  check(`the real figure is ${VERIFIER_ITERATIONS.toLocaleString()} iterations (${ms} ms on this PC)`, real.iterations === VERIFIER_ITERATIONS);
}

function businessDayChecks() {
  console.log("Business day (Decision 4)");
  const end = endOfBusinessDay(AFTERNOON);
  check("a session made at 15:00 Manila ends at the next Manila midnight", new Date(end).toISOString() === "2026-11-14T16:00:00.000Z", new Date(end).toISOString());
  const lateNight = new Date("2026-11-14T15:59:59.000Z"); // 23:59:59 Manila
  check("23:59:59 Manila still belongs to the same day", endOfBusinessDay(lateNight) === end);
  const storage = memoryStorage();
  const session = { userId: BAYANI.id, username: "bayani", barberId: "barber-bayani", barberName: "Bayani", passwordChangedAt: null, businessDate: "2026-11-14", expiresAt: end, mode: "online" as const };
  check("valid at 23:59:59 Manila", signInNeeded(session, lateNight, "barber-bayani") === null);
  check("ended at 00:00 Manila", signInNeeded(session, new Date("2026-11-14T16:00:00.000Z"), "barber-bayani") === "EXPIRED");
  check("ended when the phone clock says another day", signInNeeded({ ...session, expiresAt: end + 86_400_000 }, new Date("2026-11-15T03:00:00.000Z"), "barber-bayani") === "EXPIRED");
  check("UTC midnight (08:00 Manila) changes nothing", signInNeeded(session, new Date("2026-11-14T00:00:00.000Z"), "barber-bayani") === null);
  check("no session: sign-in needed", signInNeeded(null, AFTERNOON, "barber-bayani") === "NONE");
  check("a session for another barber than the binding has ended", signInNeeded(session, AFTERNOON, "barber-vince") === "OTHER_BARBER");
  endLocalSession(storage);
  check("signing out with nothing stored is harmless", readLocalSession(storage) === null);
}

function backoffChecks() {
  console.log("Offline back-off (Decision 8)");
  let state = { failures: 0, lockedUntil: 0 };
  const t = AFTERNOON;
  for (let i = 0; i < 4; i++) state = afterOfflineFailure(state, t);
  check("4 wrong tries: no wait", offlineWaitMs(state, t) === 0);
  state = afterOfflineFailure(state, t);
  check("5th wrong try: 1 minute", offlineWaitMs(state, t) === OFFLINE_FIRST_WAIT_MS);
  const later = new Date(t.getTime() + OFFLINE_FIRST_WAIT_MS);
  check("after the minute the phone may try again", offlineWaitMs(state, later) === 0);
  state = afterOfflineFailure(state, later);
  check("6th: 2 minutes", offlineWaitMs(state, later) === 2 * OFFLINE_FIRST_WAIT_MS);
  state = afterOfflineFailure(state, later);
  check("7th: 4 minutes", offlineWaitMs(state, later) === 4 * OFFLINE_FIRST_WAIT_MS);
  state = afterOfflineFailure(state, later);
  state = afterOfflineFailure(state, later);
  check("9th: capped at 15 minutes", offlineWaitMs(state, later) === OFFLINE_MAX_WAIT_MS);
  state = afterOfflineFailure(state, later);
  check("stays at 15 minutes", offlineWaitMs(state, later) === OFFLINE_MAX_WAIT_MS);
}

async function signInChecks() {
  console.log("Online first (Decisions 9 to 11)");

  // A first online sign-in saves the verifier and today's session.
  const storage = memoryStorage();
  let run = deps(storage, server());
  let result = await signIn("Bayani", PASSWORD, run.d);
  check("online sign-in succeeds (username case ignored)", result.ok && result.online && run.calls[0] === "bayani");
  check("...saves a verifier and an online session", readVerifier(storage)?.userId === BAYANI.id && readLocalSession(storage)?.mode === "online");
  check("...the session ends at Manila midnight", readLocalSession(storage)?.expiresAt === endOfBusinessDay(AFTERNOON));

  // Offline with the right password: the verifier decides.
  endLocalSession(storage);
  run = deps(storage, OFFLINE);
  result = await signIn("bayani", PASSWORD, run.d);
  check("PC unreachable: the right password signs in offline", result.ok && !result.online && readLocalSession(storage)?.mode === "offline");
  check("...the server was still asked first", run.calls.length === 1);

  endLocalSession(storage);
  result = await signIn("bayani", "wrong password", run.d);
  check("PC unreachable: a wrong password is refused", !result.ok && result.code === "WRONG_PASSWORD" && readLocalSession(storage) === null);
  check("...and counts toward the back-off", readBackoff(storage).failures === 1);

  // A server answer is final: no fallback to the verifier after "wrong password".
  const changed = memoryStorage();
  await signIn("bayani", PASSWORD, deps(changed, server()).d);
  endLocalSession(changed);
  result = await signIn("bayani", PASSWORD, deps(changed, server("new password 1")).d);
  check("server says wrong: refused even though the verifier matches", !result.ok && result.online && readLocalSession(changed) === null);
  check("...and the verifier is deleted (the password was changed)", readVerifier(changed) === null);
  result = await signIn("bayani", PASSWORD, deps(changed, OFFLINE).d);
  check("...so the old password no longer works offline either", !result.ok && result.code === "NEEDS_PC");

  // A typo answered by the server keeps the verifier.
  const typo = memoryStorage();
  await signIn("bayani", PASSWORD, deps(typo, server()).d);
  await signIn("bayani", "typo typo", deps(typo, server()).d);
  check("server says wrong to a typo: the verifier stays", readVerifier(typo) !== null);

  // Deactivated: the verifier is deleted.
  const inactive = memoryStorage();
  await signIn("bayani", PASSWORD, deps(inactive, server()).d);
  endLocalSession(inactive);
  result = await signIn("bayani", PASSWORD, deps(inactive, { kind: "refused", code: "INACTIVE", message: "This account is deactivated." }).d);
  check("server says deactivated: refused, verifier deleted", !result.ok && readVerifier(inactive) === null);

  // Assigned to another barber: refused online (server) and offline (phone).
  const assigned = memoryStorage();
  await signIn("vince", PASSWORD, deps(assigned, server(), { bound: null }).d);
  endLocalSession(assigned);
  result = await signIn("vince", PASSWORD, deps(assigned, server()).d);
  check("online: a barber other than the binding is refused by the phone", !result.ok && result.code === "PHONE_ASSIGNED" && result.message === "This phone is assigned to Bayani.");
  check("...no session is written", readLocalSession(assigned) === null);
  result = await signIn("vince", PASSWORD, deps(assigned, OFFLINE).d);
  check("offline: the same refusal", !result.ok && result.code === "PHONE_ASSIGNED");
  check("...and it is not counted as a wrong password", readBackoff(assigned).failures === 0);

  // No binding yet: the first online sign-in is allowed (the gate then binds, case 7).
  const fresh = memoryStorage();
  result = await signIn("vince", PASSWORD, deps(fresh, server(), { bound: null }).d);
  check("no binding: the first online sign-in succeeds", result.ok && result.session.barberId === "barber-vince");

  // A phone that never signed in online cannot sign in offline.
  result = await signIn("bayani", PASSWORD, deps(memoryStorage(), OFFLINE).d);
  check("never signed in online: offline sign-in refused (needs the PC once)", !result.ok && result.code === "NEEDS_PC");

  // Owner accounts don't record sales.
  result = await signIn("mart", PASSWORD, deps(memoryStorage(), { kind: "ok", account: OWNER }).d);
  check("an owner account is refused on the POS", !result.ok && result.code === "OWNER_ON_POS");

  // No Web Crypto (plain http): offline sign-in is unavailable, and the phone says so.
  const noCrypto = memoryStorage();
  result = await signIn("bayani", PASSWORD, deps(noCrypto, server(), { subtle: null }).d);
  check("without Web Crypto the online sign-in still works", result.ok && readVerifier(noCrypto) === null);
  endLocalSession(noCrypto);
  result = await signIn("bayani", PASSWORD, deps(noCrypto, OFFLINE, { subtle: null }).d);
  check("...but offline sign-in is refused with its own message", !result.ok && result.code === "NO_CRYPTO");

  // Back-off: after 5 wrong offline tries, even the right password waits.
  const locked = memoryStorage();
  await signIn("bayani", PASSWORD, deps(locked, server()).d);
  endLocalSession(locked);
  const offline = deps(locked, OFFLINE).d;
  for (let i = 0; i < 5; i++) await signIn("bayani", `wrong ${i}xxxx`, offline);
  result = await signIn("bayani", PASSWORD, offline);
  check("5 wrong offline tries: the right password waits too", !result.ok && result.code === "TOO_MANY");
  result = await signIn("bayani", PASSWORD, { ...offline, now: () => new Date(AFTERNOON.getTime() + OFFLINE_FIRST_WAIT_MS) });
  check("after a minute the right password signs in, and the count resets", result.ok && locked.map.get(BACKOFF_KEY) === undefined);
  result = await signIn("bayani", PASSWORD, deps(locked, server()).d);
  check("an online sign-in also clears the count", result.ok && locked.map.get(BACKOFF_KEY) === undefined);

  // Decision 10: the recheck.
  const recheck = memoryStorage();
  await signIn("bayani", PASSWORD, deps(recheck, server()).d);
  check("recheck, network error: session kept", applySessionAnswer({ kind: "unreachable" }, recheck) === "kept" && readLocalSession(recheck) !== null);
  check("recheck, no cookie (offline sign-in): session kept", applySessionAnswer({ kind: "refused", reason: "NONE" }, recheck) === "kept");
  check("recheck, expired cookie: session kept", applySessionAnswer({ kind: "refused", reason: "EXPIRED" }, recheck) === "kept");
  check("recheck, PASSWORD_CHANGED: session ended", applySessionAnswer({ kind: "refused", reason: "PASSWORD_CHANGED" }, recheck) === "ended");
  check("...and the verifier deleted", readLocalSession(recheck) === null && readVerifier(recheck) === null);
  await signIn("bayani", PASSWORD, deps(recheck, server()).d);
  applySessionAnswer({ kind: "refused", reason: "INACTIVE" }, recheck);
  check("recheck, INACTIVE: session ended, verifier deleted", recheck.map.get(SESSION_KEY) === undefined && recheck.map.get(VERIFIER_KEY) === undefined);
}

async function main() {
  await verifierChecks();
  businessDayChecks();
  backoffChecks();
  await signInChecks();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
