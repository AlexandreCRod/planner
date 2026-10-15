// The phone shell: pages side by side like a ViewPager, a Material bottom bar that drags them (a finger
// slid along it moves the pages 1:1), the + button, and full-screen pages for editors and settings.
// Like the native HomeScreen, the pages themselves don't turn sideways (their swipes change the day).
import { animated, useSpring, type SpringValue } from "@react-spring/web";
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { today as todayEpoch, ymd } from "../../domain/dates.ts";
import { type ItemType } from "../../domain/types.ts";
import { syncNow } from "../../store/sync.ts";
import { BrowseView } from "../BrowseView.tsx";
import { Icon, go, useRoute } from "../common.tsx";
import { GraphView } from "../GraphView.tsx";
import { ItemEditor } from "../ItemEditor.tsx";
import { NoteEditor, NotesView } from "../NotesView.tsx";
import { SettingsView } from "../SettingsView.tsx";
import { TasksView } from "../TasksView.tsx";
import { TodayView, todayViewedDay } from "../TodayView.tsx";
import { AddPanel, type AddRequest } from "./AddPanel.tsx";
import { MIcon, Scaffold } from "./chrome.tsx";
import { swallowNextClick } from "./gesture.ts";
import { TOUCH_SLOP } from "./press.ts";
import { minimizeApp, setShellBack, startPhonePlumbing } from "./native.ts";
import { PhoneCalendar, calendarSelectedDay } from "./PhoneCalendar.tsx";
import "./phone.css";
import { App as CapApp } from "@capacitor/app";
import { isNative } from "../../platform.ts";

