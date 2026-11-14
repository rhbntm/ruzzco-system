// The phone's network side of staff sign-in (slice 19). The decisions live in lib/local-session.ts;
// this file only turns server answers into LoginAnswer / SessionAnswer. "Unreachable" means the
// request failed or timed out, or the HTTPS gateway answered that the app behind it is down
// (502/504): only then does the phone check the password itself (Decision 9).

import { getOrCreateDeviceKey } from "@/lib/db";
import { REQUEST_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-timeout";
import {
  readLocalSession,
  type KeyValueStorage,
  type LoginAnswer,
  type SessionAnswer,
  type SignedInAccount,
} from "@/lib/local-session";
import { deviceAuthHeaders } from "@/lib/sync";

const GATEWAY_DOWN = new Set([502, 504]);

const LOGIN_CODES = new Set(["WRONG_PASSWORD", "INACTIVE", "PHONE_ASSIGNED", "OWNER_ON_POS", "TOO_MANY", "DEVICE_NOT_APPROVED"]);

/** localStorage, or a stand-in that remembers nothing when it is blocked. */
export function browserStorage(): KeyValueStorage {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // blocked
  }
  return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

/** Web Crypto, which needs a secure context (the HTTPS gateway). Null where it is missing. */
export function browserSubtle(): SubtleCrypto | null {
  return typeof crypto !== "undefined" && crypto.subtle ? crypto.subtle : null;
}

export function browserRandom(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(bytes);
}

function jsonHeaders(): Record<string, string> {
  return deviceAuthHeaders() ?? { "Content-Type": "application/json" };
}

export async function loginOnline(username: string, password: string): Promise<LoginAnswer> {
  let res: Response;
  try {
    res = await fetchWithTimeout("/api/v1/auth/login", {
      method: "POST",
      headers: jsonHeaders(),
      // deviceKey marks a POS sign-in: owners are refused here, barbers checked against the binding.
      body: JSON.stringify({ username, password, deviceKey: getOrCreateDeviceKey() }),
    }, REQUEST_TIMEOUT_MS.signIn);
  } catch {
    return { kind: "unreachable" };
  }
  if (GATEWAY_DOWN.has(res.status)) return { kind: "unreachable" };
  const body = await res.json().catch(() => null);
  if (!body) return res.status === 503 ? { kind: "unreachable" } : { kind: "refused", code: "OTHER", message: `Sign-in failed (HTTP ${res.status}).` };
  if (res.ok && body.success && body.account) return { kind: "ok", account: body.account as SignedInAccount };
  const code = LOGIN_CODES.has(body.code) ? body.code : "OTHER";
  const message = code === "DEVICE_NOT_APPROVED"
    ? "This phone isn't approved yet. Approve it first, then sign in."
    : typeof body.error === "string" ? body.error : `Sign-in failed (HTTP ${res.status}).`;
  return { kind: "refused", code, message };
}

/** Decision 10: asks the server whether the phone's signed-in account still holds. */
export async function checkSessionOnline(storage: KeyValueStorage): Promise<SessionAnswer> {
  const local = readLocalSession(storage);
  const query = local ? `?${new URLSearchParams({ userId: local.userId, passwordChangedAt: local.passwordChangedAt ?? "" })}` : "";
  let res: Response;
  try {
    res = await fetchWithTimeout(`/api/v1/auth/session${query}`, { headers: deviceAuthHeaders() ?? {}, cache: "no-store" }, REQUEST_TIMEOUT_MS.signIn);
  } catch {
    return { kind: "unreachable" };
  }
  if (GATEWAY_DOWN.has(res.status)) return { kind: "unreachable" };
  const body = await res.json().catch(() => null);
  if (res.ok && body?.success && body.account) return { kind: "ok", account: body.account as SignedInAccount };
  if (res.status === 401 && ["NONE", "EXPIRED", "PASSWORD_CHANGED", "INACTIVE"].includes(body?.reason)) {
    return { kind: "refused", reason: body.reason };
  }
  return { kind: "unreachable" };
}

/** Clears the server cookie if the PC answers. Never touches queued sales. */
export async function logoutOnline(): Promise<void> {
  try {
    await fetchWithTimeout("/api/v1/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, REQUEST_TIMEOUT_MS.signIn);
  } catch {
    // Offline: the cookie ends at midnight Manila anyway.
  }
}
