"use client";

// Slice 22, Decision 11: the line that names what a list is showing, defaults included, with
// Reset to default at its end. In the attention style (the warn tokens, never crimson) once any
// filter differs from All.

export function ShowingLine({ text, filtered, canReset, isDefault, onReset }: {
  text: string;
  filtered: boolean;
  /** Reset appears only on lists with filters or a range, or more than 10 records. */
  canReset: boolean;
  isDefault: boolean;
  onReset: () => void;
}) {
  return (
    <p className={`flex flex-wrap items-center justify-between gap-2 text-xs px-3 py-2 rounded-lg border ${filtered ? "rz-notice-warn" : "border-seam text-dust"}`}>
      <span>{text}</span>
      {canReset && (
        <button type="button" disabled={isDefault} onClick={onReset} className="rz-link disabled:opacity-40 disabled:no-underline pointer-coarse:min-h-11 pointer-coarse:px-2">
          Reset to default
        </button>
      )}
    </p>
  );
}

/** Reset to default beside the pager, on a list without filters or a range (Decision 10). */
export function ResetButton({ isDefault, onReset }: { isDefault: boolean; onReset: () => void }) {
  return (
    <button type="button" disabled={isDefault} onClick={onReset} className="rz-link text-xs disabled:opacity-40 disabled:no-underline pointer-coarse:min-h-11 pointer-coarse:px-2">
      Reset to default
    </button>
  );
}
