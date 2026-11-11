"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";

/**
 * Asks for the owner PIN on this phone, to move it to a different barber. `onSubmit` sends it
 * and returns an error to show, or null when it was accepted (the parent then closes this).
 * The PIN lives only in this dialog's state and is never stored.
 */
export function OwnerPinDialog({
  title,
  description,
  submitLabel,
  offline,
  onSubmit,
  onCancel,
}: {
  title: string;
  description: string;
  submitLabel: string;
  /** No connection: the PIN can't be checked, so submitting is disabled. */
  offline: boolean;
  onSubmit: (pin: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape closes the dialog, like its Cancel button.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await onSubmit(pin);
    setBusy(false);
    if (result) {
      setError(result);
      setPin("");
    }
  }

  return (
    <div className="rz-overlay items-center">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-pin-title"
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
        className="rz-dialog p-5 space-y-4"
      >
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="w-9 h-9 rounded-full bg-brass/10 ring-1 ring-brass/40 text-brass-bright flex items-center justify-center shrink-0">
            <KeyRound className="w-4 h-4" />
          </span>
          <h2 id="owner-pin-title" className="rz-title text-xl">{title}</h2>
        </div>
        <p className="text-sm text-dust leading-relaxed">{description}</p>
        {offline ? (
          <p role="status" className="rz-notice rz-notice-warn text-sm">
            This phone is offline. Changing the barber needs the shop Wi-Fi; until then, sales stay with the current barber.
          </p>
        ) : (
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Owner PIN"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            className="rz-field min-h-12 text-center text-lg tracking-[0.4em] placeholder:text-base placeholder:tracking-normal"
            placeholder="Owner PIN"
          />
        )}
        {error && <p role="alert" className="rz-notice rz-notice-danger text-sm">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rz-btn rz-btn-secondary flex-1 pointer-coarse:min-h-11">Cancel</button>
          <button type="submit" disabled={busy || offline || !pin} className="rz-btn rz-btn-primary flex-1 pointer-coarse:min-h-11">
            {busy ? "Checking…" : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
