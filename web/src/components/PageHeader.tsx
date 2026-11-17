import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

/**
 * The frame every owner page shares, so the pages line up when the owner moves between them:
 * the same page width, side gutters and spacing (PageContainer), and the same header (PageHeader):
 * the title, a one-line description under it, and the page's actions at the top right with the
 * reload button last, always in the same corner. The owner menu's top bar already names the page,
 * so there is no second banner strip.
 *
 * Two widths only: "wide" for pages of tables and figures (Dashboard, Sales, Reports, Payouts),
 * "standard" for lists and forms (everything else). No hooks: usable in server and client pages.
 */
export type PageWidth = "wide" | "standard";

const WIDTHS: Record<PageWidth, string> = { wide: "max-w-312", standard: "max-w-4xl" };

export function PageContainer({ width = "standard", children }: { width?: PageWidth; children: ReactNode }) {
  return (
    <main className="flex-1">
      <div className={`rz-page relative mx-auto ${WIDTHS[width]} space-y-6 px-4 py-5 sm:px-6 sm:py-7`}>{children}</div>
    </main>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  onReload,
  reloading = false,
  reloadLabel = "Reload",
  children,
}: {
  title: string;
  description?: ReactNode;
  /** Buttons or controls for this page, shown left of the reload button. */
  actions?: ReactNode;
  /** Shows the reload button when given. */
  onReload?: () => void;
  reloading?: boolean;
  /** What the reload button is called for screen readers, e.g. "Reload the phones". */
  reloadLabel?: string;
  /** Extra lines under the description (a "saved on" note, for example). */
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-4">
      {/* The text takes the room it needs (at least 16rem); wide actions drop below it on a phone, a lone reload button stays beside it. */}
      <div className="min-w-0 flex-1 basis-64 space-y-1.5">
        <h1 className="rz-title text-3xl sm:text-4xl">{title}</h1>
        {description && <p className="max-w-prose text-sm leading-relaxed text-dust">{description}</p>}
        {children}
      </div>
      {(actions || onReload) && (
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {onReload && (
            <button
              type="button"
              onClick={onReload}
              title="Reload"
              aria-label={reloadLabel}
              className="rz-btn rz-btn-ghost rz-btn-icon shrink-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              <RefreshCw aria-hidden="true" className={`h-4 w-4 ${reloading ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      )}
    </header>
  );
}
