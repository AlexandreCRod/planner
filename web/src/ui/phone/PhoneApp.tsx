// The phone shell: pages side by side like a ViewPager, a Material bottom bar that drags them (a finger
// slid along it moves the pages 1:1), the + button, and full-screen pages for editors and settings.
// Like the native HomeScreen, the pages themselves don't turn sideways (their swipes change the day).
import { animated, useSpring, type SpringValue } from "@react-spring/web";
import { memo, startTransition, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { today as todayEpoch, ymd } from "../../domain/dates.ts";
import { type ItemType, TYPE_COLORS } from "../../domain/types.ts";
import { syncNow } from "../../store/sync.ts";
import { go, useRoute } from "../common.tsx";
import { PhoneNote } from "./PhoneNote.tsx";
import { SettingsView } from "../SettingsView.tsx";
import { TodayView, resetToday, todayViewedDay } from "../TodayView.tsx";
import { AddPanel, type AddRequest, type SlotPreview } from "./AddPanel.tsx";
import { PhoneItemEditorPage, PhoneItemView } from "./PhoneItem.tsx";
import { MIcon, Scaffold, TabGlyph } from "./chrome.tsx";
import { SnackbarHost } from "./m3.tsx";
import { swallowNextClick } from "./gesture.ts";
import { TOUCH_SLOP } from "./press.ts";
import { minimizeApp, setShellBack, startPhonePlumbing } from "./native.ts";
import { PhoneCalendar, calendarSelectedDay, resetCalendar } from "./PhoneCalendar.tsx";
import { PhoneGraph, PhoneNotes, PhoneSearch, PhoneTasks } from "./PhoneLists.tsx";
import "./phone.css";
import { App as CapApp } from "@capacitor/app";
import { isNative } from "../../platform.ts";

// The bottom bar's tabs. Links (the graph) isn't one: it opens from the Notes bar and from any item's
// Links section. Alarms will be the fifth: a key here, its page in Page and its icon in TabGlyph.
const TABS: { key: string; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "calendar", label: "Calendar" },
  { key: "tasks", label: "Tasks" },
  { key: "notes", label: "Notes" },
];
const LAST = TABS.length - 1;
/** Two taps on the same tab closer than this reset its page (HomeScreen.kt). */
const DOUBLE_TAP_MS = 400;
/** Compose's pager snap: stiffness 400, critically damped. */
const PAGER_SPRING = { tension: 400, friction: 40 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/**
 * The pager's offset. While it moves it's a 3D translate (its own GPU layer, cheap to slide); at rest it's
 * a plain 2D one, or none, so the page is painted straight onto the screen at whole pixels. (A layer
 * left in place gets resampled at fractional offsets, which is what made text look soft.)
 */
const slide = (p: number, sign: number) => Number.isInteger(p)
  ? (p ? `translateX(${sign * p * 100}%)` : "none")
  : `translate3d(${sign * p * 100}%,0,0)`;

export function PhoneApp() {
  const [path, query] = useRoute();
  const route = path[0] ?? "today";
  const routeTab = TABS.findIndex((t) => t.key === route);
  const [tab, setTab] = useState(routeTab >= 0 ? routeTab : 0);
  const tabRef = useRef(tab);
  // Pages already shown stay mounted, so sliding back to them is instant. The rest arrive once the
  // app has settled, so a first slide across them doesn't build them mid-gesture.
  const [mounted, setMounted] = useState(() => new Set([tab, 0, 1]));
  useEffect(() => { const t = window.setTimeout(() => startTransition(() => setMounted(new Set(TABS.map((_, i) => i)))), 1200); return () => clearTimeout(t); }, []);
  // Bumped by a double tap on a tab: that page is built afresh (scroll, filters, search all reset).
  const [resets, setResets] = useState<Record<string, number>>({});
  const selectListeners = useRef(new Set<(i: number) => void>());
  const popBar = useRef<() => void>();
  const lastTap = useRef({ i: -1, at: 0 });
  const shownRef = useRef(tab);
  const [{ pos }, api] = useSpring(() => ({
    pos: tab,
    config: PAGER_SPRING,
    onChange: ({ value }: { value: { pos: number } }) => {
      const r = clamp(Math.round(value.pos), 0, LAST);
      if (r !== shownRef.current) { shownRef.current = r; selectListeners.current.forEach((l) => l(r)); }
    },
  }));
  const [adding, setAdding] = useState<AddRequest | null>(null);
  // The outline the calendar draws where a new event from a slot will go (it follows the panel).
  const [preview, setPreview] = useState<SlotPreview | null>(null);

  useLayoutEffect(() => { startPhonePlumbing(); }, []);

  /**
   * Settles the pager on a page: with a spring after a slide (carrying the finger's speed, in pages per
   * ms), or at once for a tap on a tab, as the native bar does (sliding past every page in between
   * would be slower and draw them all). The shell's own re-render (the + button) waits its turn, so the
   * pages and the bar move first.
   */
  const settle = (i: number, velocity = 0, jump = false) => {
    i = clamp(i, 0, LAST);
    const moved = i !== tabRef.current;
    tabRef.current = i;
    if (jump) {
      api.start({ pos: i, immediate: true });
      if (moved) popBar.current?.();
    } else api.start({ pos: i, config: { ...PAGER_SPRING, velocity } });
    startTransition(() => {
      setTab(i);
      setMounted((m) => (m.has(i) ? m : new Set([...m, i])));
    });
    if (location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] !== TABS[i].key) history.replaceState(null, "", `#/${TABS[i].key}`);
  };

  /** Back to the page's base view, like a double tap on a native tab. */
  const resetPage = (i: number) => {
    const key = TABS[i].key;
    if (key === "today") resetToday();
    if (key === "calendar") resetCalendar();
    setResets((r) => ({ ...r, [key]: (r[key] ?? 0) + 1 }));
  };

  /** A tap on a tab goes there; a second tap on it within 400 ms puts it back to its base view. */
  const onTabTap = (i: number) => {
    const now = performance.now();
    const prev = lastTap.current;
    lastTap.current = { i, at: now };
    if (prev.i === i && now - prev.at < DOUBLE_TAP_MS && tabRef.current === i) { resetPage(i); return; }
    settle(i, 0, true);
  };

  // A route to a page (go("calendar"), the back button...) turns the pager there.
  useEffect(() => { if (routeTab >= 0 && routeTab !== tabRef.current) settle(routeTab, 0, true); }, [routeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const overlay = routeTab < 0 && route !== "" ? route : null;
  // Back: overlays and panels close first (they push their own handlers), then other tabs return to Today.
  useEffect(() => {
    setShellBack(() => {
      if (overlay) history.back();
      else if (tabRef.current !== 0) settle(0, 0, true);
      else minimizeApp();
    });
  });
  // Coming back to the app is like the PC window regaining focus: sync.
  useEffect(() => {
    if (!isNative) return;
    const h = CapApp.addListener("resume", () => void syncNow());
    return () => { void h.then((x) => x.remove()); };
  }, []);

  const openAdd = () => {
    const key = TABS[tabRef.current].key;
    if (key === "notes") { go("note/new"); return; }
    const type: ItemType = key === "calendar" ? "EVENT" : "TASK";
    const day = key === "calendar" ? calendarSelectedDay() : key === "today" ? todayViewedDay() : todayEpoch();
    setAdding({ mode: "quick", type, day, min: null });
  };

  return (
    <div className="p-root">
      <div className="p-pager">
        <animated.div className="p-track" style={{ transform: pos.to((p) => slide(p, -1)) }}>
          {TABS.map((t, i) => (
            <div key={t.key} className="p-page" style={{ left: `${i * 100}%` }} aria-hidden={i !== tab}>
              {mounted.has(i) && <Page key={resets[t.key] ?? 0} tabKey={t.key} onNewAt={onNewAt(setAdding, setPreview)} pending={preview} />}
            </div>
          ))}
        </animated.div>
      </div>
      <BottomBar pos={pos} start={tab} listeners={selectListeners.current} pop={popBar} onTap={onTabTap} onSettle={settle} />
      {!overlay && (
        <button className="p-fab" aria-label="Add" onClick={openAdd}><MIcon name="fAdd" /></button>
      )}
      {overlay && <Overlay key={path.join("/") + (query.get("edit") ?? "")} route={route} path={path} query={query} />}
      <SnackbarHost raised={!!overlay} />
      {adding && <AddPanel key={`${adding.mode}${adding.day}${adding.min}`} req={adding} onPreview={setPreview} onClose={() => { setAdding(null); setPreview(null); }} />}
    </div>
  );
}

/** One stable callback per setter, so the memoised pages don't redraw when the shell does. */
const newAtCache = new WeakMap<object, (day: number, min: number) => void>();
function onNewAt(setAdding: (r: AddRequest) => void, setPreview: (p: SlotPreview) => void) {
  let f = newAtCache.get(setAdding);
  if (!f) {
    // The slot's outline shows in the same frame as the panel starts up (in the new event's default colour).
    f = (day: number, min: number) => { setPreview({ day, min, end: Math.min(min + 60, 24 * 60 - 1), color: TYPE_COLORS.EVENT }); setAdding({ mode: "slot", type: "EVENT", day, min }); };
    newAtCache.set(setAdding, f);
  }
  return f;
}

/** One page of the pager. Memoised: the shell re-rendering (panel open, tab change) doesn't redo pages. */
const Page = memo(function Page({ tabKey, onNewAt, pending }: { tabKey: string; onNewAt: (day: number, min: number) => void; pending: SlotPreview | null }) {
  switch (tabKey) {
    case "today": return <TodayView phone />;
    case "calendar": return <PhoneCalendar onNewAt={onNewAt} pending={pending} />;
    case "tasks": return <PhoneTasks />;
    case "notes": return <PhoneNotes />;
    default: return null;
  }
}, (a, b) => a.tabKey === b.tabKey && (a.tabKey !== "calendar" || a.pending === b.pending));

/** Full-screen pages over the pager: an item, a note, search, settings. */
function Overlay({ route, path, query }: { route: string; path: string[]; query: URLSearchParams }) {
  let body: ReactNode = null;
  if (route === "item" && path[1]) {
    const occ = query.get("occ") ? Number(query.get("occ")) : null;
    body = query.get("edit") === "1"
      ? <PhoneItemEditorPage key={`e${path[1]}`} id={Number(path[1])} occ={occ} dup={query.get("dup") === "1"} />
      : <PhoneItemView key={path[1]} id={Number(path[1])} occ={occ} />;
  } else if (route === "note") {
    body = <PhoneNote key={path[1] + (query.get("day") ?? "")} id={path[1] && path[1] !== "new" ? Number(path[1]) : null} day={query.get("day") ? Number(query.get("day")) : null} />;
  } else if (route === "graph") {
    body = <PhoneGraph focusId={Number(query.get("focus")) || 0} />;
  } else if (route === "browse") {
    body = <PhoneSearch initialKind={query.get("kind") ?? ""} />;
  } else if (route === "settings") {
    body = <Scaffold title="Settings" back><SettingsView /></Scaffold>;
  }
  return <div className="p-overlay">{body}</div>;
}

/**
 * Material 3 navigation bar, as HomeScreen.kt draws it. A tap on a tab goes there at once (the
 * indicator grows into place, as M3's does); a finger slid along the bar (past the touch slop) drags
 * the pages instead, one tab width per page, with the indicator riding along, and letting go settles
 * on the nearest page, carried on by the finger's speed. Icons cross-fade between outlined and solid
 * and their colour follows the selection, like the native bar. The slide is watched before the
 * buttons see it, and a tap that wobbles less than the slop stays a tap.
 */
function BottomBar({ pos, start, listeners, pop, onTap, onSettle }: {
  pos: SpringValue<number>; start: number; listeners: Set<(i: number) => void>; pop: MutableRefObject<(() => void) | undefined>;
  onTap: (i: number) => void; onSettle: (i: number, velocity?: number, jump?: boolean) => void;
}) {
  const [selected, setSelected] = useState(start);
  useEffect(() => { listeners.add(setSelected); return () => { listeners.delete(setSelected); }; }, [listeners]);
  const bar = useRef<HTMLElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const settleRef = useRef(onSettle);
  settleRef.current = onSettle;
  const day = ymd(todayEpoch()).d;
  // M3's indicator: on a jump it grows from the middle of the new tab and fades in.
  pop.current = () => {
    const el = pill.current;
    if (!el) return;
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  };

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    let g: { id: number; x0: number; from: number; sliding: boolean; vx: number; lastX: number; lastT: number } | null = null;
    const tabW = () => el.clientWidth / TABS.length;
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      g = null;
    };
    const onMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const dt = e.timeStamp - g.lastT;
      if (dt > 0) { g.vx = 0.7 * ((e.clientX - g.lastX) / dt) + 0.3 * g.vx; g.lastT = e.timeStamp; }
      g.lastX = e.clientX;
      const dx = e.clientX - g.x0;
      if (!g.sliding && Math.abs(dx) <= TOUCH_SLOP) return;
      if (!g.sliding) pill.current?.classList.remove("pop");
      g.sliding = true;
      pos.start(clamp(g.from + dx / tabW(), 0, LAST), { immediate: true });
    };
    const onUp = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      if (g.sliding) {
        swallowNextClick();
        const target = clamp(g.from + (g.lastX - g.x0) / tabW(), 0, LAST);
        // Where the fling would carry it: the speed (tabs per ms) over about a sixth of a second.
        const v = g.vx / tabW();
        const i = clamp(Math.round(target + v * 160), Math.floor(target), Math.ceil(target));
        settleRef.current(i, v);
      }
      stop();
    };
    const onDown = (e: PointerEvent) => {
      if (g || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      g = { id: e.pointerId, x0: e.clientX, from: pos.get(), sliding: false, vx: 0, lastX: e.clientX, lastT: e.timeStamp };
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp, { passive: true });
      window.addEventListener("pointercancel", onUp, { passive: true });
    };
    el.addEventListener("pointerdown", onDown, { passive: true });
    return () => { stop(); el.removeEventListener("pointerdown", onDown); };
  }, [pos]);

  return (
    <nav className="p-bar" ref={bar}>
      {/* One tab wide, so moving it by its own width moves the pill one tab. */}
      <animated.span className="p-pill-track" style={{ width: `${100 / TABS.length}%`, transform: pos.to((p) => slide(p, 1)) }}>
        <span className="p-pill" ref={pill} />
      </animated.span>
      {TABS.map((t, i) => (
        <button key={t.key} className={`p-tab ${selected === i ? "on" : ""}`} onClick={() => onTap(i)} aria-label={t.label} aria-current={selected === i ? "page" : undefined}>
          <span className="p-tab-icon">
            <span className="p-ico off"><TabGlyph tab={t.key} selected={false} day={day} /></span>
            <span className="p-ico sel"><TabGlyph tab={t.key} selected day={day} /></span>
          </span>
          <span className="p-tab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
