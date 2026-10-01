"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, QrCode, RefreshCw, TriangleAlert, X } from "lucide-react";

/**
 * QR Ph (PayMongo test mode) checkout for one sale that is already saved in Dexie.
 * It waits for the sale to sync, asks the server for the QR (idempotent per sale), then shows
 * the server's status. The client never decides payment status; it only displays it.
 */

type Status = "PENDING" | "PAID" | "EXPIRED" | "FAILED";
type Qr = { imageUrl: string; expiresAt: string | null; testUrl: string | null };
type Phase =
  | { kind: "loading"; text: string }
  | { kind: "error"; text: string }
  | { kind: "charge"; status: Status; qr: Qr | null };

const POLL_MS = 3000;

function imageSrc(imageUrl: string) {
  return imageUrl.startsWith("data:") || imageUrl.startsWith("http") ? imageUrl : `data:image/png;base64,${imageUrl}`;
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function QrPhCheckout({
  transactionId,
  amount,
  ensureSynced,
  onClose,
}: {
  transactionId: string;
  amount: number;
  /** Syncs the queue and resolves true once this sale is on the server. */
  ensureSynced: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading", text: "Syncing sale…" });
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [checking, setChecking] = useState(false);

  // Sync, then create (or fetch the existing) charge. "Try again" re-runs this for the same
  // sale; the server returns the same intent, never a second one.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!(await ensureSynced())) {
        if (active) setPhase({ kind: "error", text: "This sale hasn't reached the server yet, so it can't be charged by QR. Try again when online." });
        return;
      }
      if (active) setPhase({ kind: "loading", text: "Creating QR…" });
      try {
        const res = await fetch("/api/v1/payments/qrph", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionId }),
        });
        const data = await res.json().catch(() => null);
        if (!active) return;
        if (!res.ok || !data?.success) {
          setPhase({ kind: "error", text: data?.error === "Not found" ? "QR Ph is switched off." : "Could not create the QR. Use cash, GCash or Maya." });
          return;
        }
        setPhase({ kind: "charge", status: data.status, qr: data.qr });
      } catch {
        if (active) setPhase({ kind: "error", text: "Could not reach the server. Use cash, GCash or Maya." });
      }
    })();
    return () => { active = false; };
  }, [transactionId, ensureSynced, attempt]);

  const pending = phase.kind === "charge" && phase.status === "PENDING";

  // While pending: tick the countdown and poll the stored status (the webhook updates it).
  useEffect(() => {
    if (!pending) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/payments/qrph/check?transactionId=${transactionId}`, { cache: "no-store" });
        const data = await res.json();
        if (data?.success && data.status !== "PENDING") {
          setPhase((p) => (p.kind === "charge" ? { ...p, status: data.status } : p));
        }
      } catch {
        // Offline for a moment; Check status still works later.
      }
    }, POLL_MS);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [pending, transactionId]);

  // Demo fallback when the webhook tunnel is down: the server asks PayMongo directly.
  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/v1/payments/qrph/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId }),
      });
      const data = await res.json();
      if (data?.success) setPhase((p) => (p.kind === "charge" ? { ...p, status: data.status } : p));
    } catch {
      // Keep the current state; the cashier can press again.
    } finally {
      setChecking(false);
    }
  }, [transactionId]);

  const qr = phase.kind === "charge" ? phase.qr : null;
  const remaining = qr?.expiresAt ? new Date(qr.expiresAt).getTime() - now : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <div className="w-full max-w-sm p-5 rounded-2xl bg-[#12141a] border border-violet-500/40 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-lg flex items-center gap-2 text-violet-200">
            <QrCode className="w-5 h-5" /> QR Ph (test) · ₱{amount.toFixed(2)}
          </h2>
          <button type="button" onClick={onClose} className="p-1 text-zinc-400 hover:text-white" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {phase.kind === "loading" && (
          <p className="flex items-center gap-2 text-sm text-zinc-300"><RefreshCw className="w-4 h-4 animate-spin" /> {phase.text}</p>
        )}

        {phase.kind === "error" && (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-sm text-amber-300"><TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" /> {phase.text}</p>
            <button type="button" onClick={() => { setPhase({ kind: "loading", text: "Syncing sale…" }); setAttempt((a) => a + 1); }} className="w-full py-2 rounded-lg border border-[#232734] text-zinc-200 text-sm">Try again</button>
          </div>
        )}

        {phase.kind === "charge" && phase.status === "PAID" && (
          <p className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-bold">
            <CheckCircle2 className="w-5 h-5" /> Paid
          </p>
        )}

        {phase.kind === "charge" && (phase.status === "EXPIRED" || phase.status === "FAILED") && (
          <p className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
            QR {phase.status === "EXPIRED" ? "expired" : "payment failed"}. This sale stays unpaid. If the customer pays another way, ring a new cash, GCash or Maya sale.
          </p>
        )}

        {pending && (
          <div className="space-y-3">
            {qr ? (
              /* eslint-disable-next-line @next/next/no-img-element -- base64 data URL from PayMongo */
              <img src={imageSrc(qr.imageUrl)} alt="QR Ph code" className="w-full aspect-square rounded-xl bg-white p-2" />
            ) : (
              <p className="text-sm text-zinc-400">Waiting for payment. The QR is no longer shown; press Check status.</p>
            )}
            <p className="p-2.5 rounded-lg bg-red-600/15 border border-red-500/40 text-red-200 text-xs font-semibold">
              TEST MODE. Never scan this QR with a real banking or e-wallet app: PayMongo warns that it processes a real transaction.
            </p>
            {remaining !== null && (
              <p className="text-center text-sm text-zinc-300">Expires in <span className="font-bold">{formatCountdown(remaining)}</span></p>
            )}
            {qr?.testUrl && (
              <a href={qr.testUrl} target="_blank" rel="noreferrer" className="block text-center text-xs text-violet-300 underline">
                Open PayMongo test page to simulate payment
              </a>
            )}
            <button type="button" onClick={checkStatus} disabled={checking} className="w-full py-2.5 rounded-lg bg-violet-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${checking ? "animate-spin" : ""}`} /> Check status
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
