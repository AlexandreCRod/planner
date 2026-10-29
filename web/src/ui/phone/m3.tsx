// More Material 3 pieces for the phone, sized as Compose draws them (1 CSS px = 1 dp): switches, list
// items, assist chips, buttons, outlined text fields, the modal bottom sheet, the snackbar, and the
// small dialogs the editors open (a line of text, a colour). Styles are in phone.css under "M3 pieces".
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cssColor } from "../../domain/types.ts";
import { Dialog, MIcon } from "./chrome.tsx";
import { pushBack } from "./native.ts";
import { spring } from "./pager.ts";
import { SHEET_DISTANCE, SHEET_FLING, bodyDragStart, sheetCloses } from "./sheet.ts";
import { LONG_PRESS, TOUCH_SLOP } from "./press.ts";
import { frameWriter } from "./motion.ts";
import { isWide } from "../../platform.ts";

/** Material 3 switch: a 52×32 track; the thumb grows from 16 to 24 dp and slides across when on. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`p-switch ${checked ? "on" : ""}`}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}>
      <span className="thumb" />
    </button>
  );
}

/**
 * Material 3 list item: headline in bodyLarge, supporting text in bodyMedium (onSurfaceVariant), an
 * optional leading icon and trailing content; 56 dp tall with one line, 72 with two.
 */
export function ListItem({ headline, supporting, leading, trailing, onClick, className = "" }: {
  headline: ReactNode; supporting?: ReactNode; leading?: ReactNode; trailing?: ReactNode; onClick?: () => void; className?: string;
}) {
  const body = <>
    {leading && <span className="lead">{leading}</span>}
    <span className="text">
      <span className="headline">{headline}</span>
      {supporting && <span className="supporting">{supporting}</span>}
    </span>
    {trailing && <span className="trail">{trailing}</span>}
  </>;
  const cls = `p-li ${supporting ? "two" : ""} ${className}`;
  return onClick ? <div className={cls} role="button" onClick={onClick}>{body}</div> : <div className={cls}>{body}</div>;
}

/** Material 3 assist chip: 32 dp, 8 dp corners, outlined, an 18 dp leading icon in primary. */
export function AssistChip({ icon, label, onClick, iconColor }: { icon: string; label: ReactNode; onClick: () => void; iconColor?: string }) {
  return (
    <button className="p-assist" onClick={onClick}>
      <MIcon name={icon} size={18} color={iconColor} />
      <span>{label}</span>
    </button>
  );
}

export function TextButton({ children, onClick, disabled, className = "" }: { children: ReactNode; onClick: () => void; disabled?: boolean; className?: string }) {
  return <button className={`p-text-btn ${className}`} disabled={disabled} onClick={onClick}>{children}</button>;
}

export function OutlinedButton({ children, onClick, disabled, danger }: { children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return <button className={`p-outlined-btn ${danger ? "danger" : ""}`} disabled={disabled} onClick={onClick}>{children}</button>;
}

/** Extended floating action button, bottom right (primaryContainer, 16 dp corners), as the native view's Edit. */
export function ExtendedFab({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return <button className="p-xfab" onClick={onClick}><MIcon name={icon} /><span>{label}</span></button>;
}

/** Material 3 outlined text field with its label resting in the field until it has focus or text. */
export function OutlinedTextField({ label, value, onChange, autoFocus, type = "text", onEnter, inputMode }: {
  label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; type?: string; onEnter?: () => void;
  inputMode?: "text" | "url" | "email";
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) { const t = window.setTimeout(() => ref.current?.focus(), 60); return () => clearTimeout(t); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="p-tf">
      <input ref={ref} type={type} value={value} placeholder=" " inputMode={inputMode} enterKeyHint="done" autoCapitalize={type === "text" && inputMode !== "url" ? "sentences" : "off"}
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onEnter?.(); }} />
      <span className="p-tf-label">{label}</span>
    </label>
  );
}

/** One line of text to change (a title, tags), in a dialog that opens with the keyboard up. */
export function TextFieldDialog({ title, label, initial, onSave, onClose, saveLabel = "Save" }: {
  title: string; label: string; initial: string; onSave: (v: string) => void; onClose: () => void; saveLabel?: string;
}) {
  const [text, setText] = useState(initial);
  const save = () => { onSave(text); onClose(); };
  return (
    <Dialog title={title} onClose={onClose} actions={<>
      <TextButton onClick={onClose}>Cancel</TextButton>
      <TextButton onClick={save}>{saveLabel}</TextButton>
    </>}>
      <OutlinedTextField label={label} value={text} onChange={setText} autoFocus onEnter={save} />
    </Dialog>
  );
}

