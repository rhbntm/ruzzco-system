/**
 * "Ask before recording a sale" (slice 13): a per-phone setting in localStorage, never synced.
 * Every read and write is guarded; when storage is unavailable (private mode, blocked site data)
 * the setting is off, which is today's one-tap behaviour.
 */

export const CONFIRM_SETTING_KEY = "ruzzco:ask-before-recording";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readAskBeforeRecording(storage: StorageLike | null = browserStorage()): boolean {
  try {
    return storage?.getItem(CONFIRM_SETTING_KEY) === "on";
  } catch {
    return false;
  }
}

const CHANGE_EVENT = "ruzzco:ask-before-recording";

/** Saves the setting; returns false when the phone could not store it (it then stays off after a reload). */
export function writeAskBeforeRecording(on: boolean, storage: StorageLike | null = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(CONFIRM_SETTING_KEY, on ? "on" : "off");
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** For useSyncExternalStore: this tab's writes and other tabs' (storage event). */
export function subscribeAskBeforeRecording(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * What a payment tap does first. Cash records at once unless the setting is on; GCash and Maya
 * always open their reference step, which then doubles as the confirmation, so a sale is
 * confirmed once, never twice. QR Ph keeps its own checkout.
 */
export type CheckoutStep = "record" | "confirm" | "reference" | "qrph";

export function firstCheckoutStep(method: "CASH" | "GCASH" | "MAYA" | "QRPH", askBeforeRecording: boolean): CheckoutStep {
  if (method === "QRPH") return "qrph";
  if (method === "GCASH" || method === "MAYA") return "reference";
  return askBeforeRecording ? "confirm" : "record";
}
