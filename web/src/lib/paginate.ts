/** Pages of a list already in display order (slice 13: /shift-log, 20 sales a page). Pure. */

export const SHIFT_LOG_PAGE_SIZE = 20;

export interface Page<T> {
  items: T[];
  /** 1-based, clamped to the pages that exist. */
  page: number;
  pageCount: number;
}

export function paginate<T>(items: readonly T[], page: number, pageSize = SHIFT_LOG_PAGE_SIZE): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  // A list that shrank (or a bad page number) shows the nearest page that exists.
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: current, pageCount };
}
