"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import type { LocalTransaction } from "@/lib/db";
import { needsReview, rejectLabel } from "@/lib/sync";

const METHOD_LABELS: Record<LocalTransaction["paymentMethod"], string> = {
  CASH: "Cash",
  GCASH: "GCash",
  MAYA: "Maya",
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
    <section className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/40 space-y-2.5">
      <div className="flex items-center gap-2 text-xs font-bold text-amber-300 uppercase tracking-wider">
        <TriangleAlert className="w-4 h-4 shrink-0" />
        {sales.length} {sales.length === 1 ? "sale needs" : "sales need"} attention
      </div>
      <p className="text-[11px] text-amber-200/80 leading-relaxed">
        The server did not accept {sales.length === 1 ? "this sale" : "these sales"}. {sales.length === 1 ? "It is" : "They are"} kept
        on this device and not counted on the server until resolved.
      </p>

      <div className="space-y-2">
        {sales.map((tx) => (
          <div key={tx.id} className="p-2.5 rounded-lg bg-[#12141a] border border-amber-500/20 text-xs space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-zinc-200 truncate">
                {new Date(tx.transactionTime).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                <span className="text-zinc-500 font-normal"> • {tx.barberName}</span>
              </span>
              <span className="font-bold text-zinc-100 shrink-0 font-[family-name:var(--font-oswald)]">
                ₱{Number(tx.totalAmount).toFixed(2)} · {METHOD_LABELS[tx.paymentMethod] ?? tx.paymentMethod}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-amber-300 font-medium">{rejectLabel(tx.syncError)}</div>
                {needsReview(tx.syncError) && (
                  <div className="text-[10px] text-amber-200/70">Needs review. Retrying will not fix this by itself.</div>
                )}
                <div className="text-[10px] text-zinc-600 font-mono">{tx.id.slice(0, 8)}…</div>
              </div>
              <button
                type="button"
                onClick={() => onRetry(tx.id)}
                disabled={busy}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 text-[11px] font-semibold hover:bg-amber-500/20 disabled:opacity-40 cursor-pointer transition-colors"
              >
                <RotateCw className="w-3 h-3" />
                Retry
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
