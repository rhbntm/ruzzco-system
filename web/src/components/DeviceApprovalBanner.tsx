"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { approveThisDevice, isWaitingForApproval, subscribeApproval } from "@/lib/sync";

/**
 * Shown on /pos and /shift-log while this phone isn't approved (slice 15). Sales are still
 * recorded and kept on the phone; they are sent once Bayani or Mart types the approval PIN
 * here. `onApproved` runs the normal sync right after.
 */
export function DeviceApprovalBanner({ onApproved, message }: { onApproved?: () => void; message?: string }) {
  // The server render (and the first client render) never shows it: approval lives in localStorage.
  const waiting = useSyncExternalStore(subscribeApproval, isWaitingForApproval, () => false);
  if (!waiting) return null;

  return (
    <div role="status" className="animate-drop rz-notice rz-notice-warn text-sm flex-wrap">
      <TriangleAlert className="w-4.5 h-4.5 text-warn shrink-0 mt-px" />
      <span className="flex-1 min-w-48">
        {message ?? "This phone isn't approved yet. Sales are saved on this phone and will be sent once Bayani or Mart approves it."}
      </span>
      <ApprovePhoneButton onApproved={onApproved} className="rz-btn rz-btn-secondary text-sm pointer-coarse:min-h-12 pointer-coarse:text-base" />
    </div>
  );
}

/**
 * "Approve this phone" and its PIN dialog, wherever a phone may need approving: the banner above,
 * and (slice 21b) the barber sign-in on /pos and the owner sign-in on /login, where the phone may
 * already be approved. Approving again replaces this phone's secret (slice 15) and ends its active
 * barber assignment (the barber is assigned again at the next sign-in; assignment history stays);
 * its sales and its queue stay as they are. The PIN is checked on the server, never here.
 */
export function ApprovePhoneButton({ onApproved, className, label = "Approve this phone" }: {
  onApproved?: () => void;
  className: string;
  label?: string;
}) {
  const waiting = useSyncExternalStore(subscribeApproval, isWaitingForApproval, () => true);
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Escape closes the dialog, like its Cancel button.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await approveThisDevice(pin, name);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPin("");
    setName("");
    setOpen(false);
    setDone(true);
    onApproved?.();
  }

  return (
    <>
      <button type="button" onClick={() => { setError(null); setDone(false); setOpen(true); }} className={className}>
        <ShieldCheck aria-hidden="true" className="w-4 h-4" />
        {label}
      </button>
      {done && !waiting && <p role="status" className="sr-only">This phone is approved.</p>}

      {open && (
        <div className="rz-overlay items-center">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="approve-phone-title"
            onSubmit={(event) => { event.preventDefault(); void submit(); }}
            className="rz-dialog p-5 sm:p-5 space-y-5 sm:space-y-4"
          >
            <div className="flex items-center gap-2.5">
              <span aria-hidden="true" className="w-9 h-9 rounded-full bg-brass/10 ring-1 ring-brass/40 text-brass-bright flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </span>
              <h2 id="approve-phone-title" className="rz-title text-2xl sm:text-xl">Approve this phone</h2>
            </div>
            <p className="text-base sm:text-sm text-dust leading-relaxed">
              Bayani or Mart: type the approval PIN on this phone.
              {!waiting && " This phone is already approved. Approving it again gives it a new key and ends its barber assignment; the barber is assigned again when they next sign in. Its sales stay and still sync."}
            </p>
            <input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="off"
              aria-label="Approval PIN"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              className="rz-field min-h-14 sm:min-h-12 text-center text-xl sm:text-lg tracking-[0.4em] placeholder:text-base placeholder:tracking-normal"
              placeholder="Approval PIN"
            />
            <input
              type="text"
              maxLength={60}
              aria-label="Phone name (optional)"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rz-field min-h-12 text-base"
              placeholder="Phone name, e.g. Vince's phone (optional)"
            />
            {error && <p role="alert" className="rz-notice rz-notice-danger text-sm">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rz-btn rz-btn-secondary flex-1 pointer-coarse:min-h-12 pointer-coarse:text-base">Cancel</button>
              <button type="submit" disabled={busy || !pin} className="rz-btn rz-btn-primary flex-1 pointer-coarse:min-h-12 pointer-coarse:text-base">
                {busy ? "Checking…" : "Approve"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
