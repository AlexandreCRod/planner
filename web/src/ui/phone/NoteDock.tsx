// A note left open while another page is shown: going to another page from a note shrinks it into a
// chip that floats above the bottom bar on every page. A tap on the chip brings the note back exactly as
// it was (it stayed open underneath: caret, scroll and all); sliding the chip sideways closes the note
// (saved, as leaving it always is), as does its ✕.
import { useRef } from "react";
import { formatDate } from "../../domain/dates.ts";
import { cssColor } from "../../domain/types.ts";
import { useSnapshot } from "../../store/store.ts";
import { MIcon } from "./chrome.tsx";
import { feel } from "./haptics.ts";
import { GLIDE_SPRING, VelocityTracker, animateSpring } from "./motion.ts";
import { TOUCH_SLOP, swallowClick } from "./press.ts";

/** The note's id in a route like "#/note/12?day=…" (0: a new note not saved yet). */
export const noteIdOf = (hash: string) => Number(/^#\/note\/(\d+)/.exec(hash)?.[1] ?? 0);

export function NoteChip({ hash, onOpen, onClose }: { hash: string; onOpen: () => void; onClose: () => void }) {
  const s = useSnapshot();
  const note = s.byId.get(noteIdOf(hash));
  const title = note ? (note.title.trim() || (note.noteDay !== null ? formatDate(note.noteDay) : "") || "Untitled note") : "New note";
  const dot = note?.bgColor != null ? cssColor(note.bgColor) : note?.color != null ? cssColor(note.color) : null;
  const el = useRef<HTMLDivElement>(null);
  const g = useRef<{ id: number; x0: number; y0: number; dx: number; sliding: boolean; vt: VelocityTracker } | null>(null);
  const gone = useRef(false);

  const draw = (x: number) => {
    const c = el.current;
    if (!c) return;
    const w = c.offsetWidth || 1;
    c.style.transform = x ? `translate3d(${x}px,0,0)` : "";
    c.style.opacity = String(Math.max(0, 1 - Math.abs(x) / (w * 0.9)));
  };
  const close = (from: number, v: number) => {
    if (gone.current) return;
    gone.current = true;
    feel("confirm");
    const w = (el.current?.offsetWidth ?? 300) * 1.2;
    const to = (from || v) < 0 ? -w : w;
    animateSpring(from, to, v, draw, onClose, { ...GLIDE_SPRING, damping: 1 });
  };

  const onDown = (e: React.PointerEvent) => {
    if (g.current || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, sliding: false, vt: new VelocityTracker() };
    g.current.vt.add(e.timeStamp, e.clientX);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = g.current;
    if (!d || e.pointerId !== d.id) return;
    d.vt.addEvent(e.nativeEvent, "x");
    const dx = e.clientX - d.x0;
    if (!d.sliding) {
      if (Math.abs(dx) <= TOUCH_SLOP) return;
      if (Math.abs(e.clientY - d.y0) > Math.abs(dx)) { g.current = null; return; }
      d.sliding = true;
      d.x0 += Math.sign(dx) * TOUCH_SLOP;
      try { el.current?.setPointerCapture(e.pointerId); } catch { /* a pointer already gone */ }
    }
    d.dx = e.clientX - d.x0;
    draw(d.dx);
  };
  const onUp = (e: React.PointerEvent) => {
    const d = g.current;
    if (!d || e.pointerId !== d.id) return;
    g.current = null;
    if (!d.sliding) return; // a tap: the click opens it
    swallowClick(400);
    const v = d.vt.velocity(e.timeStamp);
    const w = el.current?.offsetWidth ?? 300;
    // Far enough, or flung that way: closed; otherwise it springs back.
    if (Math.abs(d.dx) > w * 0.35 || (Math.abs(v) > 0.6 && Math.sign(v) === Math.sign(d.dx))) close(d.dx, v);
    else animateSpring(d.dx, 0, v, draw, () => draw(0), GLIDE_SPRING);
  };

  return (
    <div className="p-notechip-place">
      <div ref={el} className="p-notechip" role="button" tabIndex={0} aria-label={`Open ${title}`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onClick={() => { if (!gone.current) onOpen(); }} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}>
        <span className="p-notechip-dot" style={dot ? { background: dot } : undefined} />
        <span className="p-notechip-title">{title}</span>
        <button className="p-icon p-notechip-x" aria-label="Close note" onClick={(e) => { e.stopPropagation(); close(0, 0.001); }}>
          <MIcon name="fClose" size={20} />
        </button>
      </div>
    </div>
  );
}