/** The native palette (Common.kt `palette`), as signed ARGB ints. */
/**
 * The colours to pick from (categories, notes, text): 24 mid tones a step apart in hue or lightness, so
 * no two look alike, and each reads on the light and the dark background.
 */
export const PALETTE = [
  0xffe53935, 0xffd81b60, 0xfff48fb1, 0xff8e24aa, 0xff7e57c2, 0xffb39ddb,
  0xff3f51b5, 0xff1e88e5, 0xff4fc3f7, 0xff00acc1, 0xff00897b, 0xff81c784,
  0xff43a047, 0xff9ccc65, 0xffc0ca33, 0xfffdd835, 0xffffb300, 0xfffb8c00,
  0xfff4511e, 0xffff8a65, 0xff8d6e63, 0xffbcaaa4, 0xff78909c, 0xff757575,
].map((c) => c | 0);

/** Colour circles (36 dp, 8 apart), "none" first when allowed, a tick on the chosen one (ColorGrid). */
export function ColorGrid({ colors, selected, allowNone = true, onPick }: { colors: number[]; selected: number | null; allowNone?: boolean; onPick: (c: number | null) => void }) {
  return (
    <div className="p-colorgrid">
      {allowNone && <button className="none" aria-label="None" onClick={() => onPick(null)}><MIcon name="fFormatColorReset" size={18} /></button>}
      {/* A colour chosen before the palette changed stays offered (first), ticked. */}
      {(selected !== null && !colors.includes(selected) ? [selected, ...colors] : colors).map((c) => {
        const css = cssColor(c);
        return (
          <button key={c} aria-label={css} className={c === selected ? "on" : ""} style={{ background: css }} onClick={() => onPick(c)}>
            {c === selected && <MIcon name="fCheck" size={18} color={contentColor(css)} />}
          </button>
        );
      })}
    </div>
  );
}

export function ColorPickerDialog({ title, colors = PALETTE, selected, allowNone = true, onPick, onClose }: {
  title: string; colors?: number[]; selected: number | null; allowNone?: boolean; onPick: (c: number | null) => void; onClose: () => void;
}) {
  return (
    <Dialog title={title} onClose={onClose} actions={<TextButton onClick={onClose}>Close</TextButton>}>
      <ColorGrid colors={colors} selected={selected} allowNone={allowNone} onPick={(c) => { onPick(c); onClose(); }} />
    </Dialog>
  );
}

/** Compose's Color.contentColor(): dark text on light colours. */
export function contentColor(c: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) > 0.5 ? "#1c1b1f" : "#fff";
}

// ---------- Modal bottom sheet ----------

/**
 * Whether a finger put down on [t], in [sheet]'s content, may pull the sheet down (274): not from a field
 * that takes the finger itself (text, a slider), nor a part with its own drags (touch-action none or
 * sideways only: wheels, steppers, the time dial), nor from inside content scrolled down (it scrolls
 * back up first). `.p-sheet-nodrag` opts a part out.
 */
function dragFromHere(t: Element, sheet: Element): boolean {
  for (let n: Element | null = t; n && n !== sheet; n = n.parentElement) {
    if (n.matches("textarea, select, input[type=range], [contenteditable=''], [contenteditable=true], .p-sheet-nodrag")) return false;
    const cs = getComputedStyle(n);
    const ta = cs.touchAction;
    if (ta === "none" || (ta.includes("pan-x") && !ta.includes("pan-y"))) return false;
    if (n.scrollTop > 0 && /auto|scroll/.test(cs.overflowY)) return false;
  }
  return true;
}

/**
 * Material 3 modal bottom sheet: slides up over a scrim, 28 dp top corners, a drag handle. Dragged
 * by its top, or pulled down from anywhere on it while its content is scrolled to the top (274), it
 * follows the finger and closes when let go far enough down (or flung); back, a tap on
 * the scrim and the content's own buttons (through the `close` it is given) close it with the slide.
 * In a wide window it's a dialog in the middle instead (wide.css): it fades out, and has no drag.
 * A sheet that stops halfway (an exercise's guide) takes [onPullUp] (pushed up from its top, or from any
 * .p-sheet-drag part: it grows) and [onPullDown] (let go far enough down: true keeps it open, smaller).
 */
