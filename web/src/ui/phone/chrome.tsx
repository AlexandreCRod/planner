// Shared phone chrome, drawn like the native app's Material 3 Compose pieces: the top app bar, icon
// buttons, filter chips, segmented buttons, section headers, list rows, menus and dialogs. Sizes are
// Compose's (1 CSS px = 1 dp) and text uses the M3 type scale classes in phone.css (.t-title-large...).
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { go } from "../shared/common.tsx";
import { ICONS, ICON_STROKES } from "./icons.ts";
import { pushBack } from "./native.ts";
import { type Animation, PAGE_SPRING, animateSpring } from "./motion.ts";
import { trainingTabIcon } from "./trainingParts.tsx";

/** Older short names used around the phone code, mapped to the Compose icons. */
const ALIAS: Record<string, string> = {
  arrowLeft: "fKeyboardArrowLeft", arrowRight: "fKeyboardArrowRight", back: "fArrowBack", forward: "fArrowForward",
  search: "oSearch", settings: "oSettings", today: "oToday", add: "fAdd", editNote: "oEditNote",
};

/**
 * A Material icon (Compose's own path data), 24 dp unless told otherwise, in the current text colour; a few
 * drawn ones add round-capped lines (ICON_STROKES).
 */
export function MIcon({ name, size = 24, color }: { name: string; size?: number; color?: string }) {
  const key = ALIAS[name] ?? name;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="p-svg" style={color ? { color } : undefined}>
      <path d={ICONS[key] ?? ""} fill="currentColor" />
      {ICON_STROKES[key]?.map(([d, w], i) => <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
  );
}

/** Material 3 icon button: a 48 dp touch target with a 40 dp circular state layer. */
export function IconButton({ icon, label, onClick, className = "", children, disabled }: {
  icon?: string; label: string; onClick: () => void; className?: string; children?: ReactNode; disabled?: boolean;
}) {
  return <button className={`p-icon ${className}`} aria-label={label} onClick={onClick} disabled={disabled}>{children ?? <MIcon name={icon!} />}</button>;
}

/**
 * Whether the text being edited has something to undo or redo (the browser's own edit history), read
 * again after every edit, caret move and undo/redo, so the buttons can show they'd do nothing.
 */
export function useUndoState(): { undo: boolean; redo: boolean } {
  const read = () => {
    const q = (c: string) => { try { return document.queryCommandEnabled(c); } catch { return false; } };
    return { undo: q("undo"), redo: q("redo") };
  };
  const [st, setSt] = useState(read);
  useEffect(() => {
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setSt((o) => { const n = read(); return n.undo === o.undo && n.redo === o.redo ? o : n; })); };
    const evs = ["input", "selectionchange", "focusin", "focusout", "click"] as const;
    evs.forEach((e) => document.addEventListener(e, on, true));
    return () => { cancelAnimationFrame(raf); evs.forEach((e) => document.removeEventListener(e, on, true)); };
  }, []);
  return st;
}

/**
 * Material 3 small top app bar (64 dp): an optional back arrow, the title (titleLarge, 16 dp in, or
 * after the arrow), then the actions. [title] may be any node (Search puts its field there).
 */
export function TopAppBar({ title, back, actions, tall, className = "", navIcon }: {
  title: ReactNode; back?: boolean; actions?: ReactNode; tall?: boolean; className?: string; navIcon?: ReactNode;
}) {
  return (
    <header className={`p-appbar ${tall ? "tall" : ""} ${className}`}>
      {navIcon ?? (back && <IconButton icon="fArrowBack" label="Back" onClick={() => history.back()} />)}
      <div className={`p-appbar-title ${back || navIcon ? "" : "inset"}`}>{title}</div>
      {actions}
    </header>
  );
}

