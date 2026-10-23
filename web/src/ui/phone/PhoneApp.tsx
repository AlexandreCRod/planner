// The phone shell: pages side by side like a ViewPager, a Material bottom bar that drags them (a finger
// slid along it moves the pages 1:1), the + button, and full-screen pages for editors and settings.
// Like the native HomeScreen, the pages themselves don't turn sideways (their swipes change the day).
import { memo, startTransition, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { today as todayEpoch, ymd } from "../../domain/dates.ts";
import { type ItemType, TYPE_COLORS } from "../../domain/types.ts";
import { syncNow } from "../../store/sync.ts";
import { go, useRoute } from "../common.tsx";
import { PhoneNote } from "./PhoneNote.tsx";
import { PhoneCategories, PhoneSettings, PhoneTrash } from "./PhoneSettings.tsx";
import { TodayView, resetToday, todayViewedDay } from "../TodayView.tsx";
import { AddPanel, type AddRequest, type SlotPreview } from "./AddPanel.tsx";
import { PhoneItemEditorPage, PhoneItemView } from "./PhoneItem.tsx";
import { MIcon, TabGlyph } from "./chrome.tsx";
import { SnackbarHost } from "./m3.tsx";
import { DrumHost } from "./TimeWheel.tsx";
import { swallowNextClick } from "./gesture.ts";
import { TOUCH_SLOP } from "./press.ts";
import { minimizeApp, setShellBack, startPhonePlumbing } from "./native.ts";
import { PhoneCalendar, calendarSelectedDay, resetCalendar } from "./PhoneCalendar.tsx";
import { PhoneGraph, PhoneNotes, PhoneSearch, PhoneTasks } from "./PhoneLists.tsx";
import "./phone.css";
import { App as CapApp } from "@capacitor/app";
import { isNative } from "../../platform.ts";
import { hasAlarms } from "../../alarms/native.ts";
import { PermissionHost, PhoneAlarms, openAlarmAddMenu, openAlarmSection } from "./PhoneAlarms.tsx";
import { BAR_GAIN, barTarget, spring } from "./pager.ts";
import { type Animation, PAGE_SPRING, VelocityTracker, animateSpring, springAt } from "./motion.ts";
import { InviteHost } from "./InviteHost.tsx";
import { UpdateHost } from "./UpdateHost.tsx";

// The bottom bar's tabs. Links (the graph) isn't one: it opens from the Notes bar and from any item's
// Links section. Alarms is the fifth where the alarm engine is (the phone build), not in a browser.
const TABS: { key: string; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "calendar", label: "Calendar" },
  { key: "tasks", label: "Tasks" },
  { key: "notes", label: "Notes" },
  ...(hasAlarms ? [{ key: "alarms", label: "Alarms" }] : []),
];
const LAST = TABS.length - 1;
/** Two taps on the same tab closer than this (finger lifts, ms) reset its page (HomeScreen.kt). */
const DOUBLE_TAP_MS = 350;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/**
 * The pager's offset. While it moves it's a 3D translate (its own GPU layer, cheap to slide); at rest it's
 * a plain 2D one, or none, so the page is painted straight onto the screen at whole pixels. (A layer
 * left in place gets resampled at fractional offsets, which is what made text look soft.)
 */
const slide = (p: number, sign: number) => Number.isInteger(p)
  ? (p ? `translateX(${sign * p * 100}%)` : "none")
  : `translate3d(${sign * p * 100}%,0,0)`;

/**
 * Where the pages are (in pages, fractional while moving), written straight to the track and the bar's
 * pill every frame: no React render while they move. A finger on the bar is followed through a short
 * critically damped chase (about 20 ms), so the bar's gear (pages move several times the finger's
 * travel) doesn't turn each touch sample into a visible step; letting go hands its speed to the settle.
 */