export function BottomSheet({ onClose, children, className = "", onPullUp, onPullDown }: {
  onClose: () => void; children: (close: () => void) => ReactNode; className?: string;
  onPullUp?: () => void; onPullDown?: () => boolean;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pullUp = useRef(onPullUp);
  pullUp.current = onPullUp;
  const pullDown = useRef(onPullDown);
  pullDown.current = onPullDown;
  const close = useRef(() => {
    if (closing.current) return;
    closing.current = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const el = sheet.current;
    if (!el) { onCloseRef.current(); return; }
    const wide = isWide();
    if (wide) {
      el.style.transition = "opacity .15s linear, transform .15s cubic-bezier(.3, 0, .8, .15)";
      el.style.opacity = "0";
      el.style.transform = "scale(.96)";
    } else {
      el.style.transition = "transform .2s cubic-bezier(.3, 0, .8, .15)";
      el.style.transform = `translate3d(0,${el.offsetHeight + 24}px,0)`;
    }
    if (scrim.current) { scrim.current.style.transition = `opacity ${wide ? ".15s" : ".2s"} linear`; scrim.current.style.opacity = "0"; }
    window.setTimeout(() => onCloseRef.current(), wide ? 150 : 200);
  }).current;
  useEffect(() => pushBack(close), [close]);

  // Dragging the top of the sheet.
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el) return;
    // [body]: put down on the content, not the handle: it pulls the sheet only downwards (bodyDragStart).
    let g: { id: number; x0: number; y0: number; dy: number; v: number; lastY: number; lastT: number; t0: number; moving: boolean; body: boolean } | null = null;
    // A pull that moved the sheet isn't a tap on what it started on.
    let eatClick = false;
    let stop: (() => void) | null = null;
    // The sheet's height, measured once per drag; the scrim fades as the sheet goes down.
    let h = 0;
    const place = (y: number) => {
      el.style.transform = y > 0 ? `translate3d(0,${y}px,0)` : "";
      const sc = scrim.current;
      if (sc && h) sc.style.opacity = y > 0 ? String(Math.max(0, 1 - y / h)) : "";
    };
    // Moves come faster than frames: the sheet is moved once a frame, to the latest.
    const write = frameWriter(place);
    const onDown = (e: PointerEvent) => {
      eatClick = false;
      if (closing.current || g || isWide() || !e.isPrimary) return;
      const t = e.target as Element;
      const body = !t.closest(".p-sheet-top, .p-sheet-drag");
      // From the content: by finger only (a mouse there selects text), and where nothing else takes it.
      if (body && (e.pointerType === "mouse" || !dragFromHere(t, el))) return;
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dy: 0, v: 0, lastY: e.clientY, lastT: e.timeStamp, t0: e.timeStamp, moving: false, body };
      if (!body) { stop?.(); stop = null; el.style.transition = ""; }
    };
    const onMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const dt = e.timeStamp - g.lastT;
      if (dt > 0) { g.v = 0.7 * ((e.clientY - g.lastY) / dt) + 0.3 * g.v; g.lastT = e.timeStamp; }
      g.lastY = e.clientY;
      if (!g.moving && g.body) {
        const how = bodyDragStart(e.clientX - g.x0, e.clientY - g.y0, e.timeStamp - g.t0, TOUCH_SLOP, LONG_PRESS);
        if (how === "wait") return;
        if (how === "leave") { g = null; return; }
        stop?.(); stop = null; el.style.transition = "";
      }
      if (!g.moving && Math.abs(e.clientY - g.y0) <= TOUCH_SLOP) return;
      if (!g.moving) {
        g.moving = true; eatClick = true; g.y0 += Math.sign(e.clientY - g.y0) * TOUCH_SLOP;
        h = el.offsetHeight + 24;
        if (scrim.current) scrim.current.style.transition = "none";
        try { el.setPointerCapture(e.pointerId); } catch { /* gone */ }
      }
      // Pushed up: a sheet that can grow does (its own height animates); the drag ends there.
      if (pullUp.current && !g.body && e.clientY - g.y0 < -24) {
        g = null;
        write.cancel();
        place(0);
        if (scrim.current) scrim.current.style.transition = "";
        pullUp.current();
        return;
      }
      g.dy = Math.max(0, e.clientY - g.y0);
      write(g.dy);
    };
    const onUp = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const cur = g;
      g = null;
      if (!cur.moving) return;
      write.cancel();
      const v = e.type === "pointercancel" ? 0 : cur.v;
      const settle = () => { stop = spring(cur.dy, 0, v, place, () => { stop = null; if (scrim.current) scrim.current.style.transition = ""; }); };
      if (pullUp.current && !cur.body && v < -SHEET_FLING && cur.dy < SHEET_DISTANCE) { settle(); pullUp.current(); return; }
      if (sheetCloses(cur.dy, h - 24, v) && pullDown.current?.()) { settle(); return; }
      if (sheetCloses(cur.dy, h - 24, v)) {
        // Off it goes, carrying on at the finger's speed; it's closed once it's out of sight.
        closing.current = true;
        (document.activeElement as HTMLElement | null)?.blur?.();
        let gone = false;
        const away = () => { if (!gone) { gone = true; onCloseRef.current(); } };
        stop = spring(cur.dy, h, Math.max(0, v), (y) => { place(y); if (y >= h - 1) away(); }, away);
      } else stop = spring(cur.dy, 0, v, place, () => { stop = null; if (scrim.current) scrim.current.style.transition = ""; });
    };
    // The content's own scrolling would take a pull down from it (and cancel the pointer): while the finger
    // goes down from a place that may pull the sheet, the browser doesn't scroll.
    const onTouchMove = (e: TouchEvent) => {
      if (!g || !g.body || !e.cancelable) return;
      const f = e.touches[0];
      if (!f) return;
      const dx = f.clientX - g.x0, dy = f.clientY - g.y0;
      if (g.moving || (dy > 0 && dy >= Math.abs(dx) * 1.2)) e.preventDefault();
    };
    const onClick = (e: MouseEvent) => { if (eatClick) { eatClick = false; e.stopPropagation(); e.preventDefault(); } };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("click", onClick, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      stop?.();
      write.cancel();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("click", onClick, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [close]);

  return (
    <div className="p-sheet-root">
      <div className="p-sheet-scrim" ref={scrim} onClick={close} />
      <div className={`p-sheet ${className}`} ref={sheet} role="dialog">
        <div className="p-sheet-top"><span className="p-sheet-handle" /></div>
        <div className="p-sheet-body">{children(close)}</div>
      </div>
    </div>
  );
}