/** A page: the top app bar with search and settings (or a back arrow), then its scrolling content. */
export function Scaffold({ title, children, flush, back, actions, bar }: {
  title: ReactNode; children: ReactNode; flush?: boolean; back?: boolean; actions?: ReactNode;
  /** Shown instead of the top app bar (the selection bar while picking notes). */
  bar?: ReactNode;
}) {
  return (
    <div className="p-scaffold">
      {bar ?? <TopAppBar title={title} back={back} actions={actions ?? (back ? null : <AppBarActions />)} />}
      <div className={`p-content ${flush ? "flush" : ""}`}>{children}</div>
    </div>
  );
}

/** Opens Search with the filters of the page it's opened from (from Notes, Notes). */
export function openSearch() {
  const page = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] || "today";
  go(`browse?from=${encodeURIComponent(page)}`);
}

export function AppBarActions() {
  return <>
    <IconButton icon="oSearch" label="Search and browse" onClick={openSearch} />
    <IconButton icon="oSettings" label="Settings" onClick={() => go("settings")} />
  </>;
}

/** Material 3 filter chip: 32 dp, 8 dp corners, outlined until picked, then secondary container. */
export function FilterChip({ selected, onClick, children, check }: { selected: boolean; onClick: () => void; children: ReactNode; check?: boolean }) {
  return (
    <button className={`p-chip ${selected ? "on" : ""} ${selected && check ? "check" : ""}`} aria-pressed={selected} onClick={onClick}>
      {selected && check && <MIcon name="fCheck" size={18} />}
      <span>{children}</span>
    </button>
  );
}

