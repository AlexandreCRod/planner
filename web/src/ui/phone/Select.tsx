// Selecting several notes or search results: a long press on one starts it and picks that one, then
// each tap adds or removes one. The page's top bar gives way to a selection bar (close, how many,
// Select all, Delete); Android's back or the close button ends it. Delete moves them all to the trash
// at once, with Undo in the snackbar, like deleting one.
// With a mouse (the PC's ui/PcSelect.tsx, brought over): a round box shows on the card or row under the
// pointer and picks it, a right-click starts selecting like a long press, Ctrl (Cmd) adds or removes
// one, Shift adds the run from the last one picked, Esc ends it (the back button) and Delete deletes.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Item } from "../../domain/types.ts";
import { IconButton } from "./chrome.tsx";
import { TextButton } from "./m3.tsx";
import { pushBack } from "./native.ts";
import { feel } from "./haptics.ts";
import { TOUCH_SLOP, swallowClick } from "./press.ts";
import { keepShown, rangeIds, selectAll, toggleId } from "./selection.ts";
import { trashManyWithUndo } from "./PhoneItem.tsx";
import { mouseMenu } from "./desk.ts";
import { typingTarget } from "./keys.ts";

const LONG_PRESS = 450;

export interface Selection {
  ids: ReadonlySet<number>;
  active: boolean;
  toggle: (id: number) => void;
  clear: () => void;
  all: () => void;
  /** Pointer handlers for one card or row: a long press (or a right-click) starts selecting with it. */
  pressProps: (id: number) => {
    onPointerDown: (e: ReactPointerEvent) => void; onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: () => void; onPointerCancel: () => void; onContextMenu: (e: ReactMouseEvent) => void;
  };
  /**
   * A tap on a card or row: picks or unpicks it while selecting, else [open]s it. With a mouse ([e]),
   * Ctrl (Cmd) picks or unpicks it whatever, and Shift adds everything from the last one picked.
   */
  tap: (id: number, open: () => void, e?: ReactMouseEvent) => void;
}

/** The selection among [shown] ids (anything no longer shown drops out of it). */
export function useSelection(shown: readonly number[]): Selection {
  const [ids, setIds] = useState<ReadonlySet<number>>(() => new Set());
  const idsRef = useRef(ids);
  idsRef.current = ids;
  // The last one picked or unpicked: where a Shift-click's run starts.
  const anchor = useRef<number | null>(null);
  const active = ids.size > 0;
  useEffect(() => { setIds((cur) => keepShown(cur, shown)); }, [shown]);
  useEffect(() => (active ? pushBack(() => setIds(new Set())) : undefined), [active]);
  const hold = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);
  const stop = () => { if (hold.current) { clearTimeout(hold.current.timer); hold.current = null; } };
  const toggle = (id: number) => { anchor.current = id; setIds((cur) => toggleId(cur, id)); };
  /** Picks [id] if it isn't (a long press, a right-click). */
  const pick = (id: number) => { anchor.current = id; setIds((cur) => (cur.has(id) ? cur : toggleId(cur, id))); };
  return {
    ids,
    active,
    toggle,
    clear: () => { anchor.current = null; setIds(new Set()); },
    all: () => setIds((cur) => selectAll(cur, shown)),
    pressProps: (id) => ({
      onPointerDown: (e) => {
        stop();
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const h = { id, x: e.clientX, y: e.clientY, timer: 0 };
        h.timer = window.setTimeout(() => {
          if (hold.current !== h) return;
          hold.current = null;
          swallowClick();
          feel("pickup");
          pick(id);
        }, LONG_PRESS);
        hold.current = h;
      },
      onPointerMove: (e) => {
        const h = hold.current;
        if (h && (Math.abs(e.clientX - h.x) > TOUCH_SLOP || Math.abs(e.clientY - h.y) > TOUCH_SLOP)) stop();
      },
      onPointerUp: stop,
      onPointerCancel: stop,
      onContextMenu: (e) => { e.preventDefault(); if (mouseMenu(e)) { stop(); pick(id); } },
    }),
    tap: (id, open, e) => {
      if (e?.shiftKey) {
        setIds((cur) => rangeIds(cur, shown, anchor.current, id));
        anchor.current = id;
      } else if (e && (e.ctrlKey || e.metaKey)) toggle(id);
      else if (idsRef.current.size > 0) toggle(id);
      else open();
    },
  };
}

/** The top bar while selecting: close, the count, Select all and Delete (to the trash); the Delete key too. */
export function SelectionBar({ sel, items }: { sel: Selection; items: (ids: ReadonlySet<number>) => Item[] }) {
  const del = () => { const list = items(sel.ids); sel.clear(); trashManyWithUndo(list); };
  const delRef = useRef(del);
  delRef.current = del;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" || e.repeat || typingTarget(e.target instanceof HTMLElement ? e.target : null)) return;
      e.preventDefault();
      delRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <header className="p-appbar p-selbar">
      <IconButton icon="fClose" label="Stop selecting" onClick={sel.clear} />
      <div className="p-appbar-title">{sel.ids.size} selected</div>
      <TextButton onClick={sel.all}>Select all</TextButton>
      <IconButton icon="oDelete" label="Delete" onClick={del} />
    </header>
  );
}

/** The small tick on a picked card or row. */
export function SelectedMark() {
  return <span className="p-selmark" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" fill="currentColor" /></svg></span>;
}

/**
 * The empty round box in the same place, shown only to a mouse hovering the card or row (phone.css,
 * under hover: hover): a click picks it, starting a selection.
 */
export function SelectBox({ onPick }: { onPick: () => void }) {
  return <button className="p-selbox" aria-label="Select" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onPick(); }} />;
}
