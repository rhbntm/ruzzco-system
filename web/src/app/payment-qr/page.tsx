"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ImageOff, LockKeyhole, RefreshCw, Trash2, Upload } from "lucide-react";
import { BarberPoleIcon, MustacheIcon } from "@/components/RuzzcoBrand";

// Owner-only: attach a GCash and a Maya QR image to each active barber (slice 6).
// The POS shows the QR of the barber a sale is attributed to. The server re-checks
// everything; the checks here only give quick feedback.

type Method = "GCASH" | "MAYA";
type Barber = { id: string; fullName: string };
type QrInfo = { barberId: string; method: Method; sha256: string; contentType: string; updatedAt: string };

const METHODS: { method: Method; label: string; accent: string }[] = [
  { method: "GCASH", label: "GCash", accent: "text-gcash-ink" },
  { method: "MAYA", label: "Maya", accent: "text-maya-ink" },
];
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 1024 * 1024;
const slotKey = (barberId: string, method: Method) => `${barberId}:${method}`;
const qrUrl = (barberId: string, method: Method) => `/api/v1/payment-qrs/${encodeURIComponent(barberId)}/${method}`;
// Success messages end in a "✓" glyph; the page draws a real check icon instead.
const withoutTick = (text: string) => text.replace(/\s*✓$/, "");