/** A row of chips that scrolls sideways, as Compose's horizontalScroll Row (12 dp in, 8 dp apart). */
export function ChipRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-chiprow ${className}`}>{children}</div>;
}

/**
 * Single-choice segmented buttons (40 dp, full width): a calm indicator sits under the chosen one and
 * slides to the next. [track], when given, receives a function that moves the indicator to a
 * fractional position (a page being dragged) without redrawing anything; null lets it go, and it
 * springs to the chosen segment, carrying [v] (segments per ms) when given.
 */
export function Segmented<T extends string>({ value, options, onChange, track }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; track?: MutableRefObject<((p: number | null, v?: number, to?: number) => void) | null>;
}) {
  const ind = useRef<HTMLSpanElement>(null);
  const index = Math.max(0, options.findIndex(([k]) => k === value));
  const indexRef = useRef(index);
  indexRef.current = index;
  const at = useRef<number | null>(null);
  const anim = useRef<Animation | null>(null);
  // Where the running spring is going (a swipe's let-go can aim it before the choice is redrawn).
  const aim = useRef<number | null>(null);
  const put = (p: number) => { const el = ind.current; if (el) el.style.transform = `translate3d(${p * 100}%,0,0)`; };
  useLayoutEffect(() => {
    if (at.current !== null) return; // a finger is on it
    // Still settling toward the old segment: turn the spring to the new one, so it can't end on a stale tab.
    if (anim.current) {
      if (aim.current === index) return; // already on its way there, at its own speed
      const from = anim.current.now().x, el = ind.current;
      anim.current.stop();
      aim.current = index;
      anim.current = animateSpring(from, index, 0, put, () => { anim.current = null; if (el) el.style.transition = ""; }, PAGE_SPRING);
      return;
    }
    put(index);
  }, [index]);
  if (track) track.current = (p, v = 0, to) => {
    const el = ind.current;
    if (!el) return;
    el.style.transition = "none";
    if (p !== null) {
      anim.current?.stop(); anim.current = null;
      at.current = Math.max(0, Math.min(options.length - 1, p));
      put(at.current);
      return;
    }
    // Let go: from where it is to the chosen segment (or [to], the one about to be chosen), on the pagers' spring.
    const from = at.current ?? anim.current?.now().x ?? indexRef.current;
    const target = to ?? indexRef.current;
    anim.current?.stop();
    at.current = null;
    aim.current = target;
    anim.current = animateSpring(from, target, v, put, () => { anim.current = null; aim.current = null; el.style.transition = ""; }, PAGE_SPRING);
  };
  return (
    <div className="p-segmented" role="radiogroup">
      <span className="p-seg-ind" ref={ind} style={{ width: `${100 / options.length}%` }} aria-hidden="true" />
      {options.map(([k, l]) => (
        <button key={k} role="radio" aria-checked={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>
          <span>{l}</span>
        </button>
      ))}
    </div>
  );
}

/** Section title (titleSmall in primary), optionally tappable with an expand arrow, like SectionHeader in Common.kt. */
export function SectionHeader({ children, onClick, expanded, className = "" }: { children: ReactNode; onClick?: () => void; expanded?: boolean; className?: string }) {
  const body = <><span className="grow">{children}</span>{expanded !== undefined && <MIcon name={expanded ? "fExpandLess" : "fExpandMore"} />}</>;
  return onClick
    ? <button className={`p-section ${className}`} onClick={onClick}>{body}</button>
    : <div className={`p-section ${className}`}>{body}</div>;
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <div className="p-empty">{children}</div>;
}

export interface MenuItem { label: string; onClick: () => void; icon?: string; iconColor?: string; dot?: string; checked?: boolean; divider?: boolean; disabled?: boolean }

/**
 * Material 3 dropdown menu anchored under the top-right corner of its parent (which must be
 * position: relative), with the M3 open animation; back and a tap outside close it.
 */
export function DropdownMenu({ open, onClose, items }: { open: boolean; onClose: () => void; items: MenuItem[] }) {
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useLayoutEffect(() => {
    if (open) { setShown(true); setLeaving(false); }
    else if (shown) { setLeaving(true); const t = window.setTimeout(() => { setShown(false); setLeaving(false); }, 75); return () => clearTimeout(t); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => (open ? pushBack(onClose) : undefined), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  return <>
    <div className="p-menu-scrim" onPointerDown={onClose} />
    <div className={`p-menu ${leaving ? "out" : ""}`} role="menu">
      {items.map((it, i) => (
        <div key={i}>
          {it.divider && <div className="p-menu-divider" />}
          <button role="menuitem" className={it.icon || it.dot ? "lead" : ""} disabled={it.disabled} onClick={() => { onClose(); it.onClick(); }}>
            {it.icon && <MIcon name={it.icon} color={it.iconColor} />}
            {it.dot && <span className="p-menu-dot"><span style={{ background: it.dot }} /></span>}
            <span className="grow">{it.label}</span>
            {it.checked && <span className="p-menu-tick">✓</span>}
          </button>
        </div>
      ))}
    </div>
  </>;
}

/** Material 3 basic dialog: title, content, and text buttons at the end. */
/**
 * A dialog's scrim, drawn at the top of the page whatever opened it: a dialog opened from a sheet or
 * the add panel (which move with transforms) would otherwise be placed inside them, low or off screen.
 * Its events stop here, so they don't reach what opened it (a row's click, a sheet's drag).
 */
export function ModalLayer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return createPortal(
    <div className="p-dialog-scrim" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      onClick={stop} onPointerUp={stop} onPointerMove={stop} onTouchStart={stop} onTouchMove={stop} onTouchEnd={stop} onKeyDown={stop} onContextMenu={stop}>
      {children}
    </div>,
    document.body,
  );
}

export function Dialog({ title, children, actions, onClose }: { title: ReactNode; children: ReactNode; actions: ReactNode; onClose: () => void }) {
  useEffect(() => pushBack(onClose), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ModalLayer onClose={onClose}>
      <div className="p-dialog" role="dialog">
        <h2 className="p-dialog-title">{title}</h2>
        <div className="p-dialog-body">{children}</div>
        <div className="p-dialog-actions">{actions}</div>
      </div>
    </ModalLayer>
  );
}

/** Material 3 checkbox (20 dp box in a 40 dp target), as a plain input styled in phone.css. */
export function Checkbox({ checked, onChange, color }: { checked: boolean; onChange: (v: boolean) => void; color?: string }) {
  return <input type="checkbox" className="p-checkbox" checked={checked} style={color ? { ["--c" as string]: color } : undefined}
    onClick={(e) => e.stopPropagation()} onChange={(e) => onChange(e.target.checked)} />;
}

/** Keeps a value's last non-null version for a moment, so something can animate out with its content. */
export function useLatched<T>(v: T | null): T | null {
  const r = useRef(v);
  if (v !== null) r.current = v;
  return r.current;
}

// ---------- Bottom bar icons (TabIcons.kt) ----------

/** The calendar page outline the Today and Calendar tabs share: body, rings and header line. */
const PAGE = "M6 5H18a2.5 2.5 0 0 1 2.5 2.5V18a2.5 2.5 0 0 1 -2.5 2.5H6a2.5 2.5 0 0 1 -2.5 -2.5V7.5a2.5 2.5 0 0 1 2.5 -2.5ZM8 3V7M16 3V7M3.5 10H20.5";
const dot = (x: number, y: number, r = 1.1) => `M${x - r} ${y}a${r} ${r} 0 1 1 ${2 * r} 0a${r} ${r} 0 1 1 ${-2 * r} 0`;
const DOTS = [dot(8, 14), dot(12, 14), dot(16, 14), dot(8, 17.5), dot(12, 17.5)].join("");
const FILLED_PAGE = "M6 4.1H18a3.4 3.4 0 0 1 3.4 3.4V18a3.4 3.4 0 0 1 -3.4 3.4H6a3.4 3.4 0 0 1 -3.4 -3.4V7.5a3.4 3.4 0 0 1 3.4 -3.4ZM4.4 9.3H19.6V10.5H4.4Z";
/** AlarmFilledIcon (TabIcons.kt): two bells' strokes, a solid face with the hands cut out. */
const ALARM_BELLS = "M2.9 6.3L6.3 3.2M21.1 6.3L17.7 3.2";
const ALARM_FACE = "M3.5 13a8.5 8.5 0 1 1 17 0a8.5 8.5 0 1 1 -17 0ZM11.1 8H12.9V12.1H15.8V13.9H11.1Z";
const TASK_FILLED = "M2 12a10 10 0 1 1 20 0a10 10 0 1 1 -20 0ZM6.3 12.4L7.7 11L10.5 13.8L16.3 8L17.7 9.4L10.5 16.6Z";

/** One tab's icon, outlined or solid (TabIcons.kt and the Material icons HomeScreen.kt picks). */
export function TabGlyph({ tab, selected, day }: { tab: string; selected: boolean; day: number }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const };
  let body: ReactNode;
  switch (tab) {
    case "today":
    case "calendar":
      body = selected
        ? <>
            <path d="M8 3V6M16 3V6" {...stroke} />
            <path d={FILLED_PAGE + (tab === "calendar" ? DOTS : "")} fill="currentColor" fillRule="evenodd" />
          </>
        : <>
            <path d={PAGE} {...stroke} />
            {tab === "calendar" && <path d={DOTS} fill="currentColor" />}
          </>;
      if (tab === "today") {
        body = <>{body}<text x="12" y="18.65" textAnchor="middle" fontSize="8.5" fontWeight="700" letterSpacing="-0.25"
          fill={selected ? "var(--p-sec-container)" : "currentColor"} fontFamily="Roboto, sans-serif">{day}</text></>;
      }
      break;
    case "tasks": body = <path d={selected ? TASK_FILLED : ICONS.oTaskAlt} fill="currentColor" fillRule="evenodd" />; break;
    case "alarms":
      body = selected
        ? <><path d={ALARM_BELLS} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" /><path d={ALARM_FACE} fill="currentColor" fillRule="evenodd" /></>
        : <path d={ICONS.oAlarm} fill="currentColor" />;
      break;
    case "notes": body = <path d={selected ? ICONS.fLightbulb : ICONS.oLightbulb} fill="currentColor" />; break;
    // The run icons have no outlined kind: the same one, its colour following the selection.
    case "training": body = <path d={ICONS[trainingTabIcon]} fill="currentColor" />; break;
    default: body = <path d={ICONS.oConstellation} fill="currentColor" />;
  }
  return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" className="p-svg">{body}</svg>;
}
