"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, RefreshCw, UserPlus, UserRound } from "lucide-react";
import { BarberPoleIcon } from "@/components/RuzzcoBrand";
import { OwnerSignInPage } from "@/components/OwnerSignIn";

// Staff accounts (slice 19, Decision 15): list, create, set or reset a password, deactivate and
// reactivate. Accounts are never deleted, and no password or hash ever reaches this page.

type Account = {
  id: string;
  name: string;
  username: string | null;
  role: "OWNER" | "BARBER" | "CASHIER";
  barberId: string | null;
  barberName: string | null;
  barberActive: boolean | null;
  isActive: boolean;
  hasPassword: boolean;
  lastSignInAt: string | null;
};
type BarberOption = { id: string; fullName: string; isActive: boolean; accountId: string | null };

const json = { "Content-Type": "application/json" };
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "never";

export function StaffAccounts({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  if (!isOwner) {
    return <OwnerSignInPage title="Staff accounts" what="manage staff accounts" submitLabel="Unlock" onSignedIn={() => router.refresh()} />;
  }
  return <StaffAccountsList />;
}

function StaffAccountsList() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [barbers, setBarbers] = useState<BarberOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(null);

  // Signed out meanwhile (a password reset, Lock, or the first owner account ended the PIN session).
  const handle401 = useCallback((status: number) => {
    if (status === 401) router.refresh();
    return status === 401;
  }, [router]);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/v1/users", { cache: "no-store" });
      if (handle401(res.status)) return;
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? "Could not load accounts");
      setAccounts(body.users);
      setBarbers(body.barbers);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load accounts"); }
    finally { setBusy(false); }
  }, [handle401]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function send(url: string, method: "POST" | "PATCH", payload: unknown): Promise<string | null> {
    try {
      const res = await fetch(url, { method, headers: json, body: JSON.stringify(payload) });
      if (handle401(res.status)) return "Owner sign-in required.";
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) return body?.error ?? `Failed (HTTP ${res.status})`;
      return null;
    } catch {
      return "Can't reach the server.";
    }
  }

  async function setActive(account: Account, isActive: boolean) {
    if (!isActive && confirmDeactivate !== account.id) { setConfirmDeactivate(account.id); return; }
    setConfirmDeactivate(null); setError(null); setNotice(null);
    const problem = await send(`/api/v1/users/${account.id}`, "PATCH", { isActive });
    if (problem) setError(problem);
    else setNotice(`${account.name} ${isActive ? "reactivated" : "deactivated"}.`);
    await load();
  }

  const freeBarbers = barbers.filter((b) => b.isActive && !b.accountId);

  return (
    <main className="flex-1">
      <header className="rz-banner">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 py-3">
          <Link href="/" className="inline-flex items-center gap-1.5 -my-2 py-2 pointer-coarse:-my-3.5 pointer-coarse:py-3.5 text-sm text-dust hover:text-bone transition-colors group"><ArrowLeft className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-0.5" />Home</Link>
          <h1 className="flex items-center gap-2 font-display font-semibold text-base sm:text-lg leading-none uppercase tracking-widest text-bone">
            <BarberPoleIcon className="w-2.5 h-6" spinning={busy} />
            Staff accounts
          </h1>
          <button onClick={() => void load()} title="Reload" aria-label="Reload the accounts" className="rz-btn rz-btn-ghost rz-btn-icon -my-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11"><RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /></button>
        </div>
      </header>

      <div className="rz-page max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        <p className="text-sm text-dust leading-relaxed">
          Each barber signs in on their own phone with their own account; the owner signs in here on the shop PC. Once an owner
          account exists, the owner PIN no longer opens owner pages, but it still approves phones and moves a phone to another barber.
          Resetting a password ends that account&apos;s sessions; a phone that is offline keeps the old password until it next reaches this PC.
        </p>
        {error && <p role="alert" className="rz-notice rz-notice-danger">{error}</p>}
        {notice && <p role="status" className="rz-notice">{notice}</p>}

        <ul className="rz-panel divide-y divide-white/8 overflow-hidden">
          {accounts.length === 0 && <li className="p-4 text-sm text-dust">No accounts yet.</li>}
          {accounts.map((account) => (
            <li key={account.id} className={`p-4 space-y-3 ${account.isActive ? "" : "opacity-75"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 font-semibold text-bone">
                    <UserRound className="w-4 h-4 text-brass shrink-0" />
                    <span className="truncate">{account.name}</span>
                    <span className="rz-pill text-xs">{account.role === "OWNER" ? "Owner" : account.role === "BARBER" ? "Barber" : "Cashier"}</span>
                    {!account.isActive && <span className="rz-pill text-xs">Deactivated</span>}
                  </div>
                  <div className="text-xs text-dust break-words">
                    {account.username ? <>Username <span className="font-mono text-bone-2">{account.username}</span></> : "No username yet"}
                    {account.role === "BARBER" && <> · barber {account.barberName ?? "?"}{account.barberActive === false ? " (inactive)" : ""}</>}
                    {!account.hasPassword && " · no password yet"}
                  </div>
                  <div className="text-xs text-dust">Last sign-in {when(account.lastSignInAt)}</div>
                </div>
                {account.role !== "CASHIER" && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={() => { setEditing(editing === account.id ? null : account.id); setError(null); setNotice(null); }} className="rz-btn rz-btn-secondary text-sm pointer-coarse:min-h-11">
                      <KeyRound className="w-4 h-4" />
                      {account.hasPassword ? "Reset password" : "Set password"}
                    </button>
                    {account.isActive ? (
                      <button type="button" disabled={busy} onClick={() => void setActive(account, false)} className={`rz-btn ${confirmDeactivate === account.id ? "rz-btn-primary" : "rz-btn-secondary"} text-sm pointer-coarse:min-h-11`}>
                        {confirmDeactivate === account.id ? "Tap again to deactivate" : "Deactivate"}
                      </button>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => void setActive(account, true)} className="rz-btn rz-btn-secondary text-sm pointer-coarse:min-h-11">Reactivate</button>
                    )}
                  </div>
                )}
              </div>
              {editing === account.id && (
                <PasswordForm
                  account={account}
                  onCancel={() => setEditing(null)}
                  onSave={async (payload) => {
                    const problem = await send(`/api/v1/users/${account.id}`, "PATCH", payload);
                    if (problem) return problem;
                    setEditing(null);
                    setNotice(`Password ${account.hasPassword ? "reset" : "set"} for ${account.name}.`);
                    await load();
                    return null;
                  }}
                />
              )}
            </li>
          ))}
        </ul>

        <CreateAccount
          barbers={freeBarbers}
          onCreate={async (payload) => {
            const problem = await send("/api/v1/users", "POST", payload);
            if (problem) return problem;
            setNotice("Account created.");
            await load();
            return null;
          }}
        />
      </div>
    </main>
  );
}

function PasswordForm({ account, onSave, onCancel }: {
  account: Account;
  onSave: (payload: { username?: string; password: string }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const needsUsername = !account.username;

  return (
    <form
      className="rz-panel bg-panel-2 p-3 space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true); setError(null);
        const problem = await onSave(needsUsername ? { username, password } : { password });
        setSaving(false);
        if (problem) setError(problem);
      }}
    >
      {needsUsername && (
        <label className="block space-y-1.5">
          <span className="rz-field-label">Username</span>
          <input autoCapitalize="none" spellCheck={false} autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} className="rz-field min-h-11 w-full" />
        </label>
      )}
      <label className="block space-y-1.5">
        <span className="rz-field-label">New password (at least 8 characters)</span>
        <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="rz-field min-h-11 w-full" />
      </label>
      {error && <p role="alert" className="rz-notice rz-notice-danger text-sm">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="rz-btn rz-btn-secondary flex-1 pointer-coarse:min-h-11">Cancel</button>
        <button type="submit" disabled={saving || password.length < 8 || (needsUsername && !username.trim())} className="rz-btn rz-btn-primary flex-1 pointer-coarse:min-h-11">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function CreateAccount({ barbers, onCreate }: {
  barbers: BarberOption[];
  onCreate: (payload: Record<string, string>) => Promise<string | null>;
}) {
  const [role, setRole] = useState<"BARBER" | "OWNER">("BARBER");
  const [barberId, setBarberId] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const chosenBarber = barbers.some((b) => b.id === barberId) ? barberId : "";

  const ready = username.trim().length >= 3 && password.length >= 8 && (role === "OWNER" ? name.trim().length > 0 : Boolean(chosenBarber));

  return (
    <section className="rz-panel p-4 sm:p-5 space-y-4" aria-labelledby="create-account-title">
      <h2 id="create-account-title" className="flex items-center gap-2 rz-title text-xl"><UserPlus className="w-5 h-5 text-brass" />New account</h2>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true); setError(null);
          const payload: Record<string, string> = { role, username, password };
          if (role === "BARBER") payload.barberId = chosenBarber;
          if (name.trim()) payload.name = name.trim();
          const problem = await onCreate(payload);
          setSaving(false);
          if (problem) { setError(problem); return; }
          setBarberId(""); setName(""); setUsername(""); setPassword("");
        }}
      >
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Role">
          {(["BARBER", "OWNER"] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={role === value} onClick={() => setRole(value)} className={`rz-btn ${role === value ? "rz-btn-primary" : "rz-btn-secondary"} min-h-11`}>
              {value === "BARBER" ? "Barber" : "Owner"}
            </button>
          ))}
        </div>
        {role === "BARBER" ? (
          <label className="block space-y-1.5">
            <span className="rz-field-label">Barber</span>
            <select value={chosenBarber} onChange={(event) => setBarberId(event.target.value)} className="rz-field min-h-11 w-full">
              <option value="">{barbers.length === 0 ? "Every active barber has an account" : "Choose a barber"}</option>
              {barbers.map((b) => <option key={b.id} value={b.id}>{b.fullName}</option>)}
            </select>
          </label>
        ) : (
          <label className="block space-y-1.5">
            <span className="rz-field-label">Name</span>
            <input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} className="rz-field min-h-11 w-full" />
          </label>
        )}
        <label className="block space-y-1.5">
          <span className="rz-field-label">Username (3 to 32: letters, digits, . _ -)</span>
          <input autoCapitalize="none" spellCheck={false} autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} className="rz-field min-h-11 w-full" />
        </label>
        <label className="block space-y-1.5">
          <span className="rz-field-label">Password (at least 8 characters)</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="rz-field min-h-11 w-full" />
        </label>
        {error && <p role="alert" className="rz-notice rz-notice-danger text-sm">{error}</p>}
        <button disabled={saving || !ready} className="rz-btn rz-btn-primary w-full min-h-12">{saving ? "Creating…" : "Create account"}</button>
      </form>
    </section>
  );
}
