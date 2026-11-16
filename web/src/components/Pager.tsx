"use client";

// Slice 22, Decision 6: one pager for every list of records. Previous, "Page 2 of 5", Next
// (hidden with one page) and "Show per page" (10, 25, 50, 100; shown only while the list has more
// than 10 records). The page is announced politely. Presentation only: the list owns its state.

import { PAGE_SIZE_PRESETS } from "@/lib/paginate";
import type { PagedList } from "@/lib/use-paged-list";
import { ResetButton } from "@/components/ShowingLine";

export function Pager({ page, pageCount, pageSize, total, onPage, onPageSize, label = "Pages" }: {
  page: number;
  pageCount: number;
  pageSize: number;
  /** Records in the whole list (the size choice shows only above 10). */
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  label?: string;
}) {
  const showSize = total > PAGE_SIZE_PRESETS[0];
  if (pageCount <= 1 && !showSize) return null;
  const button = "rz-btn rz-btn-secondary text-sm pointer-coarse:min-h-11 pointer-coarse:min-w-11 disabled:opacity-40";
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3">
      {pageCount > 1 ? (
        <div className="flex items-center gap-2">
          <button type="button" className={button} disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
          <span aria-live="polite" className="text-sm text-dust tabular-nums">Page {page} of {pageCount}</span>
          <button type="button" className={button} disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Next</button>
        </div>
      ) : <span />}
      {showSize && (
        <label className="flex items-center gap-2 text-xs text-dust">
          Show per page
          <select
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            className="rz-field w-auto py-1.5 pointer-coarse:min-h-11 sm:text-sm"
          >
            {PAGE_SIZE_PRESETS.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      )}
    </nav>
  );
}

/** The pager and Reset to default for a list driven by `usePagedList`. */
export function PagedControls<T>({ list, label }: { list: PagedList<T>; label: string }) {
  return (
    <div className="space-y-1">
      <Pager
        page={list.shown.page}
        pageCount={list.shown.pageCount}
        pageSize={list.pageSize}
        total={list.total}
        onPage={list.setPage}
        onPageSize={list.changePageSize}
        label={label}
      />
      {list.canReset && <div className="flex justify-end"><ResetButton isDefault={list.isDefault} onReset={list.reset} /></div>}
    </div>
  );
}
