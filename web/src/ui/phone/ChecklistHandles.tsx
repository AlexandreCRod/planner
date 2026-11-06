// Reordering a note's checklist like Google Keep: each checklist line gets a drag handle in the margin
// beside it (outside the text, so typing and selecting text are untouched), and a short hold on a line
// itself lifts it too, on a touch screen (331; lineHold.ts). The handles always show
// (331; 227 hid them until pressed); a pressed (or, with a mouse, pointed-at) line's is stronger, and stays so
// while it's dragged. Drag a handle: the line
// (with the lines indented under it) lifts and follows the finger, the others in its list slide out of
// the way, and on release it settles into its new place. The note's text itself is what changes (its
// paragraphs move), so it's saved and synced like any edit. Which moves are allowed comes from
// domain/checklist.ts (tested in test/checklist.test.ts).
import { useEffect, useRef, useState } from "react";
import { checklistBlock, checklistDepth, checklistRun, checklistSlots } from "../../domain/checklist.ts";
import { MIcon } from "./chrome.tsx";
import { GLIDE_SPRING, animateSpring } from "./motion.ts";
import { feel } from "./haptics.ts";
import { edgeSpeed } from "./selectScroll.ts";
import { suspendOverscroll } from "./overscroll.ts";
import { swallowClick } from "./press.ts";
import { LINE_HOLD, holdsLine, lineHoldMove, slotFor } from "./lineHold.ts";
import { claimSwipe } from "./gesture.ts";
import { keyboardUp } from "./native.ts";

interface Handle { i: number; top: number; h: number }

const linesOf = (root: HTMLElement) => [...root.children] as HTMLElement[];

