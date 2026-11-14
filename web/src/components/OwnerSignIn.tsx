"use client";

// The owner sign-in (slice 19, Decision 13), shared by every owner page and the /login page:
// username and password once an active owner account exists, the owner PIN until then (so the
// owner can create the first account). The server decides which (`ownerSignIn` on
// GET /api/v1/auth/session); a PIN unlock refused with OWNER_ACCOUNT_EXISTS switches the form.
// Nothing typed here is stored.

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { MustacheIcon } from "@/components/RuzzcoBrand";

type Mode = "ACCOUNT" | "PIN";

const json = { "Content-Type": "application/json" };

/** Signs in with the owner account, or the PIN. Returns an error to show, or null when signed in. */
async function submitOwnerSignIn(mode: Mode, username: string, secret: string): Promise<{ error: string | null; mode?: Mode }> {
  try {
    if (mode === "PIN") {
      const res = await fetch("/api/v1/owner/unlock", { method: "POST", headers: json, body: JSON.stringify({ pin: secret }) });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.success) return { error: null };
      if (res.status === 409 && body?.code === "OWNER_ACCOUNT_EXISTS") return { error: "Sign in with your owner account.", mode: "ACCOUNT" };
      return { error: body?.error ?? "Wrong PIN." };
    }
    const res = await fetch("/api/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username, password: secret }) });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.success) {
      if (body.account?.role === "OWNER") return { error: null };
      await fetch("/api/v1/auth/logout", { method: "POST", headers: json, body: "{}" }).catch(() => {});
      return { error: "Only owner accounts open owner pages." };
    }
    // A barber account without a phone's approval is refused before anything else is said.
    if (body?.code === "DEVICE_NOT_APPROVED") return { error: "Only owner accounts open owner pages." };
    return { error: body?.error ?? `Sign-in failed (HTTP ${res.status}).` };
  } catch {
    return { error: "Can't reach the shop PC." };
  }
}

/**
 * The fields and the submit button. Asks the server which sign-in applies; an owner who is
 * already signed in with the account goes straight through (`onSignedIn`).
 */
function useOwnerSignIn(onSignedIn: () => void) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/auth/session", { cache: "no-store" })
      .then((res) => res.json().catch(() => null))
      .then((body) => {
        if (!active) return;
        if (body?.success && body.account?.role === "OWNER") onSignedIn();
        setMode(body?.ownerSignIn === "PIN" ? "PIN" : "ACCOUNT");
      })
      .catch(() => { if (active) setMode("ACCOUNT"); });
    return () => { active = false; };
    // Asked once per form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = mode === "PIN" ? Boolean(secret) : Boolean(username.trim() && secret);

  async function submit() {
    // Enter or an autofill can submit the form before it is complete: never send an empty PIN.
    if (!mode || !ready || busy) return;
    setBusy(true);
    setError(null);
    const result = await submitOwnerSignIn(mode, username, secret);
    setBusy(false);
    setSecret("");
    if (result.mode) setMode(result.mode);
    if (result.error) setError(result.error);
    else onSignedIn();
  }

  return { mode, username, setUsername, secret, setSecret, busy, error, submit, ready };
}

function Fields({ form, compact = false }: { form: ReturnType<typeof useOwnerSignIn>; compact?: boolean }) {
  const userId = useId();
  if (form.mode === null) return <p role="status" className="text-sm text-dust text-center">Checking…</p>;
  if (form.mode === "PIN") {
    return (
      <input
        autoFocus
        type="password"
        inputMode="numeric"
        autoComplete="off"
        aria-label="Owner PIN"
        value={form.secret}
        onChange={(event) => form.setSecret(event.target.value)}
        className={compact ? "rz-field flex-1 sm:text-sm pointer-coarse:min-h-11" : "rz-field min-h-12 w-full text-center text-lg tracking-[0.4em] placeholder:text-base placeholder:tracking-normal"}
        placeholder="Owner PIN"
      />
    );
  }
  return (
    <div className={compact ? "flex flex-col sm:flex-row gap-2 flex-1" : "space-y-3"}>
      <input
        autoFocus
        id={userId}
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        aria-label="Owner username"
        value={form.username}
        onChange={(event) => form.setUsername(event.target.value)}
        className={compact ? "rz-field flex-1 sm:text-sm pointer-coarse:min-h-11" : "rz-field min-h-12 w-full"}
        placeholder="Username"
      />
      <input
        type="password"
        name="password"
        autoComplete="current-password"
        aria-label="Password"
        value={form.secret}
        onChange={(event) => form.setSecret(event.target.value)}
        className={compact ? "rz-field flex-1 sm:text-sm pointer-coarse:min-h-11" : "rz-field min-h-12 w-full"}
        placeholder="Password"
      />
    </div>
  );
}

