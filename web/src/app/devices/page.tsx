"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Smartphone, TriangleAlert } from "lucide-react";
import { OwnerSignInPage } from "@/components/OwnerSignIn";
import { PagedControls } from "@/components/Pager";
import { PageContainer, PageHeader } from "@/components/PageHeader";
import { usePagedList } from "@/lib/use-paged-list";

// Owner-only (slice 15): the phones approved to send sales. A lost or replaced phone is revoked
// here; its secret stops working at once and the sales it still holds wait until it is approved
// again (on the phone, with the approval PIN). There is no reject button and no waiting list:
// an unapproved phone writes nothing to the server.
//
// Each phone is approved + assigned to a barber, approved + not assigned, or revoked. A revoked
// phone's barber is history only: revoking doesn't end its assignment, so its queued sales still
// reach that barber. An assignment with no phone record is shown apart, as a data warning.

type Device = {
  deviceKey: string;
  label: string | null;
  approvedAt: string;
  approvedWith: "OWNER" | "APPROVER";
  revokedAt: string | null;
  lastSeenAt: string | null;
  state: "assigned" | "unassigned" | "revoked";
  barberId: string | null;
};
type Barber = { id: string; fullName: string; isActive: boolean };
type Orphan = { id: string; barberId: string; assignedAt: string };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "never";

export default function DevicesPage() {
  // useSearchParams needs a Suspense boundary for the static shell.
  return (
    <Suspense fallback={null}>
      <Devices />
    </Suspense>
  );
}

// A collapsible section, styled like the disclosure on /staff. The count stays visible when closed.
function Section({ id, title, count, defaultOpen = false, children }: { id: string; title: string; count: number; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details className="rz-panel group" open={defaultOpen} aria-labelledby={id}>
      <summary className="cursor-pointer select-none px-4 min-h-11 flex items-center justify-between gap-2 rounded-[inherit]">
        <span id={id} className="rz-title text-xl">{title} <span className="text-dust font-normal">({count})</span></span>
        <ChevronDown className="w-4 h-4 text-dust transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-seam">{children}</div>
    </details>
  );
}

