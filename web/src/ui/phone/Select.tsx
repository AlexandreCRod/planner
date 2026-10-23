// Selecting several notes or search results: a long press on one starts it and picks that one, then
// each tap adds or removes one. The page's top bar gives way to a selection bar (close, how many,
// Select all, Delete); Android's back or the close button ends it. Delete moves them all to the trash
// at once, with Undo in the snackbar, like deleting one.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Item } from "../../domain/types.ts";
import { IconButton } from "./chrome.tsx";
import { TextButton } from "./m3.tsx";
import { pushBack } from "./native.ts";
import { feel } from "./haptics.ts";
import { TOUCH_SLOP, swallowClick } from "./press.ts";
import { keepShown, selectAll, toggleId } from "./selection.ts";
import { trashManyWithUndo } from "./PhoneItem.tsx";

const LONG_PRESS = 450;

export interface Selection {
  ids: ReadonlySet<number>;
  active: boolean;
  toggle: (id: number) => void;
  clear: () => void;
  all: () => void;
  /** Pointer handlers for one card or row: a long press starts selecting with it. */
  pressProps: (id: number) => {
    onPointerDown: (e: ReactPointerEvent) => void; onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: () => void; onPointerCancel: () => void;
  };
  /** A tap on a card or row: picks or unpicks it while selecting, else [open]s it. */
  tap: (id: number, open: () => void) => void;
}

/** The selection among [shown] ids (anything no longer shown drops out of it). */
export function useSelection(shown: readonly number[]): Selection {
  const [ids, setIds] = useState<ReadonlySet<number>>(() => new Set());
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const active = ids.size > 0;
  useEffect(() => { setIds((cur) => keepShown(cur, shown)); }, [shown]);
  useEffect(() => (active ? pushBack(() => setIds(new Set())) : undefined), [active]);
  const hold = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);
  const stop = () => { if (hold.current) { clearTimeout(hold.current.timer); hold.current = null; } };
  return {
    ids,
    active,
    toggle: (id) => setIds((cur) => toggleId(cur, id)),
    clear: () => setIds(new Set()),
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
          setIds((cur) => (cur.has(id) ? cur : toggleId(cur, id)));
        }, LONG_PRESS);
        hold.current = h;
      },
      onPointerMove: (e) => {
        const h = hold.current;
        if (h && (Math.abs(e.clientX - h.x) > TOUCH_SLOP || Math.abs(e.clientY - h.y) > TOUCH_SLOP)) stop();
      },
      onPointerUp: stop,
      onPointerCancel: stop,
    }),
    tap: (id, open) => { if (idsRef.current.size > 0) setIds((cur) => toggleId(cur, id)); else open(); },
  };
}

/** The top bar while selecting: close, the count, Select all and Delete (to the trash). */
export function SelectionBar({ sel, items }: { sel: Selection; items: (ids: ReadonlySet<number>) => Item[] }) {
  return (
    <header className="p-appbar p-selbar">
      <IconButton icon="fClose" label="Stop selecting" onClick={sel.clear} />
      <div className="p-appbar-title">{sel.ids.size} selected</div>
      <TextButton onClick={sel.all}>Select all</TextButton>
      <IconButton icon="oDelete" label="Delete" onClick={() => { const list = items(sel.ids); sel.clear(); trashManyWithUndo(list); }} />
    </header>
  );
}

/** The small tick on a picked card or row. */
export function SelectedMark() {
  return <span className="p-selmark" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" fill="currentColor" /></svg></span>;
}
