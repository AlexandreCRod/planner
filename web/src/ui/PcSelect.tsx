// Picking several notes or search results on the PC: a checkbox shows on hover, Ctrl/Cmd-click adds or
// removes one, Shift-click adds a range. Once something is picked a bar shows the count, Select all,
// Delete (to the trash, with Undo) and ✕; Esc clears it and the Delete key deletes.
import { useEffect, useRef, useState } from "react";
import type { Item } from "../domain/types.ts";
import { count } from "../domain/plural.ts";
import { restore, trash } from "../store/store.ts";
import { keepShown, rangeIds, selectAll, toggleId } from "./phone/selection.ts";
import { showToast } from "./Toast.tsx";

export function usePcSelection(shown: readonly number[]) {
  const [ids, setIds] = useState<ReadonlySet<number>>(new Set());
  const anchor = useRef<number | null>(null);
  // Anything filtered away or deleted elsewhere drops out of the choice.
  const kept = keepShown(ids, shown);
  if (kept !== ids) setIds(kept);
  const active = kept.size > 0;
  const clear = () => { setIds(new Set()); anchor.current = null; };
  const toggle = (id: number) => { setIds((cur) => toggleId(cur, id)); anchor.current = id; };
  /** Handles a click on a row; true when it was a selection click (the row shouldn't open then). */
  const click = (e: React.MouseEvent, id: number): boolean => {
    if (e.shiftKey) { e.preventDefault(); setIds((cur) => rangeIds(cur, shown, anchor.current, id)); anchor.current = id; return true; }
    if (e.ctrlKey || e.metaKey || active) { toggle(id); return true; }
    return false;
  };
  return { ids: kept, active, clear, toggle, click, selectAll: () => setIds((cur) => selectAll(cur, shown)) };
}

export type PcSelection = ReturnType<typeof usePcSelection>;

/** Moves [items] to the trash; the toast's Undo brings them back. */
export function trashManyWithToast(items: Item[]) {
  if (items.length === 0) return;
  for (const i of items) trash(i.id);
  showToast(items.length === 1 ? `"${items[0].title || "Untitled"}" moved to trash` : `${count(items.length, "item")} moved to trash`, "Undo", () => { for (const i of items) restore(i.id); });
}

/** The bar shown while something is picked. [items] are the picked items, for Delete. */
export function SelectionBar({ sel, items, total }: { sel: PcSelection; items: Item[]; total: number }) {
  const del = () => { trashManyWithToast(items); sel.clear(); };
  const latest = useRef({ sel, del });
  latest.current = { sel, del };
  useEffect(() => {
    if (!sel.active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "Escape") latest.current.sel.clear();
      else if (e.key === "Delete") { e.preventDefault(); latest.current.del(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel.active]);
  if (!sel.active) return null;
  return (
    <div className="sel-bar" role="toolbar" aria-label="Selection">
      <button className="sel-close" title="Clear selection (Esc)" aria-label="Clear selection" onClick={sel.clear}>✕</button>
      <b className="grow">{sel.ids.size} selected</b>
      {sel.ids.size < total && <button className="btn small" onClick={sel.selectAll}>Select all</button>}
      <button className="btn small danger" title="Move to trash (Delete)" onClick={del}>Delete</button>
    </div>
  );
}

/** The round checkbox on a row or card: shown on hover, and always while anything is picked. */
export function SelectBox({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button className={`sel-box ${on ? "on" : ""}`} role="checkbox" aria-checked={on} aria-label={on ? "Unselect" : "Select"}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      {on && <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9.55 18 3.85 12.3 5.275 10.875 9.55 15.15 18.725 5.975 20.15 7.4Z" /></svg>}
    </button>
  );
}
