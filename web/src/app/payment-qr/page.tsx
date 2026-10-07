"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ImageOff, LockKeyhole, RefreshCw, Trash2, Upload } from "lucide-react";

// Owner-only: attach a GCash and a Maya QR image to each active barber (slice 6).
// The POS shows the QR of the barber a sale is attributed to. The server re-checks
// everything; the checks here only give quick feedback.

type Method = "GCASH" | "MAYA";
type Barber = { id: string; fullName: string };
type QrInfo = { barberId: string; method: Method; sha256: string; contentType: string; updatedAt: string };

const METHODS: { method: Method; label: string; accent: string }[] = [
  { method: "GCASH", label: "GCash", accent: "text-blue-300" },
  { method: "MAYA", label: "Maya", accent: "text-emerald-300" },
];
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 1024 * 1024;
const slotKey = (barberId: string, method: Method) => `${barberId}:${method}`;
const qrUrl = (barberId: string, method: Method) => `/api/v1/payment-qrs/${encodeURIComponent(barberId)}/${method}`;

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
      <main className="min-h-screen bg-[#0b0c10] text-zinc-100 flex items-center justify-center p-6">
        <form onSubmit={(event) => { event.preventDefault(); void unlock(); }} className="w-full max-w-sm p-6 rounded-2xl bg-[#12141a] border border-[#232734] space-y-4">
          <LockKeyhole className="w-8 h-8 text-red-400" />
          <h1 className="text-2xl font-bold">Payment QR codes</h1>
          <p className="text-sm text-zinc-400">Enter the owner PIN to add or change the GCash and Maya QR shown for each barber.</p>
          <input autoFocus type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} className="w-full px-3 py-3 rounded-xl bg-[#181b24] border border-[#232734] text-white" placeholder="Owner PIN" />
          <button disabled={busy || !pin} className="w-full py-3 rounded-xl bg-red-600 text-white font-bold disabled:opacity-50">{busy ? "Checking…" : "Unlock"}</button>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <Link href="/" className="block text-center text-xs text-zinc-500 hover:text-white">Back to home</Link>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0b0c10] text-zinc-100">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
        <header className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <Link href="/" className="text-zinc-400 hover:text-white"><ArrowLeft className="w-4 h-4 inline mr-1" />Home</Link>
          <h1 className="text-xl font-bold uppercase tracking-wide">Payment QR codes</h1>
          <button onClick={() => void load()} title="Reload" className="text-zinc-400 hover:text-white"><RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /></button>
        </header>
        <p className="text-sm text-zinc-400">
          The POS shows these in the GCash and Maya payment screen, for the barber the sale is recorded under. PNG, JPEG or WebP, up to 1 MB.
        </p>
        {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300">{error}</div>}

        <div className="space-y-3">
          {barbers.map((barber) => (
            <section key={barber.id} className="p-4 rounded-xl bg-[#12141a] border border-[#232734] space-y-3">
              <h2 className="font-bold text-lg">{barber.fullName}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {METHODS.map(({ method, label, accent }) => {
                  const key = slotKey(barber.id, method);
                  const qr = qrs[key];
                  const working = workingSlot === key;
                  const message = slotMessage?.key === key ? slotMessage : null;
                  return (
                    <div key={method} className="p-3 rounded-lg bg-[#181b24] border border-[#232734] space-y-2.5">
                      <div className={`text-sm font-semibold ${accent}`}>{label} QR</div>
                      <div className="mx-auto w-40 aspect-square rounded-lg bg-white/5 border border-dashed border-[#2c3140] flex items-center justify-center overflow-hidden">
                        {qr ? (
                          // eslint-disable-next-line @next/next/no-img-element -- owner-uploaded image served by our API
                          <img src={`${qrUrl(barber.id, method)}?v=${qr.sha256}`} alt={`${label} QR for ${barber.fullName}`} className="w-full h-full object-contain bg-white p-1.5" />
                        ) : (
                          <div className="text-center text-xs text-zinc-500 space-y-1"><ImageOff className="w-5 h-5 mx-auto" /><div>No {label} QR yet</div></div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <label className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-bold cursor-pointer ${working ? "opacity-50 pointer-events-none" : ""}`}>
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
                          <button onClick={() => void remove(barber.id, method)} disabled={working} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold disabled:opacity-50 ${confirmRemove === key ? "border-red-500 bg-red-500/15 text-red-200" : "border-[#2c3140] text-zinc-300 hover:text-white"}`}>
                            <Trash2 className="w-4 h-4" />{confirmRemove === key ? "Tap again" : "Remove"}
                          </button>
                        )}
                      </div>
                      {message && <p className={`text-xs ${message.ok ? "text-emerald-300" : "text-red-300"}`}>{message.text}</p>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {!busy && barbers.length === 0 && <div className="p-8 text-center text-zinc-500">No active barbers found.</div>}
        </div>
      </div>
    </main>
  );
}
