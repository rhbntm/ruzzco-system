"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LockKeyhole, RefreshCw, Smartphone } from "lucide-react";
import { BarberPoleIcon, MustacheIcon } from "@/components/RuzzcoBrand";

// Owner-only (slice 15): the phones approved to send sales. A lost or replaced phone is revoked
// here; its secret stops working at once and the sales it still holds wait until it is approved
// again (on the phone, with the approval PIN). There is no reject button and no waiting list:
// an unapproved phone writes nothing to the server.

type Device = {
  deviceKey: string;
  label: string | null;
  approvedAt: string;
  approvedWith: "OWNER" | "APPROVER";
  revokedAt: string | null;
  lastSeenAt: string | null;
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "never";

export default function DevicesPage() {
  const [pin, setPin] = useState("");
  // null while the first load decides whether the owner cookie is there.
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/v1/devices", { cache: "no-store" });
      if (response.status === 401) { setUnlocked(false); return; }
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error ?? "Could not load phones");
      setDevices(data.devices);
      setUnlocked(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load phones"); setUnlocked((u) => u ?? false); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function unlock() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/v1/owner/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error ?? "Invalid owner PIN");
      setPin("");
    } catch (err) { setError(err instanceof Error ? err.message : "Unlock failed"); setBusy(false); return; }
    await load();
  }

  async function revoke(deviceKey: string) {
    if (confirmRevoke !== deviceKey) { setConfirmRevoke(deviceKey); return; }
    setConfirmRevoke(null); setBusy(true); setError(null);
    try {
      const response = await fetch("/api/v1/devices/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceKey }) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { setUnlocked(false); throw new Error("Owner PIN required."); }
      if (!response.ok || !data.success) throw new Error(data.error ?? "Could not revoke");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not revoke"); setBusy(false); return; }
    await load();
  }

  if (unlocked === null) return <main className="rz-page flex-1" />;

  if (!unlocked) {
    return (
      <main className="rz-page flex-1 flex items-center justify-center p-4 sm:p-6">
        <form onSubmit={(event) => { event.preventDefault(); void unlock(); }} className="animate-pop rz-panel w-full max-w-sm p-6 sm:p-7 space-y-5">
          <div className="flex flex-col items-center text-center gap-3">
            <span aria-hidden="true" className="w-14 h-14 rounded-full bg-brass/10 ring-1 ring-brass/45 text-brass-bright flex items-center justify-center">
              <LockKeyhole className="w-6 h-6" />
            </span>
            <h1 className="rz-title text-3xl">Approved phones</h1>
            <p className="text-sm text-dust leading-relaxed">Enter the owner PIN to see the approved phones and revoke a lost or replaced one.</p>
          </div>
          <div className="rz-ornament" aria-hidden="true"><MustacheIcon className="w-8 h-3 text-brass" /></div>
          <input autoFocus type="password" inputMode="numeric" aria-label="Owner PIN" value={pin} onChange={(event) => setPin(event.target.value)} className="rz-field min-h-12 text-center text-lg tracking-[0.4em] placeholder:text-base placeholder:tracking-normal" placeholder="Owner PIN" />
          <button disabled={busy || !pin} className="rz-btn rz-btn-primary w-full min-h-12">{busy ? "Checking…" : "Unlock"}</button>
          {error && <p role="alert" className="animate-rise rz-notice rz-notice-danger">{error}</p>}
          <Link href="/" className="block py-2 pointer-coarse:py-3.5 text-center text-sm text-dust hover:text-bone transition-colors">Back to home</Link>
        </form>
      </main>
    );
  }

  const active = devices.filter((d) => !d.revokedAt);
  const revoked = devices.filter((d) => d.revokedAt);

  return (
    <main className="flex-1">
      <header className="rz-banner">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 py-3">
          <Link href="/" className="inline-flex items-center gap-1.5 -my-2 py-2 pointer-coarse:-my-3.5 pointer-coarse:py-3.5 text-sm text-dust hover:text-bone transition-colors group"><ArrowLeft className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-0.5" />Home</Link>
          <h1 className="flex items-center gap-2 font-display font-semibold text-base sm:text-lg leading-none uppercase tracking-widest text-bone">
            <BarberPoleIcon className="w-2.5 h-6" spinning={busy} />
            Approved phones
          </h1>
          <button onClick={() => void load()} title="Reload" aria-label="Reload the phones" className="rz-btn rz-btn-ghost rz-btn-icon -my-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11"><RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /></button>
        </div>
      </header>

      <div className="rz-page max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        <p className="text-sm text-dust leading-relaxed">
          A phone is approved on the phone itself, with the approval PIN (Bayani) or the owner PIN. Revoke a lost or replaced
          phone: it stops sending sales at once, and the sales it still holds wait until it is approved again.
        </p>
        {error && <p role="alert" className="rz-notice rz-notice-danger">{error}</p>}

        {active.length === 0 ? (
          <p className="rz-notice">No phone is approved yet.</p>
        ) : (
          <ul className="rz-panel divide-y divide-white/8 overflow-hidden">
            {active.map((d) => (
              <li key={d.deviceKey} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 font-semibold text-bone">
                    <Smartphone className="w-4 h-4 text-brass shrink-0" />
                    <span className="truncate">{d.label ?? "Unnamed phone"}</span>
                  </div>
                  <div className="text-xs text-dust">
                    Approved {when(d.approvedAt)} with the {d.approvedWith === "OWNER" ? "owner PIN" : "approval PIN"} · last seen {when(d.lastSeenAt)}
                  </div>
                  <div className="text-xs text-dust/70 font-mono truncate">{d.deviceKey}</div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void revoke(d.deviceKey)}
                  className={`rz-btn ${confirmRevoke === d.deviceKey ? "rz-btn-primary" : "rz-btn-secondary"} text-sm pointer-coarse:min-h-11`}
                >
                  {confirmRevoke === d.deviceKey ? "Tap again to revoke" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        )}

        {revoked.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-dust">Revoked</h2>
            <ul className="rz-panel divide-y divide-white/8 overflow-hidden opacity-75">
              {revoked.map((d) => (
                <li key={d.deviceKey} className="p-4 text-sm space-y-0.5">
                  <div className="font-semibold text-bone">{d.label ?? "Unnamed phone"}</div>
                  <div className="text-xs text-dust">Revoked {when(d.revokedAt)} · last seen {when(d.lastSeenAt)}</div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