/** The nearest box above [el] that scrolls up and down. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

export function ChecklistHandles({ editor, host, onChange, onHas }: {
  /** The editable element; [host] is the box the handles are placed in (positioned). */
  editor: () => HTMLElement | null; host: () => HTMLElement | null; onChange: () => void; onHas: (has: boolean) => void;
}) {
  const [handles, setHandles] = useState<Handle[]>([]);
  /** The line whose handle shows (pressed, pointed at, or being dragged). */
  const [shown, setShown] = useState<number | null>(null);
  const handlesRef = useRef(handles);
  handlesRef.current = handles;
  const key = useRef("");
  const dragging = useRef(false);
  const remeasure = useRef<() => void>(() => {});
  const cb = useRef({ onChange, onHas });
  cb.current = { onChange, onHas };

  // Where the checklist lines are: measured (once a frame at most) after any change to the text or its size.
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const root = editor(), box = host();
      if (!root || !box || dragging.current) return;
      const base = box.getBoundingClientRect().top;
      const out: Handle[] = [];
      const lines = linesOf(root);
      const isCheck = (el: HTMLElement | undefined) => !!el && el.tagName === "P" && checklistDepth(el.textContent ?? "") >= 0;
      // A small gap after each run of checkbox lines, as lists have (the class is never saved: RichEditor's normalize).
      lines.forEach((el, i) => { const end = isCheck(el) && !isCheck(lines[i + 1]); if (el.classList.contains("pn-check-end") !== end) el.classList.toggle("pn-check-end", end); });
      // Checkbox lines sit a little in, so their handles are clear of the screen's edge, where Android's back
      // gesture starts (review of 2.10, finding 6). Never saved either.
      lines.forEach((el) => { const c = isCheck(el); if (el.classList.contains("pn-check") !== c) el.classList.toggle("pn-check", c); });
      lines.forEach((el, i) => {
        if (!isCheck(el) || el.classList.contains("pn-folded")) return; // lines folded into "completed" have no handle
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight) || 24;
        // Where the line rests, not where it is mid-glide (a ticked line moving to "completed").
        const glide = cs.transform && cs.transform !== "none" ? new DOMMatrixReadOnly(cs.transform).m42 : 0;
        out.push({ i, top: r.top - glide - base, h: Math.min(r.height, lh) });
      });
      const k = out.map((x) => `${x.i}:${Math.round(x.top)}:${Math.round(x.h)}`).join(",");
      if (k !== key.current) { key.current = k; setHandles(out); cb.current.onHas(out.length > 0); }
    };
    const later = () => { if (!raf) raf = requestAnimationFrame(measure); };
    remeasure.current = later;
    const mo = new MutationObserver(later);
    const ro = new ResizeObserver(later);
    let attached = false;
    const attach = () => {
      const root = editor(), box = host();
      if (!root || !box) return false;
      // Classes too: folding "N done" only changes a class, and a folded line's handle must go with it (its handles
      // show at rest since 331).
      mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
      ro.observe(root);
      ro.observe(box);
      attached = true;
      later();
      return true;
    };
    const t = attach() ? 0 : window.setInterval(() => { if (attach()) clearInterval(t); }, 100);
    return () => { mo.disconnect(); ro.disconnect(); clearInterval(t); cancelAnimationFrame(raf); void attached; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Which handle shows: the line under a finger pressed on the text (or the margin), or under the mouse.
  useEffect(() => {
    let attached: HTMLElement | null = null, t = 0;
    const lineAt = (y: number) => {
      const box = host();
      if (!box) return null;
      const top = box.getBoundingClientRect().top;
      // The whole line, not only its first row (a long one wraps).
      const root = editor();
      const lines = root ? linesOf(root) : [];
      for (const x of handlesRef.current) {
        const r = lines[x.i]?.getBoundingClientRect();
        const a = r ? r.top : top + x.top, b = r ? r.bottom : top + x.top + x.h;
        if (y >= a - 2 && y <= b + 2) return x.i;
      }
      return null;
    };
    const down = (e: PointerEvent) => { if (!dragging.current) setShown(lineAt(e.clientY)); };
    const up = (e: PointerEvent) => { if (!dragging.current && e.pointerType !== "mouse") setShown(null); };
    const move = (e: PointerEvent) => { if (e.pointerType === "mouse" && !dragging.current && !e.buttons) setShown(lineAt(e.clientY)); };
    const leave = (e: PointerEvent) => { if (e.pointerType === "mouse" && !dragging.current) setShown(null); };
    const attach = () => {
      const box = host();
      if (!box) return false;
      attached = box;
      box.addEventListener("pointerdown", down, { passive: true });
      box.addEventListener("pointermove", move, { passive: true });
      box.addEventListener("pointerleave", leave, { passive: true });
      window.addEventListener("pointerup", up, { passive: true });
      window.addEventListener("pointercancel", up, { passive: true });
      return true;
    };
    if (!attach()) t = window.setInterval(() => { if (attach()) clearInterval(t); }, 100);
    return () => {
      clearInterval(t);
      attached?.removeEventListener("pointerdown", down);
      attached?.removeEventListener("pointermove", move);
      attached?.removeEventListener("pointerleave", leave);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (e: React.PointerEvent<HTMLButtonElement>, from: number) => {
    if (e.button !== 0) return;
    if (!lift(e.pointerId, e.clientY, from)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  /**
   * Lifts line [from] (and the lines under it) for pointer [pointerId], which is at [y0]: from its handle at
   * once, or from the line itself after a hold (331). [onEnd] runs once it has settled. False: it can't move.
   */
  const lift = (pointerId: number, y0: number, from: number, onEnd?: () => void): boolean => {
    const root = editor();
    if (!root || dragging.current) return false;
    const lines = linesOf(root);
    const texts = lines.map((l) => l.textContent ?? "");
    const run = checklistRun(texts, from);
    if (!run) return false;
    const [s, last] = checklistBlock(texts, from);
    const dragged = lines.slice(s, last + 1);
    const d = checklistDepth(texts[from]);
    const top0 = dragged[0].getBoundingClientRect().top;
    const h = dragged[dragged.length - 1].getBoundingClientRect().bottom - top0;
    // The run's other lines, in units that move together: a line and the deeper lines under it.
    const units: { els: HTMLElement[]; first: number; top: number; h: number; above: boolean }[] = [];
    for (let i = run[0]; i <= run[1]; i++) {
      if (i >= s && i <= last) continue;
      const el = lines[i];
      const r = el.getBoundingClientRect();
      const prev = units[units.length - 1];
      if (!prev || checklistDepth(texts[i]) <= d || prev.above !== i < s) units.push({ els: [el], first: i, top: r.top, h: r.height, above: i < s });
      else { prev.els.push(el); prev.h = r.bottom - prev.top; }
    }
    const n = dragged.length;
    // Each unit's place once the dragged lines are lifted out (those below move up by h).
    const restTop = units.map((u) => (u.above ? u.top : u.top - h));
    const allowed = new Set(checklistSlots(texts, from));
    // A drop before unit k means landing before this line of the text without the dragged lines.
    const slotOf = (k: number) => (k < units.length ? (units[k].above ? units[k].first : units[k].first - n) : run[1] + 1 - n);
    const k0 = units.filter((u) => u.above).length;
    const minDy = (units.length ? Math.min(top0, ...restTop) : top0) - top0 - 6;
    const maxDy = (units.length ? Math.max(top0 + h, ...units.map((u, i) => restTop[i] + u.h + h)) : top0 + h) - top0 - h + 6;
    // The lifted lines' top decides where they go: a line passes another once it's over that line's middle,
    // so a hold that doesn't move leaves it where it was (331: the finger's own point used to decide, and a
    // finger below a line's middle moved it down a place without moving at all). A tall block (a long line)
    // reaches the top and the bottom alike.
    // Near the top or bottom of the note the page scrolls along, either way; [dy] counts that scrolling too.
    const scroller = scrollParent(root);
    const s0 = scroller?.scrollTop ?? 0;
    let fingerY = y0;
    const clampDy = () => Math.max(minDy, Math.min(maxDy, fingerY - y0 + ((scroller?.scrollTop ?? s0) - s0)));
    let k = k0, raf = 0, dy = 0, scrollRaf = 0;
    dragging.current = true;
    setShown(from);
    feel("pickup");
    for (const el of dragged) el.classList.add("pn-lifted");
    for (const u of units) for (const el of u.els) el.classList.add("pn-sliding");
    const draw = () => {
      raf = 0;
      for (const el of dragged) el.style.transform = `translate3d(0,${dy}px,0)`;
      let nk = slotFor(units.map((u, i) => ({ top: restTop[i], h: u.h })), top0 + dy);
      // Only where the line may go (never between another line and its sub-items).
      while (nk > 0 && !allowed.has(slotOf(nk))) nk--;
      if (nk !== k) { k = nk; feel("tick"); }
      units.forEach((u, ui) => {
        const shift = u.above ? (ui >= k ? h : 0) : (ui < k ? -h : 0);
        for (const el of u.els) el.style.transform = shift ? `translate3d(0,${shift}px,0)` : "";
      });
    };
    const autoScroll = (t: number, last: number) => {
      scrollRaf = 0;
      if (!dragging.current || !scroller) return;
      const r = scroller.getBoundingClientRect();
      const vv = window.visualViewport;
      const top = r.top, bottom = Math.min(r.bottom, vv ? vv.offsetTop + vv.height : innerHeight);
      const speed = edgeSpeed(fingerY, top, bottom) * Math.min(3, Math.max(0.5, (t - last) / 16.7));
      if (speed) {
        const before = scroller.scrollTop;
        scroller.scrollTop = before + speed;
        if (scroller.scrollTop !== before) { const nd = clampDy(); if (nd !== dy) { dy = nd; draw(); } }
      }
      scrollRaf = requestAnimationFrame((n) => autoScroll(n, t));
    };
    scrollRaf = requestAnimationFrame((n) => autoScroll(n, n));
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      fingerY = ev.clientY;
      dy = clampDy();
      if (!raf) raf = requestAnimationFrame(draw);
    };
    // The finger is the line's now: the page doesn't scroll or stretch under it (a held line's finger would
    // otherwise go on to scroll the note).
    const noScroll = (ev: TouchEvent) => { if (ev.cancelable) ev.preventDefault(); };
    document.addEventListener("touchmove", noScroll, { passive: false });
    suspendOverscroll(true);
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.removeEventListener("touchmove", noScroll);
      suspendOverscroll(false);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(scrollRaf);
      draw();
      const shownTop = dragged[0].getBoundingClientRect().top;
      const moved = k !== k0;
      // The paragraphs move in the text; the others are then exactly where they were drawn.
      for (const u of units) for (const el of u.els) { el.classList.remove("pn-sliding"); el.style.transform = ""; }
      for (const el of dragged) el.style.transform = "";
      if (moved) {
        if (k < units.length) units[k].els[0].before(...dragged);
        else { const lu = units[units.length - 1]; lu.els[lu.els.length - 1].after(...dragged); }
      }
      // The lifted line glides the rest of the way into its place.
      const off = shownTop - dragged[0].getBoundingClientRect().top;
      const settle = (x: number) => { for (const el of dragged) el.style.transform = Math.abs(x) > 0.05 ? `translate3d(0,${x}px,0)` : ""; };
      settle(off);
      animateSpring(off, 0, 0, settle, () => {
        for (const el of dragged) el.classList.remove("pn-lifted");
        dragging.current = false;
        setShown(null);
        key.current = "";
        remeasure.current();
        if (moved) cb.current.onChange();
        onEnd?.();
      }, GLIDE_SPRING);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return true;
  };
  const liftRef = useRef(lift);
  liftRef.current = lift;

  // A short hold on a checkbox line itself lifts it too (331): the one hold time, then the finger drags it as
  // the handle would. Until then nothing changes, so a tap places the cursor and a double or triple tap selects
  // a word or the line, as anywhere in the note. The browser's own long press (select a word, its menu) is
  // kept off these lines: the press menu is dropped, and a selection it makes anyway is put back as it was.
  useEffect(() => {
    let root: HTMLElement | null = null, t = 0;
    let h: { id: number; x: number; y: number; line: HTMLElement; i: number; timer: number; saved: Range | null; held: boolean } | null = null;
    // The browser's own long press comes a moment after the hold time (Chrome: about 100 ms later). On the
    // note's text it would select a word or, in a note being typed in, take the finger for its cursor handle
    // and cancel the drag. So once the line is lifted, a clear cover lies over the text: the long press lands
    // on that (nothing to select), and the finger stays the line's. If the long press takes the focus from
    // the note while the keyboard is up, it's given straight back (the keyboard stays up).
    let shield: HTMLElement | null = null, typing = false;
    const keep = () => {
      if (!shield || !typing || !root) return;
      root.focus({ preventScroll: true });
      restore();
    };
    const cover = () => {
      const box = host();
      if (!box || !root) return;
      typing = document.activeElement === root && keyboardUp();
      shield = document.createElement("div");
      shield.className = "pn-shield";
      shield.addEventListener("contextmenu", (e) => e.preventDefault());
      box.appendChild(shield);
      root.addEventListener("blur", keep);
    };
    const uncover = () => {
      shield?.remove();
      shield = null;
      root?.removeEventListener("blur", keep);
    };
    const done = () => {
      if (!h) return;
      clearTimeout(h.timer);
      uncover();
      h = null;
    };
    /** Puts the selection (the cursor, or what was selected) back as it was when the finger went down. */
    const restore = () => {
      const sel = getSelection();
      if (!h || !sel) return;
      const now = sel.rangeCount ? sel.getRangeAt(0) : null, was = h.saved;
      if (!was) { if (now && !now.collapsed) sel.removeAllRanges(); return; }
      if (now && now.startContainer === was.startContainer && now.startOffset === was.startOffset
        && now.endContainer === was.endContainer && now.endOffset === was.endOffset) return;
      sel.removeAllRanges();
      sel.addRange(was);
    };
    const down = (e: PointerEvent) => {
      done();
      if (!root) return;
      let line = e.target instanceof Node ? (e.target instanceof HTMLElement ? e.target : e.target.parentElement) : null;
      while (line && line.parentElement !== root) line = line.parentElement;
      const i = line ? linesOf(root).indexOf(line) : -1;
      if (!line || !holdsLine({
        pointerType: e.pointerType, primary: e.isPrimary, checkLine: handlesRef.current.some((x) => x.i === i),
        folded: line.classList.contains("pn-folded"), dragging: dragging.current,
      })) return;
      const sel = getSelection();
      const saved = sel && sel.rangeCount && root.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
      const me = { id: e.pointerId, x: e.clientX, y: e.clientY, line, i, timer: 0, saved, held: false };
      me.timer = window.setTimeout(() => {
        if (h !== me) return;
        me.held = true;
        restore();
        cover();
        claimSwipe(me.id);
        swallowClick(600);
        if (!liftRef.current(me.id, me.y, me.i, () => { if (h === me) done(); })) done();
      }, LINE_HOLD);
      h = me;
    };
    const move = (e: PointerEvent) => {
      if (h && !h.held && e.pointerId === h.id && lineHoldMove(h.x, h.y, e.clientX, e.clientY) === "off") done();
    };
    const up = (e: PointerEvent) => { if (h && !h.held && e.pointerId === h.id) done(); };
    const menu = (e: Event) => { if (h) e.preventDefault(); };
    const selChange = () => { if (h?.held) restore(); };
    const attach = () => {
      root = editor();
      if (!root) return false;
      root.addEventListener("pointerdown", down, { passive: true });
      root.addEventListener("contextmenu", menu);
      window.addEventListener("pointermove", move, { passive: true });
      window.addEventListener("pointerup", up, { passive: true });
      window.addEventListener("pointercancel", up, { passive: true });
      document.addEventListener("selectionchange", selChange);
      return true;
    };
    if (!attach()) t = window.setInterval(() => { if (attach()) clearInterval(t); }, 100);
    return () => {
      clearInterval(t);
      done();
      root?.removeEventListener("pointerdown", down);
      root?.removeEventListener("contextmenu", menu);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.removeEventListener("selectionchange", selChange);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!handles.length) return null;
  return (
    <div className="pn-handles">
      {handles.map((x) => (
        <button key={x.i} className={`pn-handle ${shown === x.i ? "on" : ""}`} style={{ top: x.top + x.h / 2 - 16 }} aria-label="Drag to reorder" tabIndex={-1}
          onPointerDown={(e) => start(e, x.i)} onContextMenu={(e) => e.preventDefault()}>
          <MIcon name="fDragIndicator" size={18} />
        </button>
      ))}
    </div>
  );
}
