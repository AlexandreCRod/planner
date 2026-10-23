// Return to where you were. The bottom bar's pages stay mounted, so they keep everything themselves;
// a full-screen page (Search, Settings, Links...) is built afresh each time it shows. Each step of the
// browser's history gets an id the first time a page asks (kept in history.state), and the page keeps
// what it needs to come back to under it: back to that step finds it as it was, while opening the page
// anew (a new step) starts it fresh. Kept while the app runs, for the last few dozen steps.
import { type SetStateAction, useEffect, useLayoutEffect, useState } from "react";

/** What pages keep, per history step, the most recently used last; the oldest go past [max]. */
export class PageMemory {
  private steps = new Map<string, Map<string, unknown>>();
  private max: number;
  constructor(max = 40) { this.max = max; }
  /** Whether anything was kept for [step]. */
  has(step: string) { return this.steps.has(step); }
  get<T>(step: string, name: string): T | undefined {
    const b = this.steps.get(step);
    if (!b) return undefined;
    this.steps.delete(step); this.steps.set(step, b);
    return b.get(name) as T | undefined;
  }
  set(step: string, name: string, value: unknown) {
    let b = this.steps.get(step);
    if (b) this.steps.delete(step); else b = new Map();
    b.set(name, value);
    this.steps.set(step, b);
    while (this.steps.size > this.max) this.steps.delete(this.steps.keys().next().value!);
  }
  get size() { return this.steps.size; }
}

const memory = new PageMemory();
let seq = 0;

/** The id of the history step shown now, given one the first time it's asked. */
function stepId(): string {
  const st: unknown = history.state;
  const old = st && typeof st === "object" ? st as Record<string, unknown> : null;
  if (typeof old?.keep === "string") return old.keep;
  const id = `${Date.now().toString(36)}.${++seq}`;
  try { history.replaceState({ ...(old ?? {}), keep: id }, "", location.href); } catch { /* no history: nothing kept */ }
  return id;
}

/** A page's handle on what it keeps: [back] is true when it's being returned to (something was kept). */
export interface Kept { step: string; back: boolean }

/** Call once at the top of a full-screen page: its history step, taken as it opens. */
export function useKeep(): Kept {
  const [k] = useState<Kept>(() => { const step = stepId(); return { step, back: memory.has(step) }; });
  return k;
}

/** useState whose value is kept for the page's history step (restored on coming back to it). */
export function useKeptState<T>(k: Kept, name: string, init: T | (() => T)): [T, (v: SetStateAction<T>) => void] {
  const [v, setV] = useState<T>(() => {
    const saved = memory.get<T>(k.step, name);
    return saved !== undefined ? saved : typeof init === "function" ? (init as () => T)() : init;
  });
  useEffect(() => { memory.set(k.step, name, v); }, [k.step, name, v]);
  return [v, setV];
}

/** A value kept without re-rendering (positions, a view): read once, written when the page says. */
export function keptValue<T>(k: Kept, name: string): T | undefined { return memory.get<T>(k.step, name); }
export function keepValue(k: Kept, name: string, value: unknown) { memory.set(k.step, name, value); }

/**
 * The scroll of [el] (found by [find] once the page is drawn) kept for the page's step: put back as the
 * page comes back, followed as it scrolls.
 */
export function useKeptScroll(k: Kept, name: string, find: () => HTMLElement | null | undefined) {
  useLayoutEffect(() => {
    const el = find();
    if (!el) return;
    const top = memory.get<number>(k.step, `scroll:${name}`);
    if (top) el.scrollTop = top;
    const on = () => memory.set(k.step, `scroll:${name}`, el.scrollTop);
    el.addEventListener("scroll", on, { passive: true });
    // Read once more as the page goes (still in the document then): scroll events wait for a frame.
    return () => { el.removeEventListener("scroll", on); if (el.isConnected) on(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