class ShellPos {
  p: number;
  private anim: Animation | null = null;
  private chase: { target: number; v: number; raf: number; last: number } | null = null;
  track: HTMLElement | null = null;
  pill: HTMLElement | null = null;
  private shown: number;
  constructor(p: number, private width: () => number, private onShown: (i: number) => void) { this.p = p; this.shown = p; }
  draw(p: number) {
    this.p = p;
    if (this.track) this.track.style.transform = slide(p, -1);
    if (this.pill) this.pill.style.transform = slide(p, 1);
    const r = clamp(Math.round(p), 0, LAST);
    if (r !== this.shown) { this.shown = r; this.onShown(r); }
  }
  stop() {
    this.anim?.stop(); this.anim = null;
    if (this.chase) { cancelAnimationFrame(this.chase.raf); this.chase = null; }
  }
  /** At once (a tap on a tab). */
  jump(i: number) { this.stop(); this.draw(i); }
  /** Follows a finger: [target] in pages. */
  follow(target: number) {
    this.anim?.stop(); this.anim = null;
    if (this.chase) { this.chase.target = target; return; }
    const c = this.chase = { target, v: 0, raf: 0, last: performance.now() };
    const W = 65; // ω of the chase: lags about 2/ω (30 ms) behind a steady finger, catches up within ~60 ms
    const step = (now: number) => {
      if (this.chase !== c) return;
      const dt = Math.min(0.1, Math.max(0.001, (now - c.last) / 1000));
      c.last = now;
      // Exact over the frame (closed form), so a long frame can't make it overshoot or blow up.
      const st = springAt(dt, this.p - c.target, c.v, W * W, 1);
      c.v = st.v;
      let p = c.target + st.x;
      if (Math.abs(c.target - p) < 0.0005 && Math.abs(c.v) < 0.01) { p = c.target; c.v = 0; }
      this.draw(p);
      c.raf = requestAnimationFrame(step);
    };
    c.raf = requestAnimationFrame(step);
  }
  /** Settles on page [i], starting at [v] pages per ms. */
  settle(i: number, v: number) {
    if (this.chase) { cancelAnimationFrame(this.chase.raf); this.chase = null; }
    this.anim?.stop();
    const w = Math.max(1, this.width());
    this.anim = animateSpring(this.p * w, i * w, v * w, (x) => this.draw(x / w), () => { this.anim = null; this.draw(i); }, PAGE_SPRING);
  }
}

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
  const pagerEl = useRef<HTMLDivElement>(null);
  const [pos] = useState(() => new ShellPos(tab, () => pagerEl.current?.clientWidth ?? window.innerWidth, (r) => selectListeners.current.forEach((l) => l(r))));
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const [adding, setAdding] = useState<AddRequest | null>(null);
  // The outline the calendar draws where a new event from a slot will go (it follows the panel).
  const [preview, setPreview] = useState<SlotPreview | null>(null);

  useLayoutEffect(() => { startPhonePlumbing(); }, []);
  useLayoutEffect(() => watchNavButtons(), []);

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
      pos.jump(i);
      if (moved) popBar.current?.();
    } else pos.settle(i, velocity);
    startTransition(() => {
      setTab(i);
      setMounted((m) => (m.has(i) ? m : new Set([...m, i])));
    });
    if (location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] !== TABS[i].key) history.replaceState(null, "", `#/${TABS[i].key}`);
  };

  /**
   * Back to the page's base view, like a double tap on a native tab. On Today and Calendar, when that
   * changes the day shown, today slides in as if swiped back to: a still copy of the old view moves out
   * on one side while the new one comes in from the other, on the pager's spring.
   */
  const resetPage = (i: number) => {
    const key = TABS[i].key;
    const t = todayEpoch();
    const from = key === "today" ? todayViewedDay() : key === "calendar" ? calendarSelectedDay() : t;
    const page = pageEls.current[i];
    const AREA = ".p-daypager, .p-calbody";
    const old = from !== t ? page?.querySelector<HTMLElement>(AREA) : null;
    const ghost = old && page ? stillCopy(old, page) : null;
    if (key === "today") resetToday();
    if (key === "calendar") resetCalendar();
    flushSync(() => setResets((r) => ({ ...r, [key]: (r[key] ?? 0) + 1 })));
    const area = page?.querySelector<HTMLElement>(AREA);
    if (!ghost || !area) { ghost?.remove(); return; }
    const w = area.offsetWidth, dir = t > from ? 1 : -1;
    const place = (x: number) => {
      area.style.transform = x ? `translate3d(${x}px,0,0)` : "";
      ghost.style.transform = `translate3d(${x - dir * w}px,0,0)`;
    };
    place(dir * w);
    spring(dir * w, 0, 0, place, () => { place(0); ghost.remove(); });
  };

  /**
   * A tap on a tab (taken as the finger lifts, never held back to wait for a second one) goes there; a
   * second tap on the same tab within 350 ms puts it back to its base view.
   */
  const onTabTap = (i: number) => {
    const now = performance.now();
    const prev = lastTap.current;
    if (prev.i === i && now - prev.at < DOUBLE_TAP_MS && tabRef.current === i) {
      lastTap.current = { i: -1, at: 0 };
      resetPage(i);
      return;
    }
    lastTap.current = { i, at: now };
    settle(i, 0, true);
  };

  // A route to a page (go("calendar"), the back button...) turns the pager there. Every new route counts
  // (path is new each time the hash changes): the tabs move the pager without a hash change, so the same
  // route asked for again, e.g. "tasks" from Today a second time, must still turn it.
  useEffect(() => { if (routeTab >= 0 && routeTab !== tabRef.current) settle(routeTab, 0, true); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  // "alarms/timer" (from a notification or the add line) opens that section of the Alarms page.
  useEffect(() => {
    if (route === "alarms" && path[1]) { openAlarmSection(path[1]); history.replaceState(null, "", "#/alarms"); }
  }, [route, path[1]]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="p-pager" ref={pagerEl}>
        <div className="p-track" ref={(el) => { pos.track = el; if (el) el.style.transform = slide(pos.p, -1); }}>
          {TABS.map((t, i) => (
            <div key={t.key} className="p-page" ref={(el) => { pageEls.current[i] = el; }} style={{ left: `${i * 100}%` }} aria-hidden={i !== tab}>
              {mounted.has(i) && <Page key={resets[t.key] ?? 0} tabKey={t.key} onNewAt={onNewAt(setAdding, setPreview)} pending={preview} active={tab === i && !overlay} />}
            </div>
          ))}
        </div>
      </div>
      <BottomBar pos={pos} start={tab} listeners={selectListeners.current} pop={popBar} onTap={onTabTap} onSettle={settle} />
      {/* One + button for every page, fixed in place while the pages slide under it; on Alarms it asks what to add. */}
      {!overlay && (
        <button className="p-fab" aria-label="Add" onClick={() => { if (TABS[tabRef.current].key === "alarms") openAlarmAddMenu(); else openAdd(); }}>
          <MIcon name="fAdd" />
        </button>
      )}
      {overlay && <Overlay key={path.join("/") + (query.get("edit") ?? "") + (query.get("n") ?? "")} route={route} path={path} query={query} />}
      <DrumHost />
      <SnackbarHost raised={!!overlay} />
      <PermissionHost />
      <InviteHost />
      {isNative && <UpdateHost />}
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
const Page = memo(function Page({ tabKey, onNewAt, pending, active }: { tabKey: string; onNewAt: (day: number, min: number) => void; pending: SlotPreview | null; active: boolean }) {
  switch (tabKey) {
    case "today": return <TodayView phone />;
    case "calendar": return <PhoneCalendar onNewAt={onNewAt} pending={pending} />;
    case "tasks": return <PhoneTasks />;
    case "notes": return <PhoneNotes />;
    case "alarms": return <PhoneAlarms active={active} />;
    default: return null;
  }
}, (a, b) => a.tabKey === b.tabKey && (a.tabKey !== "calendar" || a.pending === b.pending) && (a.tabKey !== "alarms" || a.active === b.active));

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
    body = path[1] === "categories" ? <PhoneCategories /> : path[1] === "trash" ? <PhoneTrash /> : <PhoneSettings />;
  }
  return <div className="p-overlay">{body}<div className="p-navstrip" aria-hidden="true" /></div>;
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
  pos: ShellPos; start: number; listeners: Set<(i: number) => void>; pop: MutableRefObject<(() => void) | undefined>;
  onTap: (i: number) => void; onSettle: (i: number, velocity?: number, jump?: boolean) => void;
}) {
  const [selected, setSelected] = useState(start);
  useEffect(() => { listeners.add(setSelected); return () => { listeners.delete(setSelected); }; }, [listeners]);
  const bar = useRef<HTMLElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const settleRef = useRef(onSettle);
  settleRef.current = onSettle;
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
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
    // The tab width is measured once, as the finger lands, not on every move.
    let g: { id: number; x0: number; from: number; sliding: boolean; vt: VelocityTracker; lastX: number; w: number } | null = null;
    const tabW = () => g?.w ?? el.clientWidth / TABS.length;
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      g = null;
    };
    const onMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      g.vt.addEvent(e, "x");
      g.lastX = e.clientX;
      const dx = e.clientX - g.x0;
      if (!g.sliding && Math.abs(dx) <= TOUCH_SLOP) return;
      if (!g.sliding) { pill.current?.classList.remove("pop"); g.x0 += Math.sign(dx) * TOUCH_SLOP; }
      g.sliding = true;
      // The pages go a little further than the finger, so a short slide turns a page.
      pos.follow(clamp(g.from + (BAR_GAIN * (e.clientX - g.x0)) / tabW(), 0, LAST));
    };
    const onUp = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      if (g.sliding) {
        swallowNextClick();
        const at = clamp(g.from + (BAR_GAIN * (g.lastX - g.x0)) / tabW(), 0, LAST);
        const vx = g.vt.velocity(e.timeStamp);
        // A flick turns a page whatever the distance; otherwise the nearest one.
        settleRef.current(barTarget(g.from, at, vx, LAST), (BAR_GAIN * vx) / tabW());
      } else if (e.type === "pointerup") {
        // A tap, taken as the finger lifts (the tabs' own click is for the keyboard only).
        const tabEl = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".p-tab");
        if (tabEl && el.contains(tabEl)) tapRef.current(Number(tabEl.dataset.i));
      }
      stop();
    };
    const onDown = (e: PointerEvent) => {
      if (g || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      g = { id: e.pointerId, x0: e.clientX, from: pos.p, sliding: false, vt: new VelocityTracker(), lastX: e.clientX, w: el.clientWidth / TABS.length };
      g.vt.add(e.timeStamp, e.clientX);
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
      <span className="p-pill-track" style={{ width: `${100 / TABS.length}%` }} ref={(el) => { pos.pill = el; if (el) el.style.transform = slide(pos.p, 1); }}>
        <span className="p-pill" ref={pill} />
      </span>
      {TABS.map((t, i) => (
        <button key={t.key} data-i={i} className={`p-tab ${selected === i ? "on" : ""}`} aria-label={t.label} aria-current={selected === i ? "page" : undefined}
          onClick={(e) => { if (e.detail === 0) onTap(i); }}>
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

/**
 * With Android's three navigation buttons the bottom inset is a solid bar of buttons (about 48 dp), and
 * full-screen pages mustn't scroll under it; with gesture navigation it's a thin handle (about 24 dp)
 * over the page, as now. The inset is measured (a probe as tall as it) and html gets "navbuttons" when
 * it's the tall kind; it's followed as the setting changes.
 */
function watchNavButtons(): () => void {
  const probe = document.createElement("div");
  probe.className = "p-navprobe";
  document.body.appendChild(probe);
  const check = () => document.documentElement.classList.toggle("navbuttons", probe.offsetHeight > 36);
  check();
  const ro = new ResizeObserver(check);
  ro.observe(probe);
  window.addEventListener("resize", check);
  return () => { ro.disconnect(); window.removeEventListener("resize", check); probe.remove(); };
}

/**
 * A still copy of [el] laid over it inside [host] (scroll positions included), to slide away while the
 * real one is drawn afresh underneath.
 */
function stillCopy(el: HTMLElement, host: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  const a = el.getBoundingClientRect(), h = host.getBoundingClientRect();
  Object.assign(copy.style, {
    position: "absolute", left: `${a.left - h.left}px`, top: `${a.top - h.top}px`, width: `${a.width}px`, height: `${a.height}px`,
    margin: "0", zIndex: "3", pointerEvents: "none", background: "var(--bg)", flex: "none",
  });
  copy.setAttribute("aria-hidden", "true");
  host.appendChild(copy);
  const from = el.querySelectorAll<HTMLElement>("*"), to = copy.querySelectorAll<HTMLElement>("*");
  from.forEach((x, k) => { if ((x.scrollTop || x.scrollLeft) && to[k]) { to[k].scrollTop = x.scrollTop; to[k].scrollLeft = x.scrollLeft; } });
  return copy;
}
