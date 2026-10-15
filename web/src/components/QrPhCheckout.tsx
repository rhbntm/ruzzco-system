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

  // Escape closes the dialog, like the close button. The charge stays on the server; the shift
  // log's "QR payment" button reopens it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const qr = phase.kind === "charge" ? phase.qr : null;
  const remaining = qr?.expiresAt ? new Date(qr.expiresAt).getTime() - now : null;
  // What a screen reader announces as the payment moves on (the countdown is left out: it ticks every second).
  const announcement = phase.kind === "charge" ? `Payment status: ${phase.status.toLowerCase()}` : phase.text;

  return (
    <div className="rz-overlay items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qrph-checkout-title"
        className="rz-dialog p-5 space-y-4 border-qrph/40"
      >
        <p aria-live="polite" className="sr-only">{announcement}</p>
        <div className="flex items-center justify-between gap-3">
          <h2 id="qrph-checkout-title" className="flex items-center gap-2 font-display font-semibold uppercase tracking-wide text-lg text-qrph-ink">
            <QrCode className="w-5 h-5" /> QR Ph (test) · ₱{amount.toFixed(2)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rz-btn rz-btn-ghost rz-btn-icon pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {phase.kind === "loading" && (
          <p className="animate-fade flex items-center gap-2.5 text-sm text-bone-2"><RefreshCw className="w-4 h-4 animate-spin text-qrph-ink" /> {phase.text}</p>
        )}

        {phase.kind === "error" && (
          <div className="animate-rise space-y-3">
            <p className="rz-notice rz-notice-warn"><TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" /> {phase.text}</p>
            <button type="button" onClick={() => { setPhase({ kind: "loading", text: "Syncing sale…" }); setAttempt((a) => a + 1); }} className="rz-btn rz-btn-secondary w-full pointer-coarse:min-h-11">Try again</button>
          </div>
        )}

        {phase.kind === "charge" && phase.status === "PAID" && (
          <p className="animate-pop rz-notice rz-notice-ok items-center text-base font-bold">
            <CheckCircle2 className="w-5 h-5" /> Paid
          </p>
        )}

        {phase.kind === "charge" && (phase.status === "EXPIRED" || phase.status === "FAILED") && (
          <p className="animate-rise rz-notice rz-notice-danger">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
            QR {phase.status === "EXPIRED" ? "expired" : "payment failed"}. This sale stays unpaid. If the customer pays another way, ring a new cash, GCash or Maya sale.
          </p>
        )}

        {pending && (
          <div className="animate-fade space-y-3">
            {qr ? (
              /* eslint-disable-next-line @next/next/no-img-element -- base64 data URL from PayMongo */
              <img src={imageSrc(qr.imageUrl)} alt="QR Ph code" className="w-full aspect-square rounded-xl bg-white p-2.5 shadow-[0_12px_28px_-14px_rgb(0_0_0/0.9)]" />
            ) : (
              <p className="text-sm text-dust">Waiting for payment. The QR is no longer shown; press Check status.</p>
            )}
            <p className="rz-notice rz-notice-danger text-xs font-semibold">
              TEST MODE. Never scan this QR with a real banking or e-wallet app: PayMongo warns that it processes a real transaction.
            </p>
            {remaining !== null && (
              <p className="text-center text-sm text-bone-2">Expires in <span className="rz-figure text-base text-bone tabular-nums">{formatCountdown(remaining)}</span></p>
            )}
            {qr?.testUrl && (
              <a href={qr.testUrl} target="_blank" rel="noreferrer" className="block text-center text-xs text-qrph-ink underline hover:text-white transition-colors">
                Open PayMongo test page to simulate payment
              </a>
            )}
            <button type="button" onClick={checkStatus} disabled={checking} className="rz-btn w-full min-h-11 bg-[#7c3aed] hover:bg-[#8b4cf2] text-white border-white/10 shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_10px_22px_-12px_rgb(0_0_0/0.9)]">
              <RefreshCw className={`w-4 h-4 ${checking ? "animate-spin" : ""}`} /> Check status
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
