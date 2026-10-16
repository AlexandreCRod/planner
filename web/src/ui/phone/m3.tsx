// More Material 3 pieces for the phone, sized as Compose draws them (1 CSS px = 1 dp): switches, list
// items, assist chips, buttons, outlined text fields, the modal bottom sheet, the snackbar, and the
// small dialogs the editors open (a line of text, a colour). Styles are in phone.css under "M3 pieces".
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cssColor } from "../../domain/types.ts";
import { Dialog, MIcon } from "./chrome.tsx";
import { pushBack } from "./native.ts";
import { spring } from "./pager.ts";
import { sheetCloses } from "./sheet.ts";
import { TOUCH_SLOP } from "./press.ts";

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
export const PALETTE = [
  0xffef5350, 0xffec407a, 0xffab47bc, 0xff7e57c2, 0xff5c6bc0, 0xff42a5f5,
  0xff29b6f6, 0xff26c6da, 0xff26a69a, 0xff66bb6a, 0xff9ccc65, 0xffd4e157,
  0xffffee58, 0xffffca28, 0xffffa726, 0xffff7043, 0xff8d6e63, 0xff78909c,
].map((c) => c | 0);

/** Colour circles (36 dp, 8 apart), "none" first when allowed, a tick on the chosen one (ColorGrid). */
export function ColorGrid({ colors, selected, allowNone = true, onPick }: { colors: number[]; selected: number | null; allowNone?: boolean; onPick: (c: number | null) => void }) {
  return (
    <div className="p-colorgrid">
      {allowNone && <button className="none" aria-label="None" onClick={() => onPick(null)}><MIcon name="fFormatColorReset" size={18} /></button>}
      {colors.map((c) => {
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
 * Material 3 modal bottom sheet: slides up over a scrim, 28 dp top corners, a drag handle. Dragged
 * by its top it follows the finger and closes when let go far enough down (or flung); back, a tap on
 * the scrim and the content's own buttons (through the `close` it is given) close it with the slide.
 */
export function BottomSheet({ onClose, children, className = "" }: { onClose: () => void; children: (close: () => void) => ReactNode; className?: string }) {
  const sheet = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useRef(() => {
    if (closing.current) return;
    closing.current = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const el = sheet.current;
    if (!el) { onCloseRef.current(); return; }
    el.style.transition = "transform .2s cubic-bezier(.3, 0, .8, .15)";
    el.style.transform = `translate3d(0,${el.offsetHeight + 24}px,0)`;
    if (scrim.current) { scrim.current.style.transition = "opacity .2s linear"; scrim.current.style.opacity = "0"; }
    window.setTimeout(() => onCloseRef.current(), 200);
  }).current;
  useEffect(() => pushBack(close), [close]);

  // Dragging the top of the sheet.
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el) return;
    let g: { id: number; y0: number; dy: number; v: number; lastY: number; lastT: number; moving: boolean } | null = null;
    let stop: (() => void) | null = null;
    const place = (y: number) => { el.style.transform = y > 0 ? `translate3d(0,${y}px,0)` : ""; };
    const onDown = (e: PointerEvent) => {
      if (closing.current || g || !(e.target as Element).closest(".p-sheet-top")) return;
      stop?.(); stop = null;
      el.style.transition = "";
      g = { id: e.pointerId, y0: e.clientY, dy: 0, v: 0, lastY: e.clientY, lastT: e.timeStamp, moving: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const dt = e.timeStamp - g.lastT;
      if (dt > 0) { g.v = 0.7 * ((e.clientY - g.lastY) / dt) + 0.3 * g.v; g.lastT = e.timeStamp; }
      g.lastY = e.clientY;
      if (!g.moving && Math.abs(e.clientY - g.y0) <= TOUCH_SLOP) return;
      if (!g.moving) {
        g.moving = true; g.y0 += Math.sign(e.clientY - g.y0) * TOUCH_SLOP;
        try { el.setPointerCapture(e.pointerId); } catch { /* gone */ }
      }
      g.dy = Math.max(0, e.clientY - g.y0);
      place(g.dy);
    };
    const onUp = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const cur = g;
      g = null;
      if (!cur.moving) return;
      if (sheetCloses(cur.dy, el.offsetHeight, e.type === "pointercancel" ? 0 : cur.v)) close();
      else stop = spring(cur.dy, 0, cur.v, place, () => { stop = null; });
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      stop?.();
      el.removeEventListener("pointerdown", onDown);
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

interface Snack { id: number; text: string; action?: string; onAction?: () => void; ms: number }
let snack: Snack | null = null;
let snackId = 0;
const snackListeners = new Set<() => void>();
const setSnack = (s: Snack | null) => { snack = s; snackListeners.forEach((l) => l()); };

/**
 * Shows a message at the bottom, with an optional action (Undo). Like the native one: 4 s on its own,
 * 10 s (SnackbarDuration.Long) with an action, which also gets a close button.
 */
export function showSnackbar(text: string, action?: string, onAction?: () => void) {
  setSnack({ id: ++snackId, text, action, onAction, ms: action ? 10000 : 4000 });
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
      {s.action && <button className="p-snack-action" onClick={() => { s.onAction?.(); setSnack(null); }}>{s.action}</button>}
      {s.action && <button className="p-icon p-snack-close" aria-label="Dismiss" onClick={() => setSnack(null)}><MIcon name="fClose" /></button>}
    </div>
  );
}