/** Cancel / Save at the bottom of a small editor sheet (ItemViewScreen's SheetButtons). */
export function SheetButtons({ onCancel, onSave, enabled = true }: { onCancel: () => void; onSave: () => void; enabled?: boolean }) {
  return (
    <div className="p-sheet-buttons">
      <TextButton onClick={onCancel}>Cancel</TextButton>
      <button className="p-filled-btn" disabled={!enabled} onClick={onSave}>Save</button>
    </div>
  );
}

// ---------- Snackbar ----------

interface Snack { id: number; text: string; action?: string; onAction?: () => void; onGone?: () => void; ms: number }
let snack: Snack | null = null;
let snackId = 0;
const snackListeners = new Set<() => void>();
/** Replacing or hiding a snackbar whose action wasn't taken tells it (onGone): a held-back delete then happens. */
const setSnack = (s: Snack | null, acted = false) => {
  const prev = snack;
  snack = s;
  snackListeners.forEach((l) => l());
  if (prev && prev !== s && !acted) prev.onGone?.();
};

/**
 * Shows a message at the bottom, with an optional action (Undo). Like the native one: 4 s on its own,
 * 10 s (SnackbarDuration.Long) with an action, which also gets a close button.
 */
export function showSnackbar(text: string, action?: string, onAction?: () => void, opts: { ms?: number; onGone?: () => void } = {}) {
  setSnack({ id: ++snackId, text, action, onAction, onGone: opts.onGone, ms: opts.ms ?? (action ? 10000 : 4000) });
}

/** Where snackbars appear: above the bottom bar, or near the bottom edge over a full-screen page. */
export function SnackbarHost({ raised }: { raised: boolean }) {
  const s = useSyncExternalStore((l) => { snackListeners.add(l); return () => { snackListeners.delete(l); }; }, () => snack);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!s) return;
    setLeaving(false);
    const t1 = window.setTimeout(() => setLeaving(true), s.ms);
    const t2 = window.setTimeout(() => { if (snack?.id === s.id) setSnack(null); }, s.ms + 150);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [s]);
  if (!s) return null;
  return (
    <div className={`p-snackbar ${raised ? "raised" : ""} ${leaving ? "out" : ""}`} key={s.id} role="status">
      <span className="grow">{s.text}</span>
      {s.action && <button className="p-snack-action" onClick={() => { setSnack(null, true); s.onAction?.(); }}>{s.action}</button>}
      {s.action && <button className="p-icon p-snack-close" aria-label="Dismiss" onClick={() => setSnack(null)}><MIcon name="fClose" /></button>}
    </div>
  );
}