const TABS: { key: string; label: string; icon: string }[] = [
  { key: "today", label: "Today", icon: "today" },
  { key: "calendar", label: "Calendar", icon: "calendar" },
  { key: "tasks", label: "Tasks", icon: "tasks" },
  { key: "notes", label: "Notes", icon: "lightbulb" },
  { key: "graph", label: "Links", icon: "graph" },
];
const LAST = TABS.length - 1;
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
  useEffect(() => { const t = window.setTimeout(() => setMounted(new Set(TABS.map((_, i) => i))), 1200); return () => clearTimeout(t); }, []);
  const selectListeners = useRef(new Set<(i: number) => void>());
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

  useLayoutEffect(() => { startPhonePlumbing(); }, []);

  /**
   * Settles the pager on a page: with a spring after a slide (carrying the finger's speed, in pages per
   * ms), or at once for a tap on a tab, as the native bar does (sliding past every page in between
   * would be slower and draw them all).
   */
  const settle = (i: number, velocity = 0, jump = false) => {
    i = clamp(i, 0, LAST);
    tabRef.current = i;
    setTab(i);
    setMounted((m) => (m.has(i) ? m : new Set([...m, i])));
    if (jump) api.start({ pos: i, immediate: true });
    else api.start({ pos: i, config: { ...PAGER_SPRING, velocity } });
    if (location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] !== TABS[i].key) history.replaceState(null, "", `#/${TABS[i].key}`);
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
              {mounted.has(i) && <Page tabKey={t.key} onNewAt={setNewAt(setAdding)} pending={adding?.mode === "slot" ? adding : null} />}
            </div>
          ))}
        </animated.div>
      </div>
      <BottomBar pos={pos} start={tab} listeners={selectListeners.current} onSettle={settle} />
      {TABS[tab].key !== "graph" && !overlay && (
        <button className="p-fab" aria-label="Add" onClick={openAdd}><MIcon name="add" /></button>
      )}
      {overlay && <Overlay route={route} path={path} query={query} />}
      {adding && <AddPanel key={`${adding.mode}${adding.day}${adding.min}`} req={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

const setNewAt = (setAdding: (r: AddRequest) => void) => (day: number, min: number) => setAdding({ mode: "slot", type: "EVENT", day, min });

/** One page of the pager. Memoised: the shell re-rendering (panel open, tab change) doesn't redo pages. */
const Page = memo(function Page({ tabKey, onNewAt, pending }: { tabKey: string; onNewAt: (day: number, min: number) => void; pending: AddRequest | null }) {
  switch (tabKey) {
    case "today": return <TodayView phone />;
    case "calendar": return <PhoneCalendar onNewAt={onNewAt} pending={pending} />;
    case "tasks": return <Scaffold title="Tasks"><TasksView /></Scaffold>;
    case "notes": return <Scaffold title="Notes"><NotesView /></Scaffold>;
    default: return <Scaffold title="Links" flush><GraphView focusId={0} /></Scaffold>;
  }
}, (a, b) => a.tabKey === b.tabKey && (a.tabKey !== "calendar" || a.pending === b.pending));

/** Full-screen pages over the pager: an item, a note, search, settings. */
function Overlay({ route, path, query }: { route: string; path: string[]; query: URLSearchParams }) {
  let body: ReactNode = null;
  if (route === "item" && path[1]) {
    body = <ItemEditor key={path[1]} id={Number(path[1])} occurrence={query.get("occ") ? Number(query.get("occ")) : null}
      isNewPlaceholder={query.get("new") === "1"} onClose={() => history.back()} />;
  } else if (route === "note") {
    body = <div className="p-scaffold"><div className="p-statusbar" /><div className="p-content flush note-host">
      <NoteEditor key={path[1] + (query.get("day") ?? "")} id={path[1] && path[1] !== "new" ? Number(path[1]) : null} day={query.get("day") ? Number(query.get("day")) : null} />
    </div></div>;
  } else if (route === "browse") {
    body = <Scaffold title="Search" back><BrowseView initialKind={query.get("kind") ?? ""} /></Scaffold>;
  } else if (route === "settings") {
    body = <Scaffold title="Settings" back><SettingsView /></Scaffold>;
  }
  return <div className="p-overlay">{body}</div>;
}

/**
 * Material 3 navigation bar. A tap on a tab goes there at once. A finger slid along the bar (past the
 * touch slop) drags the pages instead, one tab width per page, with the selection pill riding along;
 * letting go settles on the nearest page, carried on by the finger's speed. Like the native bar, the
 * slide is watched before the buttons see it, and a tap that wobbles less than the slop stays a tap.
 */
function BottomBar({ pos, start, listeners, onSettle }: {
  pos: SpringValue<number>; start: number; listeners: Set<(i: number) => void>; onSettle: (i: number, velocity?: number, jump?: boolean) => void;
}) {
  const [selected, setSelected] = useState(start);
  useEffect(() => { listeners.add(setSelected); return () => { listeners.delete(setSelected); }; }, [listeners]);
  const bar = useRef<HTMLElement>(null);
  const settleRef = useRef(onSettle);
  settleRef.current = onSettle;
  const day = ymd(todayEpoch()).d;

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
        <span className="p-pill" />
      </animated.span>
      {TABS.map((t, i) => (
        <button key={t.key} className={`p-tab ${selected === i ? "on" : ""}`} onClick={() => onSettle(i, 0, true)}>
          <span className="p-tab-icon">
            {t.key === "today" ? <TodayGlyph day={day} /> : <Icon name={t.icon} size={24} />}
          </span>
          <span className="p-tab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** The Today tab's icon: a calendar page with today's date, like the native app. */
function TodayGlyph({ day }: { day: number }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 22q-.825 0-1.412-.587Q3 20.825 3 20V6q0-.825.588-1.412Q4.175 4 5 4h1V2h2v2h8V2h2v2h1q.825 0 1.413.588Q21 5.175 21 6v14q0 .825-.587 1.413Q19.825 22 19 22Zm0-2h14V10H5Z" fill="currentColor" />
      <text x="12" y="18.6" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor" fontFamily="Roboto, system-ui, sans-serif">{day}</text>
    </svg>
  );
}
