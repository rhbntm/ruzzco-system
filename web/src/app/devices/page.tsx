"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Smartphone } from "lucide-react";
import { BarberPoleIcon } from "@/components/RuzzcoBrand";
import { OwnerSignInPage } from "@/components/OwnerSignIn";

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

  async function revoke(deviceKey: string) {
    if (confirmRevoke !== deviceKey) { setConfirmRevoke(deviceKey); return; }
    setConfirmRevoke(null); setBusy(true); setError(null);
    try {
      const response = await fetch("/api/v1/devices/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceKey }) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { setUnlocked(false); throw new Error("Owner sign-in required."); }
      if (!response.ok || !data.success) throw new Error(data.error ?? "Could not revoke");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not revoke"); setBusy(false); return; }
    await load();
  }

  if (unlocked === null) return <main className="rz-page flex-1" />;

  if (!unlocked) {
    return <OwnerSignInPage title="Approved phones" what="see the approved phones and revoke a lost or replaced one" submitLabel="Unlock" onSignedIn={() => void load()} />;
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
