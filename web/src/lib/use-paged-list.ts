"use client";

// Slice 22, Decisions 6 and 10: the page and page size of one list of records paged on the
// screen. The size is kept in this browser under the list's key; the page number never is, so
// a list always opens on page 1. `paginate` clamps, so a list that shrank (a phone revoked, an
// account deactivated) shows the nearest page that still exists.

import { useState } from "react";
import { DEFAULT_PAGE_SIZE, paginate } from "@/lib/paginate";
import { clearListSettings, readListSettings, validPageSize, writeListSettings } from "@/lib/list-settings";

export function usePagedList<T>(key: string, items: readonly T[], defaultSize: number = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const [pageSize, setSize] = useState<number>(() =>
    readListSettings(key, { pageSize: defaultSize }, (raw, d) => ({ pageSize: validPageSize(raw.pageSize, d.pageSize) })).pageSize
  );
  const shown = paginate(items, page, pageSize);
  return {
    shown,
    pageSize,
    total: items.length,
    setPage,
    changePageSize(size: number) {
      setSize(size);
      setPage(1);
      writeListSettings(key, { pageSize: size });
    },
    reset() {
      clearListSettings(key);
      setSize(defaultSize);
      setPage(1);
    },
    isDefault: pageSize === defaultSize,
    /** Reset appears only while the list can reach a second page (more than 10 records). */
    canReset: items.length > DEFAULT_PAGE_SIZE,
  };
}

export type PagedList<T> = ReturnType<typeof usePagedList<T>>;