const promptFor = (mode: Mode | null, what: string) =>
  mode === "PIN" ? `Enter the owner PIN to ${what}.` : `Sign in with the owner account to ${what}.`;

/** A whole page: what /ledger, /devices, /payment-qr and /login show until the owner signs in. */
export function OwnerSignInPage({ title, what, submitLabel, onSignedIn }: {
  title: string;
  /** Finishes "Sign in with the owner account to …". */
  what: string;
  submitLabel: string;
  onSignedIn: () => void;
}) {
  const form = useOwnerSignIn(onSignedIn);
  return (
    <main className="rz-page flex-1 flex items-center justify-center p-4 sm:p-6">
      <form onSubmit={(event) => { event.preventDefault(); void form.submit(); }} className="animate-pop rz-panel w-full max-w-sm p-6 sm:p-7 space-y-5">
        <div className="flex flex-col items-center text-center gap-3">
          <span aria-hidden="true" className="w-14 h-14 rounded-full bg-brass/10 ring-1 ring-brass/45 text-brass-bright flex items-center justify-center">
            <LockKeyhole className="w-6 h-6" />
          </span>
          <h1 className="rz-title text-3xl">{title}</h1>
          <p className="text-sm text-dust leading-relaxed">{promptFor(form.mode, what)}</p>
        </div>
        <div className="rz-ornament" aria-hidden="true"><MustacheIcon className="w-8 h-3 text-brass" /></div>
        <Fields form={form} />
        <button disabled={form.busy || !form.ready} className="rz-btn rz-btn-primary w-full min-h-12">
          {form.busy ? "Checking…" : submitLabel}
        </button>
        {form.error && <p role="alert" className="animate-rise rz-notice rz-notice-danger">{form.error}</p>}
        <Link href="/" className="block py-2 pointer-coarse:py-3.5 text-center text-sm text-dust hover:text-bone transition-colors">Back to home</Link>
      </form>
    </main>
  );
}

/** A dialog over the page (End-of-Day Cash). */
export function OwnerSignInDialog({ what, submitLabel = "Sign in", onSignedIn, onCancel }: {
  what: string;
  submitLabel?: string;
  onSignedIn: () => void;
  onCancel: () => void;
}) {
  const form = useOwnerSignIn(onSignedIn);
  const titleId = useId();

  // Escape closes the dialog, like its Cancel button.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !form.busy) onCancel(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [form.busy, onCancel]);

  return (
    <div className="rz-overlay items-center">
      <form role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={(event) => { event.preventDefault(); void form.submit(); }} className="rz-dialog p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="w-9 h-9 rounded-full bg-brass/10 ring-1 ring-brass/40 text-brass-bright flex items-center justify-center shrink-0">
            <LockKeyhole className="w-4 h-4" />
          </span>
          <h2 id={titleId} className="rz-title text-xl">Owner sign-in</h2>
        </div>
        <p className="text-sm text-dust leading-relaxed">{promptFor(form.mode, what)}</p>
        <Fields form={form} />
        {form.error && <p role="alert" className="rz-notice rz-notice-danger text-sm">{form.error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={form.busy} className="rz-btn rz-btn-secondary flex-1 pointer-coarse:min-h-11">Cancel</button>
          <button type="submit" disabled={form.busy || !form.ready} className="rz-btn rz-btn-primary flex-1 pointer-coarse:min-h-11">
            {form.busy ? "Checking…" : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

/** One row inside a panel (the forecast panel on the home page and /insights). */
export function OwnerSignInInline({ submitLabel, onSignedIn }: { submitLabel: string; onSignedIn: () => void }) {
  const form = useOwnerSignIn(onSignedIn);
  return (
    <>
      <form onSubmit={(event) => { event.preventDefault(); void form.submit(); }} className="animate-rise flex flex-col sm:flex-row gap-2">
        <Fields form={form} compact />
        <button disabled={form.busy || !form.ready} className="rz-btn rz-btn-primary px-5 pointer-coarse:min-h-11">
          {form.busy ? "Checking…" : submitLabel}
        </button>
      </form>
      {form.error && <p className="animate-rise text-sm text-crimson-ink">{form.error}</p>}
    </>
  );
}
