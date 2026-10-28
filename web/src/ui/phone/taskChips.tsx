// The Tasks page's filter chips (Show completed, a chip per category) and their rule, shared with the
// Calendar's Agenda (241), which puts Events and Tasks chips before them.
import type { ReactNode } from "react";
import type { Item } from "../../domain/types.ts";
import type { Snapshot } from "../../store/store.ts";
import { ChipRow, FilterChip } from "./chrome.tsx";

/** What the chips choose: completed tasks shown or not, and one category (null: all). */
export interface TaskFilter { showDone: boolean; category: number | null }

/** The category chip's rule: with one picked, only its items (none without a category). */
export const inCategory = (i: Item, category: number | null) => category === null || i.categoryId === category;

export function TaskChips({ s, value, onChange, before, className = "tasks" }: {
  s: Snapshot; value: TaskFilter; onChange: (v: TaskFilter) => void; before?: ReactNode; className?: string;
}) {
  return (
    <ChipRow className={className}>
      {before}
      <FilterChip selected={value.showDone} onClick={() => onChange({ ...value, showDone: !value.showDone })}>Show completed</FilterChip>
      {s.categories.map((c) => (
        <FilterChip key={c.id} selected={value.category === c.id} onClick={() => onChange({ ...value, category: value.category === c.id ? null : c.id })}>{c.name}</FilterChip>
      ))}
    </ChipRow>
  );
}
