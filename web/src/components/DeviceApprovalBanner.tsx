"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { approveThisDevice, isWaitingForApproval, subscribeApproval } from "@/lib/sync";

/**
 * Shown on /pos and /shift-log while this phone isn't approved (slice 15). Sales are still
 * recorded and kept on the phone; they are sent once Bayani or Mart types the approval PIN
 * here. `onApproved` runs the normal sync right after.
 */
export function DeviceApprovalBanner({ onApproved }: { onApproved?: () => void }) {
  // The server render (and the first client render) never shows it: approval lives in localStorage.
  const waiting = useSyncExternalStore(subscribeApproval, isWaitingForApproval, () => false);
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape closes the dialog, like its Cancel button.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!waiting) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await approveThisDevice(pin, label);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPin("");
    setLabel("");
    setOpen(false);
    onApproved?.();
  }

  return (
    <>
      <div role="status" className="animate-drop rz-notice rz-notice-warn text-sm flex-wrap">
        <TriangleAlert className="w-4.5 h-4.5 text-warn shrink-0 mt-px" />
        <span className="flex-1 min-w-48">
          This phone isn&apos;t approved yet. Sales are saved on this phone and will be sent once Bayani or Mart approves it.
        </span>
        <button
          type="button"
          onClick={() => { setError(null); setOpen(true); }}
          className="rz-btn rz-btn-secondary text-sm pointer-coarse:min-h-11"
        >
          Approve this phone
        </button>
      </div>

      {open && (
        <div className="rz-overlay items-center">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="approve-phone-title"
            onSubmit={(event) => { event.preventDefault(); void submit(); }}
            className="rz-dialog p-5 space-y-4"
          >
            <div className="flex items-center gap-2.5">
              <span aria-hidden="true" className="w-9 h-9 rounded-full bg-brass/10 ring-1 ring-brass/40 text-brass-bright flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </span>
              <h2 id="approve-phone-title" className="rz-title text-xl">Approve this phone</h2>
            </div>
            <p className="text-sm text-dust leading-relaxed">Bayani or Mart: type the approval PIN on this phone.</p>
            <input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="off"
              aria-label="Approval PIN"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              className="rz-field min-h-12 text-center text-lg tracking-[0.4em] placeholder:text-base placeholder:tracking-normal"
              placeholder="Approval PIN"
            />
            <input
              type="text"
              maxLength={60}
              aria-label="Phone name (optional)"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="rz-field min-h-11"
              placeholder="Phone name, e.g. Vince's phone (optional)"
            />
            {error && <p role="alert" className="rz-notice rz-notice-danger text-sm">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rz-btn rz-btn-secondary flex-1 pointer-coarse:min-h-11">Cancel</button>
              <button type="submit" disabled={busy || !pin} className="rz-btn rz-btn-primary flex-1 pointer-coarse:min-h-11">
                {busy ? "Checking…" : "Approve"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
