// A second note alongside the one being written ("Show another note" in the note's menu): a panel under
// it, about half the height, showing the other note to read. Its handle drags it taller or shorter, and
// down past its smallest size it closes; Swap makes it the note being written (and this one the one
// shown in the panel).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "../../domain/dates.ts";
import { sortNotes } from "../../domain/noteOrder.ts";
import { notePreview } from "../../domain/text.ts";
import { cssColor } from "../../domain/types.ts";
import { useSnapshot } from "../../store/store.ts";
import { sanitize } from "../RichEditor.tsx";
import { FONTS } from "../NotesView.tsx";
import { IconButton, MIcon } from "./chrome.tsx";
import { feel } from "./haptics.ts";
import { BottomSheet, contentColor } from "./m3.tsx";
import { GLIDE_SPRING, VelocityTracker, animateSpring } from "./motion.ts";

let pending: number | null = null;
/** The next note opened shows note [id] in its panel (Swap). */
export function peekInNextNote(id: number | null) { pending = id; }
/** Taken once, by the note being opened (cleared a moment later, so a remount in development sees it too). */
export function takePendingPeek(): number | null {
  const id = pending;
  if (id !== null) window.setTimeout(() => { pending = null; }, 0);
  return id;
}

const MIN_H = 120;
const titleOf = (n: { title: string; noteDay: number | null }) => n.title.trim() || (n.noteDay !== null ? formatDate(n.noteDay) : "") || "Untitled note";

/** The note picker: every note but this one, the Notes page's order. */
export function PeekPicker({ exclude, onPick, onClose }: { exclude: number; onPick: (id: number) => void; onClose: () => void }) {
  const s = useSnapshot();
  const [q, setQ] = useState("");
  const notes = useMemo(() => {
    const words = q.trim().toLowerCase();
    return sortNotes(s.items.filter((n) => n.type === "NOTE" && n.deletedAt === null && n.id !== exclude))
      .filter((n) => !words || (n.title + " " + notePreview(n.content, 400, 20)).toLowerCase().includes(words));
  }, [s, q, exclude]);
  return (
    <BottomSheet onClose={onClose} className="pn-peek-pick">{(close) => (
      <>
        <div className="p-sheet-title small">Show another note</div>
        <label className="pn-peek-search">
          <MIcon name="oSearch" size={20} />
          <input value={q} placeholder="Find a note" onChange={(e) => setQ(e.target.value)} autoCapitalize="none" />
        </label>
        <div className="pn-peek-list">
          {notes.length === 0 && <div className="pn-peek-none">No other notes{q.trim() ? " match" : ""}.</div>}
          {notes.map((n) => (
            <div key={n.id} className="p-li two" role="button" onClick={() => { onPick(n.id); close(); }}>
              <span className="pe-dot small" style={{ background: n.bgColor !== null ? cssColor(n.bgColor) : "var(--p-outline-variant, #ccc)" }} />
              <span className="text">
                <span className="headline ellipsis">{titleOf(n)}</span>
                <span className="supporting ellipsis">{notePreview(n.content, 90, 1)}</span>
              </span>
            </div>
          ))}
        </div>
      </>
    )}</BottomSheet>
  );
}

/** The panel. [host] is the note's page, whose height bounds the panel's. */
export function NotePeek({ id, host, onSwap, onClose }: { id: number; host: () => HTMLElement | null; onSwap: () => void; onClose: () => void }) {
  const s = useSnapshot();
  const note = s.byId.get(id);
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(() => Math.round((host()?.clientHeight ?? window.innerHeight) * 0.42));
  const g = useRef<{ id: number; y0: number; h0: number; h: number; vt: VelocityTracker } | null>(null);
  const closing = useRef(false);
  const most = () => Math.max(MIN_H + 40, (host()?.clientHeight ?? window.innerHeight) - 200);

  // The note was deleted (here or on another device): the panel goes.
  useEffect(() => { if (!note || note.deletedAt !== null) onClose(); }, [note]); // eslint-disable-line react-hooks/exhaustive-deps
  // Opening: it rises from the bottom.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    animateSpring(h, 0, 0, (y) => { el.style.transform = y > 0.5 ? `translate3d(0,${y}px,0)` : ""; }, () => { el.style.transform = ""; }, { ...GLIDE_SPRING, damping: 1 });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const size = (px: number) => { if (box.current) box.current.style.height = `${px}px`; };
  const close = (from: number, v: number) => {
    if (closing.current) return;
    closing.current = true;
    feel("settle");
    animateSpring(from, 0, -v, (x) => size(Math.max(0, x)), onClose, { ...GLIDE_SPRING, damping: 1 });
  };

  const onDown = (e: React.PointerEvent<HTMLElement>) => {
    if (g.current || closing.current || !e.isPrimary || (e.target as HTMLElement).closest("button")) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer already gone */ }
    g.current = { id: e.pointerId, y0: e.clientY, h0: h, h, vt: new VelocityTracker() };
    g.current.vt.add(e.timeStamp, e.clientY);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = g.current;
    if (!d || e.pointerId !== d.id) return;
    d.vt.addEvent(e.nativeEvent, "y");
    const want = d.h0 - (e.clientY - d.y0);
    // Past the smallest size it follows the finger at half speed, on its way to closing.
    d.h = want < MIN_H ? MIN_H - (MIN_H - want) / 2 : Math.min(most(), want);
    size(Math.max(0, d.h));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = g.current;
    if (!d || e.pointerId !== d.id) return;
    g.current = null;
    const v = d.vt.velocity(e.timeStamp); // px/ms, down is positive
    if (d.h < MIN_H - 24 || (v > 1.2 && d.h < d.h0)) { close(d.h, v); return; }
    const to = Math.max(MIN_H, Math.min(most(), d.h));
    setH(to);
    if (to !== d.h) animateSpring(d.h, to, -v, size, () => size(to), GLIDE_SPRING);
  };

  if (!note) return null;
  const page = note.bgColor !== null ? cssColor(note.bgColor) : null;
  return (
    <div ref={box} className="pn-peek" style={{ height: h, ...(page ? { background: page, color: contentColor(page) } : {}) }}>
      <div className="pn-peek-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <span className="pn-peek-handle" aria-hidden="true" />
        <span className="pn-peek-title ellipsis">{titleOf(note)}</span>
        <IconButton icon="fSwapVert" label="Swap: write in this note" onClick={onSwap} />
        <IconButton icon="fClose" label="Close the other note" onClick={() => close(h, 0)} />
      </div>
      <div className="pn-peek-body rich" style={{ fontFamily: FONTS[note.fontFamily] }} dangerouslySetInnerHTML={{ __html: sanitize(note.content) }} />
    </div>
  );
}
