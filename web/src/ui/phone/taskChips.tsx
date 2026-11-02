// The Tasks page's filter chips (a chip per category) and their rule, shared with the Calendar's Agenda
// (241), which puts Events and Tasks chips before them. Ticked tasks aren't a filter: every list folds them
// into its "5 done" line (284).
import type { ReactNode } from "react";
import type { Item } from "../../domain/types.ts";
import type { Snapshot } from "../../store/store.ts";
import { ChipRow, FilterChip } from "./chrome.tsx";

/** What the chips choose: one category (null: all). */
export interface TaskFilter { category: number | null }

/** The category chip's rule: with one picked, only its items (none without a category). */
export const inCategory = (i: Item, category: number | null) => category === null || i.categoryId === category;

export function TaskChips({ s, value, onChange, before, className = "tasks" }: {
  s: Snapshot; value: TaskFilter; onChange: (v: TaskFilter) => void; before?: ReactNode; className?: string;
}) {
  return (
    <ChipRow className={className}>
      {before}
      {s.categories.map((c) => (
        <FilterChip key={c.id} selected={value.category === c.id} onClick={() => onChange({ ...value, category: value.category === c.id ? null : c.id })}>{c.name}</FilterChip>
      ))}
    </ChipRow>
  );
}
