/** Pages of a list already in display order (slices 13 and 22). Pure. */

/** Slice 22, Decision 6: the page sizes a list offers; presets only, no typed size. */
export const PAGE_SIZE_PRESETS = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 10;
/** The Sales page is the busy one: a day fits on one or two pages on the PC. */
export const SALES_PAGE_SIZE = 25;

export function isPageSize(value: unknown): value is (typeof PAGE_SIZE_PRESETS)[number] {
  return typeof value === "number" && (PAGE_SIZE_PRESETS as readonly number[]).includes(value);
}

export interface Page<T> {
  items: T[];
  /** 1-based, clamped to the pages that exist. */
  page: number;
  pageCount: number;
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number = DEFAULT_PAGE_SIZE): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  // A list that shrank (or a bad page number) shows the nearest page that exists.
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: current, pageCount };
}