function Devices() {
  const router = useRouter();
  const barberFilter = useSearchParams().get("barber") ?? "";
  // null while the first load decides whether the owner cookie is there.
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  // Approved phones first (assigned before unassigned); revoked ones have their own list.
  const approved = devices.filter((d) => d.state !== "revoked").sort((a, b) => Number(b.state === "assigned") - Number(a.state === "assigned"));
  // Slice 22, Decision 9: each list has its own pager and kept page size.
  const activeList = usePagedList("devices-approved", approved);
  const revokedList = usePagedList("devices-revoked", devices.filter((d) => d.state === "revoked"));
  const orphanList = usePagedList("devices-orphans", orphans);
  const barberName = (id: string | null) => barbers.find((b) => b.id === id)?.fullName ?? "an unknown barber";

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/v1/devices${barberFilter ? `?barber=${encodeURIComponent(barberFilter)}` : ""}`, { cache: "no-store" });
      if (response.status === 401) { setUnlocked(false); return; }
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error ?? "Could not load phones");
      setDevices(data.devices);
      setBarbers(data.barbers);
      setOrphans(data.orphanAssignments);
      setUnlocked(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load phones"); setUnlocked((u) => u ?? false); }
    finally { setBusy(false); }
  }, [barberFilter]);

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

  if (unlocked === null) {
    return (
      <main className="flex-1">
        <div role="status" className="rz-page max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-3">
          <span className="sr-only">Loading the phones…</span>
          <div aria-hidden="true" className="rz-skeleton h-5 w-2/3" />
          <div aria-hidden="true" className="rz-skeleton h-20" />
        </div>
      </main>
    );
  }

  if (!unlocked) {
    return <OwnerSignInPage title="Phones" what="see the phones and revoke a lost or replaced one" submitLabel="Unlock" onSignedIn={() => void load()} />;
  }

  const assignedCount = approved.filter((d) => d.state === "assigned").length;
  const filteredName = barberFilter ? barbers.find((b) => b.id === barberFilter)?.fullName : null;

  return (
    <PageContainer>
        <PageHeader
          title="Phones"
          description="Which phones may send sales, which barber each is assigned to, and revoking a lost or replaced one."
          onReload={() => void load()}
          reloading={busy}
          reloadLabel="Reload the phones"
        />

        <p className="text-sm text-dust leading-relaxed max-w-prose">
          A phone is approved on the phone itself, with the approval PIN (Bayani) or the owner PIN. Revoking a phone stops it sending sales at
          once, and the sales it still holds wait until it is approved again. A revoked phone keeps its last barber only as history.
        </p>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="block space-y-1.5">
            <span className="rz-field-label">Barber</span>
            <select
              value={barberFilter}
              onChange={(event) => router.replace(event.target.value ? `/devices?barber=${encodeURIComponent(event.target.value)}` : "/devices")}
              className="rz-field min-h-11 min-w-48"
            >
              <option value="">All barbers</option>
              {barbers.map((b) => <option key={b.id} value={b.id}>{b.fullName}{b.isActive ? "" : " (inactive)"}</option>)}
            </select>
          </label>
          <p className="text-sm text-bone-2" role="status">
            {approved.length} approved ({assignedCount} assigned, {approved.length - assignedCount} not assigned) · {revokedList.total} revoked
          </p>
        </div>
        {error && <p role="alert" className="rz-notice rz-notice-danger">{error}</p>}

        <Section id="approved-title" title="Approved phones" count={activeList.total} defaultOpen>
          {activeList.total === 0 ? (
            <p className="p-4 text-sm text-dust">{filteredName ? `No approved phone is assigned to ${filteredName}.` : "No phone is approved yet."}</p>
          ) : (
            <ul className="divide-y divide-seam">
              {activeList.shown.items.map((d) => (
                <li key={d.deviceKey} className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2 font-semibold text-bone">
                      <Smartphone className="w-4 h-4 text-brass shrink-0" />
                      <span className="truncate">{d.label ?? "Unnamed phone"}</span>
                      <span className="rz-pill text-xs">Approved</span>
                    </div>
                    <div className="text-sm text-bone-2">
                      {d.state === "assigned" ? <>Assigned to <span className="font-semibold text-bone">{barberName(d.barberId)}</span></> : "Not assigned to a barber"}
                    </div>
                    <div className="text-xs text-dust">
                      Last seen {when(d.lastSeenAt)} · approved {when(d.approvedAt)} with the {d.approvedWith === "OWNER" ? "owner PIN" : "approval PIN"}
                    </div>
                    <div className="text-xs text-dust-2 font-mono truncate">{d.deviceKey}</div>
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
          {activeList.total > 0 && <div className="p-3 border-t border-seam"><PagedControls list={activeList} label="Approved phones pages" /></div>}
        </Section>

        {revokedList.total > 0 && (
          <Section id="revoked-title" title="Revoked phones" count={revokedList.total}>
            <ul className="divide-y divide-seam">
              {revokedList.shown.items.map((d) => (
                <li key={d.deviceKey} className="p-4 text-sm space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 font-semibold text-bone-2">{d.label ?? "Unnamed phone"}<span className="rz-pill uppercase tracking-wider text-[0.6875rem]">Revoked</span></div>
                  <div className="text-xs text-dust">
                    {d.barberId ? `Last assigned to ${barberName(d.barberId)} (history only, not in use)` : "Never assigned to a barber"}
                  </div>
                  <div className="text-xs text-dust">Revoked {when(d.revokedAt)} · last seen {when(d.lastSeenAt)}</div>
                </li>
              ))}
            </ul>
            <div className="p-3 border-t border-seam"><PagedControls list={revokedList} label="Revoked phones pages" /></div>
          </Section>
        )}

        {orphans.length > 0 && (
          <Section id="orphans-title" title="Assignments without a phone record" count={orphans.length}>
            <p className="rz-notice rz-notice-warn m-3">
              <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <span>These barber assignments point to a phone that has no record here, so they are not phones and are not counted above. Nothing was changed; this is for review.</span>
            </p>
            <ul className="divide-y divide-seam border-t border-seam text-sm">
              {orphanList.shown.items.map((o) => (
                <li key={o.id} className="p-3 flex flex-wrap justify-between gap-x-3 text-bone-2">
                  <span>{barberName(o.barberId)}</span>
                  <span className="text-xs text-dust">assigned {when(o.assignedAt)}</span>
                </li>
              ))}
            </ul>
            <div className="p-3 border-t border-seam"><PagedControls list={orphanList} label="Assignments without a phone record pages" /></div>
          </Section>
        )}
    </PageContainer>
  );
}
