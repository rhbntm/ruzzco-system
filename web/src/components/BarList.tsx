// A list of labelled bars (payment methods, barbers, services) on /insights and its presentation.
// The value and share are printed, so the bar only repeats them and is hidden from screen readers.
// No hooks: it renders on the server page and inside the client presentation alike.
// `delay` (ms) holds the bars back, so in the presentation they grow after the headline lands.
export type BarItem = { key: string; label: string; note?: string; valueText: string; share: number | null };

export function BarList({ items, delay = 0 }: { items: BarItem[]; delay?: number }) {
  return (
    <ul className="space-y-3.5">
      {items.map((item, index) => (
        <li key={item.key} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 text-bone">
              {item.label}
              {item.note && <span className="text-xs text-dust"> · {item.note}</span>}
            </span>
            <span className="shrink-0 text-bone font-semibold tabular-nums">
              {item.valueText}{" "}
              <span className="text-xs font-normal text-dust">{item.share === null ? "—" : `${Math.round(item.share)}%`}</span>
            </span>
          </div>
          <div aria-hidden="true" className="h-2 rounded-full bg-black/35 overflow-hidden" title={`${item.label}: ${item.valueText}`}>
            <div
              className="h-2 rounded-full bg-crimson-bright origin-left"
              style={{ width: `${item.share ?? 0}%`, animation: `rz-grow-x 800ms var(--ease-out-expo) ${delay + 120 + index * 60}ms both` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
