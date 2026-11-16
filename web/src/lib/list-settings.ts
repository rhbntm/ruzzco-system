// Slice 22, Decisions 10 and 11: what a paged list keeps in this browser (its range, filters and
// page size; never the page number) and the line that names what is applied. Pure: the storage
// is passed in so the tests use a fake one, and every read and write is in try/catch.

import { isPageSize } from "@/lib/paginate";
import { parseRange, presetRange, PRESETS, type Preset } from "@/lib/date-range";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY_PREFIX = "ruzzco:list:";

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * The kept settings of one list, or `defaults` when nothing usable is kept. `validate` receives
 * the parsed object (unknown shape) and returns the settings with every invalid field replaced by
 * its own default; it never throws an error to the user. A stored page number is never read.
 */
export function readListSettings<T extends object>(
  key: string,
  defaults: T,
  validate: (raw: Record<string, unknown>, defaults: T) => T,
  storage: StorageLike | null = defaultStorage()
): T {
  try {
    const text = storage?.getItem(KEY_PREFIX + key);
    if (!text) return defaults;
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
    return validate(raw as Record<string, unknown>, defaults);
  } catch {
    return defaults;
  }
}

export function writeListSettings(key: string, settings: object, storage: StorageLike | null = defaultStorage()) {
  try {
    storage?.setItem(KEY_PREFIX + key, JSON.stringify(settings));
  } catch {
    /* a full or blocked storage keeps nothing; the list still works */
  }
}

export function clearListSettings(key: string, storage: StorageLike | null = defaultStorage()) {
  try {
    storage?.removeItem(KEY_PREFIX + key);
  } catch {
    /* nothing to clear */
  }
}

/** Whether every setting equals its default (Reset to default is disabled then). */
export function isDefault<T extends object>(settings: T, defaults: T): boolean {
  const keys = new Set([...Object.keys(settings), ...Object.keys(defaults)]) as Set<keyof T>;
  for (const k of keys) if (settings[k] !== defaults[k]) return false;
  return true;
}

/** A kept page size, or the list's default when it isn't a preset. */
export function validPageSize(value: unknown, fallback: number): number {
  return isPageSize(value) ? value : fallback;
}

/** A kept filter id, or "all" when it is not one of the ids offered now. */
export function validChoice(value: unknown, offered: readonly string[] | null, fallback = "all"): string {
  if (typeof value !== "string") return fallback;
  if (value === fallback) return fallback;
  return offered === null || offered.includes(value) ? value : fallback;
}

/** A kept range: a preset by name, or a Custom range by its two dates. */
export type KeptRange = { preset: Preset } | { from: string; to: string };

/** The range a kept value stands for today, or Today when it is unreadable or no longer valid. */
export function resolveKeptRange(raw: unknown, today: string): { key: string; from: string; to: string } {
  const fallback = { key: "today", ...presetRange("today", today) };
  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as Record<string, unknown>;
  if (typeof value.preset === "string" && (PRESETS as readonly string[]).includes(value.preset)) {
    const preset = value.preset as Preset;
    return { key: preset, ...presetRange(preset, today) };
  }
  if (typeof value.from === "string" && typeof value.to === "string") {
    const parsed = parseRange(value.from, value.to, today);
    if (parsed.ok) return { key: "custom", from: value.from, to: value.to };
  }
  return fallback;
}

/** What to store for a range: presets by name so "This week" is still this week tomorrow. */
export function keepRange(range: { key: string; from: string; to: string }): KeptRange {
  return (PRESETS as readonly string[]).includes(range.key)
    ? { preset: range.key as Preset }
    : { from: range.from, to: range.to };
}

const day = (iso: string, withYear: boolean) =>
  new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/** "Nov 10–16, 2026", "Oct 30–Nov 2, 2026", "Nov 10, 2026". */
export function shortRangeText(from: string, to: string): string {
  if (from === to) return day(from, true);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const sameMonth = sameYear && from.slice(5, 7) === to.slice(5, 7);
  if (sameMonth) return `${day(from, false)}–${Number(to.slice(8, 10))}, ${to.slice(0, 4)}`;
  return `${day(from, !sameYear)}–${day(to, true)}`;
}

export type ShowingFilter = { label: string; value: string | null; allText: string };

/**
 * Decision 11: "Showing: all barbers · all methods · all statuses · Nov 10–16, 2026" by default;
 * once any filter is set only the filters that differ from All are named. `range` is last.
 */
export function showingText(filters: readonly ShowingFilter[], range: { from: string; to: string } | null): { text: string; filtered: boolean } {
  const set = filters.filter((f) => f.value !== null);
  const parts = set.length > 0 ? set.map((f) => f.value as string) : filters.map((f) => f.allText);
  if (range) parts.push(shortRangeText(range.from, range.to));
  return { text: `Showing: ${parts.join(" · ")}`, filtered: set.length > 0 };
}
