"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, KeyRound, RefreshCw, Smartphone, Trash2, UserPlus, UserRound } from "lucide-react";
import { OwnerSignInPage } from "@/components/OwnerSignIn";

// Staff (slice 19, Decision 15; one card per barber since the security-staff change): list, create, set or reset a password, deactivate and
// reactivate, and delete a deactivated account (the barber record and sales stay). No password or hash ever reaches this page.

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
// phones: approved = approved phones currently assigned to the barber; revoked = revoked phones last assigned to them (history).
type BarberOption = { id: string; fullName: string; isActive: boolean; accountId: string | null; phones: { approved: number; revoked: number } };

const json = { "Content-Type": "application/json" };
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "never";

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
  const [createFor, setCreateFor] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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

  async function send(url: string, method: "POST" | "PATCH" | "DELETE", payload?: unknown): Promise<string | null> {
    try {
      const res = await fetch(url, { method, headers: json, body: payload === undefined ? undefined : JSON.stringify(payload) });
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

  const presetBarber = barbers.find((b) => b.id === createFor) ?? null;
  const accountOf = (barberId: string) => accounts.find((a) => a.barberId === barberId) ?? null;
  const owners = accounts.filter((a) => a.role === "OWNER");
  // A working login has a username and a password; older records may have neither.
  const readyOwners = owners.filter((a) => a.username && a.hasPassword);
  const incompleteOwners = owners.filter((a) => !(a.username && a.hasPassword));
  const others = accounts.filter((a) => a.role !== "OWNER" && a.role !== "BARBER");

  function startCreate(barberId: string) {
    setCreateFor(barberId);
    setShowCreate(true);
    window.setTimeout(() => document.getElementById("create-account-title")?.scrollIntoView({ block: "center" }), 0);
  }

  // Delete is offered only once the account is deactivated; the server enforces that too.
  async function deleteAccount(account: Account) {
    if (confirmDelete !== account.id) { setConfirmDelete(account.id); return; }
    setConfirmDelete(null); setError(null); setNotice(null);
    const problem = await send(`/api/v1/users/${account.id}`, "DELETE");
    if (problem) setError(problem);
    else setNotice(`${account.name}'s account was deleted.`);
    await load();
  }

  // One account's actions (password, deactivate, delete), shared by the barber cards and the owner lists.
  function accountActions(account: Account) {
    if (account.role === "CASHIER") return null;
    return (
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
          <>
            <button type="button" disabled={busy} onClick={() => void setActive(account, true)} className="rz-btn rz-btn-secondary text-sm pointer-coarse:min-h-11">Reactivate</button>
            <button type="button" disabled={busy} onClick={() => void deleteAccount(account)} className={`rz-btn ${confirmDelete === account.id ? "rz-btn-primary" : "rz-btn-secondary"} text-sm pointer-coarse:min-h-11`}>
              <Trash2 className="w-4 h-4" />
              {confirmDelete === account.id ? "Tap again to delete" : "Delete"}
            </button>
          </>
        )}
        {confirmDelete === account.id && (
          <p role="alert" className="basis-full text-xs text-bone-2 leading-relaxed max-w-prose">
            This permanently removes the login. The barber, sales, payouts and phones stay; its sales only lose the link to this login. This can&apos;t be undone.
            <button type="button" onClick={() => setConfirmDelete(null)} className="ml-2 underline rounded-sm hover:text-bone pointer-coarse:py-3">Cancel</button>
          </p>
        )}
      </div>
    );
  }

  function passwordForm(account: Account) {
    if (editing !== account.id) return null;
    return (
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
    );
  }

  const loadingRow = (
    <li role="status" className="p-4"><span className="sr-only">Loading the accounts…</span><div aria-hidden="true" className="rz-skeleton h-5 w-2/3" /></li>
  );

  const ownerRow = (account: Account, incomplete: boolean) => (
    <li key={account.id} className={`p-4 space-y-3 ${incomplete ? "bg-well" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2 font-semibold text-bone">
            <UserRound className="w-4 h-4 text-brass shrink-0" />
            <span className="truncate">{account.name}</span>
            {incomplete && <span className="rz-pill text-xs">Incomplete record</span>}
            {!account.isActive && <span className="rz-pill text-xs">Deactivated</span>}
          </div>
          <div className="text-xs text-dust break-words">
            {incomplete
              ? <>Not a working login: {!account.username ? "no username" : "no password"}{!account.username && !account.hasPassword ? " and no password" : ""} yet.</>
              : <>Username <span className="font-mono text-bone-2">{account.username}</span> · Password set · Last sign-in {when(account.lastSignInAt)}</>}
          </div>
        </div>
        {accountActions(account)}
      </div>
      {passwordForm(account)}
    </li>
  );

  return (
    <main className="flex-1">
      <div className="rz-page max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-6">
        <header className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="rz-title text-3xl">Staff accounts</h1>
            <p className="text-sm text-dust max-w-prose leading-relaxed">Sign-in accounts for each barber and the owner. Phones are managed under Phones.</p>
          </div>
          <button onClick={() => void load()} title="Reload" aria-label="Reload the accounts" className="rz-btn rz-btn-ghost rz-btn-icon shrink-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11"><RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /></button>
        </header>

        <details className="rz-panel group">
          <summary className="cursor-pointer select-none px-4 min-h-11 flex items-center justify-between gap-2 text-sm font-semibold text-bone rounded-[inherit]">
            How sign-in and phones interact
            <ChevronDown className="w-4 h-4 text-dust transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="px-4 pb-4 space-y-2 text-sm text-dust leading-relaxed max-w-prose">
            <p>
              Each barber signs in on their own phone with their own account; the owner signs in here on the shop PC. Once an owner
              account exists, the owner PIN no longer opens owner pages, but it still approves phones and moves a phone to another barber.
            </p>
            <p>
              Resetting a password or deactivating an account ends that account&apos;s sessions on this PC. It does not revoke the phone&apos;s
              approval and does not clear the phone&apos;s barber assignment; to stop a phone, revoke it under{" "}
              <Link href="/devices" className="underline rounded-sm hover:text-bone">Phones</Link>. A phone that is offline keeps the old
              password until it next reaches this PC. Sales queued on a phone sync with that phone&apos;s approval, not with the barber&apos;s
              sign-in, so they still sync after a reset or deactivation unless the phone is revoked.
            </p>
            <p>Approving a phone again replaces its secret and ends its barber assignment; the phone is bound to a barber again at its next online sign-in.</p>
          </div>
        </details>
        {error && <p role="alert" className="rz-notice rz-notice-danger">{error}</p>}
        {notice && <p role="status" className="rz-notice">{notice}</p>}

        <section className="space-y-3" aria-labelledby="barbers-title">
          <h2 id="barbers-title" className="rz-title text-xl">Barbers</h2>
          {barbers.length === 0 ? (
            <ul className="rz-panel divide-y divide-seam overflow-hidden">{busy ? loadingRow : <li className="p-4 text-sm text-dust">No barbers yet.</li>}</ul>
          ) : (
            <ul className="space-y-3">
              {barbers.map((barber) => {
                const account = accountOf(barber.id);
                const { approved, revoked } = barber.phones;
                return (
                  <li key={barber.id} className="rz-panel p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2 font-semibold text-bone">
                          <UserRound className="w-4 h-4 text-brass shrink-0" />
                          <span className="truncate">{barber.fullName}</span>
                          {!barber.isActive && <span className="rz-pill text-xs">Inactive barber</span>}
                          {account && !account.isActive && <span className="rz-pill text-xs">Account deactivated</span>}
                        </div>
                        {account ? (
                          <div className="text-xs text-dust break-words">
                            {account.username ? <>Username <span className="font-mono text-bone-2">{account.username}</span></> : "No username yet"}
                            {" · "}{account.hasPassword ? "Password set" : "No password yet"} · Last sign-in {when(account.lastSignInAt)}
                          </div>
                        ) : (
                          <div className="text-xs text-dust">No account yet</div>
                        )}
                      </div>
                      {account ? accountActions(account) : barber.isActive && (
                        <button type="button" disabled={busy} onClick={() => startCreate(barber.id)} className="rz-btn rz-btn-secondary text-sm pointer-coarse:min-h-11">
                          <UserPlus className="w-4 h-4" />
                          Create account
                        </button>
                      )}
                    </div>
                    {account && passwordForm(account)}
                    <div className="flex flex-wrap items-center justify-between gap-x-3 border-t border-seam pt-2.5 text-xs text-dust">
                      <span title="Approved phones currently assigned to this barber. Revoked phones are history only, not in use.">
                        <Smartphone className="w-3.5 h-3.5 inline -mt-0.5 mr-1" aria-hidden="true" />
                        Phones: {approved === 0 ? "no approved phone" : `${approved} approved`}
                        {revoked > 0 && ` · ${revoked} revoked (history)`}
                      </span>
                      <Link href={`/devices?barber=${encodeURIComponent(barber.id)}`} className="inline-flex items-center min-h-8 font-semibold text-brass-bright hover:text-bone rounded-sm pointer-coarse:min-h-11">
                        View phones
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="owners-title">
          <h2 id="owners-title" className="rz-title text-xl">Owner accounts</h2>
          <ul className="rz-panel divide-y divide-seam overflow-hidden">
            {readyOwners.length === 0 && (busy ? loadingRow : <li className="p-4 text-sm text-dust">No working owner account yet. The owner PIN opens owner pages until one is set up.</li>)}
            {readyOwners.map((account) => ownerRow(account, false))}
          </ul>
          {incompleteOwners.length > 0 && (
            <div className="space-y-2">
              <h3 className="rz-label">Incomplete records ({incompleteOwners.length})</h3>
              <p className="text-xs text-dust max-w-prose">Older records with no username or password. They can&apos;t sign in. Set a password to turn one into a login.</p>
              <ul className="rz-panel divide-y divide-seam overflow-hidden">{incompleteOwners.map((account) => ownerRow(account, true))}</ul>
            </div>
          )}
        </section>

        {others.length > 0 && (
          <section className="space-y-3" aria-labelledby="other-title">
            <h2 id="other-title" className="rz-title text-xl">Other accounts</h2>
            <ul className="rz-panel divide-y divide-seam overflow-hidden">
              {others.map((account) => (
                <li key={account.id} className="p-4 text-sm text-bone">
                  {account.name} <span className="rz-pill text-xs">{account.isActive ? "Active" : "Deactivated"}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {showCreate ? (
          <CreateAccount
            key={createFor ?? "none"}
            presetBarber={presetBarber}
            onCancel={() => { setShowCreate(false); setCreateFor(null); }}
            onCreate={async (payload) => {
              const problem = await send("/api/v1/users", "POST", payload);
              if (problem) return problem;
              setShowCreate(false);
              setCreateFor(null);
              setNotice("Account created.");
              await load();
              return null;
            }}
          />
        ) : (
          <button type="button" onClick={() => setShowCreate(true)} className="rz-btn rz-btn-secondary w-full min-h-11">
            <UserPlus className="w-4 h-4" />
            New account
          </button>
        )}
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

function CreateAccount({ presetBarber, onCreate, onCancel }: {
  // Set by "Create account" on a barber's card: an account for that existing barber, no rate to enter.
  presetBarber: BarberOption | null;
  onCancel: () => void;
  onCreate: (payload: Record<string, string | number>) => Promise<string | null>;
}) {
  const [role, setRole] = useState<"BARBER" | "OWNER">("BARBER");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rate, setRate] = useState("50");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Like an owner account, a new barber is made from a name (and the stated commission rate).
  const existing = role === "BARBER" ? presetBarber : null;
  const needsName = !existing;
  const rateNumber = Number(rate);
  const rateOk = rate.trim() !== "" && Number.isFinite(rateNumber) && rateNumber >= 0 && rateNumber <= 100 && Math.abs(Math.round(rateNumber * 100) / 100 - rateNumber) < 1e-9;
  const newBarber = role === "BARBER" && !existing;

  const ready =
    username.trim().length >= 3 && password.length >= 8 &&
    (existing ? true : name.trim().length > 0 && (role === "OWNER" || rateOk));

  return (
    <section className="rz-panel p-4 sm:p-5 space-y-4" aria-labelledby="create-account-title">
      <h2 id="create-account-title" className="flex items-center gap-2 rz-title text-xl"><UserPlus className="w-5 h-5 text-brass" />New account</h2>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true); setError(null);
          const payload: Record<string, string | number> = { role, username, password };
          if (existing) payload.barberId = existing.id;
          if (newBarber) payload.commissionRate = Math.round(rateNumber * 100) / 100 / 100; // a stated percentage, as a fraction
          if (needsName && name.trim()) payload.name = name.trim();
          const problem = await onCreate(payload);
          setSaving(false);
          if (problem) { setError(problem); return; }
          setName(""); setUsername(""); setPassword(""); setRate("50");
        }}
      >
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Role">
          {(["BARBER", "OWNER"] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={role === value} onClick={() => setRole(value)} className={`rz-btn ${role === value ? "rz-btn-primary" : "rz-btn-secondary"} min-h-11`}>
              {value === "BARBER" ? "Barber" : "Owner"}
            </button>
          ))}
        </div>
        {existing && (
          <p className="text-sm text-bone-2">Account for <span className="font-semibold text-bone">{existing.fullName}</span>, an existing barber.</p>
        )}
        {needsName && (
          <label className="block space-y-1.5">
            <span className="rz-field-label">{role === "OWNER" ? "Name" : "Barber's full name"}</span>
            <input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} className="rz-field min-h-11 w-full" />
          </label>
        )}
        {newBarber && (
          <label className="block space-y-1.5">
            <span className="rz-field-label">Commission rate (%). The shop&apos;s usual split is 50</span>
            <input type="number" inputMode="decimal" min={0} max={100} step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} aria-invalid={!rateOk} className="rz-field min-h-11 w-full" />
            {!rateOk && <span className="block text-xs text-dust">Enter a percentage from 0 to 100.</span>}
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
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={saving} className="rz-btn rz-btn-secondary flex-1 min-h-12">Cancel</button>
          <button disabled={saving || !ready} className="rz-btn rz-btn-primary flex-[2] min-h-12">{saving ? "Creating…" : "Create account"}</button>
        </div>
      </form>
    </section>
  );
}
