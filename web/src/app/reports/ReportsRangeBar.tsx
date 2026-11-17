"use client";

// Slice 27: the Reports range bar. The shared DateRangeBar (presets and Custom, checked by the
// routes' own parseRange); the choice lives in the URL so a reload or a link shows the same range.
import { useRouter } from "next/navigation";
import { CUSTOM_KEY, DateRangeBar, presetOptions, type RangeOption } from "@/components/DateRangeBar";

export function ReportsRangeBar({ today, selected, from, to }: { today: string; selected: string; from: string; to: string }) {
  const router = useRouter();
  const options: RangeOption[] = presetOptions(today);
  if (selected === CUSTOM_KEY) options.push({ key: CUSTOM_KEY, label: "Custom", from, to });
  return (
    <DateRangeBar
      options={options}
      selected={selected}
      today={today}
      label="Dates for every figure on Reports"
      onSelect={(key) => router.push(key === "last7Days" ? "/reports" : `/reports?range=${key}`, { scroll: false })}
      onCustom={(option) => router.push(`/reports?from=${option.from}&to=${option.to}`, { scroll: false })}
    />
  );
}
