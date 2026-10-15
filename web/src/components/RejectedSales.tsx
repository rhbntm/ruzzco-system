"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import type { LocalTransaction } from "@/lib/db";
import { rejectHint, rejectLabel } from "@/lib/sync";

const METHOD_LABELS: Record<LocalTransaction["paymentMethod"], string> = {
  CASH: "Cash",
  GCASH: "GCash",
  MAYA: "Maya",
  QRPH: "QR Ph (test)",
};

/**
 * Sales the server refused. They stay on this device, unchanged, and are not retried
 * automatically. Retry only re-queues the sale as it is; nothing here edits it.
 */
export function RejectedSales({
  sales,
  busy,
  onRetry,
}: {
  sales: LocalTransaction[];
  busy: boolean;
  onRetry: (id: string) => void;
}) {
  if (sales.length === 0) return null;

  return (
    <section className="animate-rise p-3.5 rounded-xl bg-warn/7 border border-warn/35 space-y-3">
      <div className="flex items-center gap-2 text-xs font-bold text-warn-ink uppercase tracking-wider">
        <TriangleAlert className="w-4 h-4 shrink-0" />
        {sales.length} {sales.length === 1 ? "sale needs" : "sales need"} attention
      </div>
      <p className="text-sm text-warn-ink/90 leading-relaxed">
        The server did not accept {sales.length === 1 ? "this sale" : "these sales"}. {sales.length === 1 ? "It is" : "They are"} kept
        on this device and not counted on the server until resolved.
      </p>

      <ul className="rounded-lg bg-black/30 border border-warn/20 overflow-hidden divide-y divide-warn/15 rz-stagger">
        {sales.map((tx) => (
          <li key={tx.id} className="p-3 text-xs space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-bone truncate">
                {new Date(tx.transactionTime).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                <span className="text-dust font-normal"> • {tx.barberName}</span>
              </span>
              <span className="rz-figure text-sm text-bone shrink-0">
                ₱{Number(tx.totalAmount).toFixed(2)} · {METHOD_LABELS[tx.paymentMethod] ?? tx.paymentMethod}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <div className="text-warn-ink font-semibold">{rejectLabel(tx.syncError)}</div>
                {rejectHint(tx.syncError) && (
                  <div className="text-xs text-bone-2">{rejectHint(tx.syncError)}</div>
                )}
                <div className="text-xs text-dust font-mono">{tx.id.slice(0, 8)}…</div>
              </div>
              <button
                type="button"
                onClick={() => onRetry(tx.id)}
                disabled={busy}
                className="rz-btn rz-btn-warn shrink-0 min-h-9 px-3 text-xs pointer-coarse:min-h-11"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