export default function PaymentQrPage() {
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [qrs, setQrs] = useState<Record<string, QrInfo>>({});
  // Per-slot state, so one barber's upload never disables another's buttons.
  const [workingSlot, setWorkingSlot] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [slotMessage, setSlotMessage] = useState<{ key: string; text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [catalogRes, qrRes] = await Promise.all([fetch("/api/v1/catalog", { cache: "no-store" }), fetch("/api/v1/payment-qrs", { cache: "no-store" })]);
      const catalog = await catalogRes.json();
      const list = await qrRes.json();
      if (!catalogRes.ok || !catalog.success) throw new Error(catalog.error ?? "Could not load barbers");
      if (!qrRes.ok || !list.success) throw new Error(list.error ?? "Could not load QRs");
      setBarbers(catalog.barbers);
      setQrs(Object.fromEntries((list.qrs as QrInfo[]).map((q) => [slotKey(q.barberId, q.method), q])));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load QRs"); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [unlocked, load]);

  async function unlock() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/v1/owner/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error ?? "Invalid owner PIN");
      setPin(""); setUnlocked(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Unlock failed"); }
    finally { setBusy(false); }
  }

  function showSlotMessage(key: string, text: string, ok: boolean) {
    setSlotMessage({ key, text, ok });
    window.setTimeout(() => setSlotMessage((current) => (current?.key === key ? null : current)), 3000);
  }

  async function upload(barberId: string, method: Method, file: File) {
    const key = slotKey(barberId, method);
    if (!ACCEPTED.includes(file.type)) return showSlotMessage(key, "Use a PNG, JPEG or WebP image.", false);
    if (file.size > MAX_BYTES) return showSlotMessage(key, "Image is larger than 1 MB.", false);
    setWorkingSlot(key); setConfirmRemove(null);
    try {
      const response = await fetch(qrUrl(barberId, method), { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { setUnlocked(false); throw new Error("Owner PIN required."); }
      if (!response.ok || !data.success) throw new Error(data.error ?? "Upload failed");
      setQrs((current) => ({ ...current, [key]: data.qr as QrInfo }));
      showSlotMessage(key, "Saved ✓", true);
    } catch (err) { showSlotMessage(key, err instanceof Error ? err.message : "Upload failed", false); }
    finally { setWorkingSlot(null); }
  }

  async function remove(barberId: string, method: Method) {
    const key = slotKey(barberId, method);
    if (confirmRemove !== key) { setConfirmRemove(key); return; }
    setConfirmRemove(null); setWorkingSlot(key);
    try {
      const response = await fetch(qrUrl(barberId, method), { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { setUnlocked(false); throw new Error("Owner PIN required."); }
      if (!response.ok || !data.success) throw new Error(data.error ?? "Could not remove");
      setQrs((current) => { const next = { ...current }; delete next[key]; return next; });
      showSlotMessage(key, "Removed", true);
    } catch (err) { showSlotMessage(key, err instanceof Error ? err.message : "Could not remove", false); }
    finally { setWorkingSlot(null); }
  }

  if (!unlocked) {
    return (
      <main className="rz-page flex-1 flex items-center justify-center p-4 sm:p-6">
        <form onSubmit={(event) => { event.preventDefault(); void unlock(); }} className="animate-pop rz-panel w-full max-w-sm p-6 sm:p-7 space-y-5">
          <div className="flex flex-col items-center text-center gap-3">
            <span aria-hidden="true" className="w-14 h-14 rounded-full bg-brass/10 ring-1 ring-brass/45 text-brass-bright flex items-center justify-center">
              <LockKeyhole className="w-6 h-6" />
            </span>
            <h1 className="rz-title text-3xl">Payment QR codes</h1>
            <p className="text-sm text-dust leading-relaxed">Enter the owner PIN to add or change the GCash and Maya QR shown for each barber.</p>
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

  return (
    <main className="flex-1">
      <header className="rz-banner">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 py-3">
          <Link href="/" className="inline-flex items-center gap-1.5 -my-2 py-2 pointer-coarse:-my-3.5 pointer-coarse:py-3.5 text-sm text-dust hover:text-bone transition-colors group"><ArrowLeft className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-0.5" />Home</Link>
          <h1 className="flex items-center gap-2 font-display font-semibold text-base sm:text-lg leading-none uppercase tracking-widest text-bone">
            {/* The station light: it turns while the codes load. */}
            <BarberPoleIcon className="w-2.5 h-6" spinning={busy} />
            Payment QR codes
          </h1>
          <button onClick={() => void load()} title="Reload" aria-label="Reload the QR codes" className="rz-btn rz-btn-ghost rz-btn-icon -my-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11"><RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /></button>
        </div>
      </header>

      <div className="rz-page max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
        <p className="text-sm text-dust leading-relaxed max-w-prose">
          The POS shows these in the GCash and Maya payment screen, for the barber the sale is recorded under. PNG, JPEG or WebP, up to 1 MB.
        </p>
        {error && <div role="alert" className="animate-rise rz-notice rz-notice-danger">{error}</div>}
        {/* Announces "Saved", "Removed" and upload errors to screen readers; out of the layout flow. */}
        <p aria-live="polite" className="sr-only">{slotMessage ? withoutTick(slotMessage.text) : ""}</p>

        <div className="space-y-4 rz-stagger">
          {barbers.map((barber) => (
            <section key={barber.id} className="rz-panel p-4 sm:p-5 space-y-4">
              <h2 className="flex items-center gap-3">
                <span aria-hidden="true" className="w-10 h-10 rounded-full bg-panel-2 ring-1 ring-seam-strong flex items-center justify-center font-display font-semibold text-lg text-bone shrink-0">
                  {barber.fullName.charAt(0)}
                </span>
                <span className="rz-title text-xl">{barber.fullName}</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {METHODS.map(({ method, label, accent }) => {
                  const key = slotKey(barber.id, method);
                  const qr = qrs[key];
                  const working = workingSlot === key;
                  const message = slotMessage?.key === key ? slotMessage : null;
                  return (
                    <div key={method} className="rz-well p-3.5 space-y-3">
                      <div className={`text-sm font-semibold ${accent}`}>{label} QR</div>
                      <div className="mx-auto w-40 aspect-square rounded-lg bg-black/30 border border-dashed border-seam-strong flex items-center justify-center overflow-hidden">
                        {qr ? (
                          // eslint-disable-next-line @next/next/no-img-element -- owner-uploaded image served by our API
                          <img src={`${qrUrl(barber.id, method)}?v=${qr.sha256}`} alt={`${label} QR for ${barber.fullName}`} className="animate-fade w-full h-full object-contain bg-white p-1.5" />
                        ) : (
                          <div className="text-center text-xs text-dust space-y-1.5"><ImageOff className="w-5 h-5 mx-auto" /><div>No {label} QR yet</div></div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {/* Crimson only where a QR is still missing; replacing one is the quieter action. */}
                        <label className={`rz-btn ${qr ? "rz-btn-secondary" : "rz-btn-primary"} flex-1 pointer-coarse:min-h-11 ${working ? "opacity-50 pointer-events-none" : ""}`}>
                          <Upload className="w-4 h-4" />{working ? "Saving…" : qr ? "Replace" : "Upload"}
                          <input
                            type="file"
                            accept={ACCEPTED.join(",")}
                            className="sr-only"
                            disabled={working}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = ""; // the same file can be picked again
                              if (file) void upload(barber.id, method, file);
                            }}
                          />
                        </label>
                        {qr && (
                          <button onClick={() => void remove(barber.id, method)} disabled={working} className={`rz-btn pointer-coarse:min-h-11 ${confirmRemove === key ? "rz-btn-danger" : "rz-btn-secondary"}`}>
                            <Trash2 className="w-4 h-4" />{confirmRemove === key ? "Tap again" : "Remove"}
                          </button>
                        )}
                      </div>
                      {message && (
                        <p className={`animate-rise flex items-center gap-1.5 text-xs font-medium ${message.ok ? "text-ok-ink" : "text-crimson-ink"}`}>
                          {message.ok && <Check className="w-3.5 h-3.5 shrink-0" />}
                          {withoutTick(message.text)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {/* While the codes load, the panel's shape instead of a blank page. */}
          {busy && barbers.length === 0 && (
            <div aria-hidden="true" className="rz-panel p-5 space-y-4">
              <div className="rz-skeleton h-6 w-40" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rz-skeleton h-56" />
                <div className="rz-skeleton h-56" />
              </div>
            </div>
          )}
          {!busy && barbers.length === 0 && <div className="rz-panel p-8 text-center text-dust">No active barbers found.</div>}
        </div>
      </div>
    </main>
  );
}
