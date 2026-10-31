// The phone shell: pages side by side like a ViewPager, a Material bottom bar that drags them (a finger
// slid along it moves the pages 1:1), the + button, and full-screen pages for editors and settings.
// A sideways swipe anywhere on a page changes tab too (300); inner pagers, rows and charts go first.
// In a wide window (the PC, html.wide) the same shell has a side rail for the bar, the + button at its
// top, the open note beside the Notes list, and the keys of desk.ts (Esc, N, T, Ctrl+F).
import { memo, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { today as todayEpoch, ymd } from "../../domain/dates.ts";
import { type ItemType, TYPE_COLORS } from "../../domain/types.ts";
import { syncNow } from "../../store/sync.ts";
import { go, useRoute } from "../shared/common.tsx";
import { PhoneNote } from "./PhoneNote.tsx";
import { PhoneBackups, PhoneCategories, PhoneLooks, PhoneProblems, PhoneSettings, PhoneTrash } from "./PhoneSettings.tsx";
import { PhoneToday, resetToday, showTodayDay, todayViewedDay } from "./PhoneToday.tsx";
import { AddPanel, type AddRequest, type SlotPreview } from "./AddPanel.tsx";
import { PhoneItemEditorPage, PhoneItemView } from "./PhoneItem.tsx";
import { MIcon, TabGlyph, openSearch } from "./chrome.tsx";
import { SnackbarHost } from "./m3.tsx";
import { DrumHost } from "./TimeWheel.tsx";
import { clearSwipeClaim, swallowNextClick, swipeClaimed } from "./gesture.ts";
import { rowDragging } from "./rowDrag.ts";
import { LONG_PRESS, TOUCH_SLOP, selectingText, textTouch } from "./press.ts";
import { minimizeApp, setShellBack, startPhonePlumbing, useKeyboardHeight, useKeyboardUp } from "./native.ts";
import { NoteChip } from "./NoteDock.tsx";
import { PhoneCalendarImport } from "./CalendarImport.tsx";
import { PhoneCalendar, calendarGoToday, calendarSelectedDay, resetCalendar } from "./PhoneCalendar.tsx";
import { PhoneGraph, PhoneNotes, PhoneSearch, PhoneTasks, useTodoTabShown, useTodosSheetOpen } from "./PhoneLists.tsx";
import { ErrorBoundary } from "../shared/ErrorBoundary.tsx";
import "./phone.css";
import "./wide.css";
import { App as CapApp } from "@capacitor/app";
import { isNative, useWide } from "../../platform.ts";
import { deskWheel, scrollsSideways, setDeskHandlers } from "./desk.ts";
import { hasAlarms } from "../../alarms/native.ts";
import { PermissionHost, PhoneAlarms, openAlarmAddMenu, openAlarmSection } from "./PhoneAlarms.tsx";
import { BAR_GAIN, NO_SWIPE, type PageTurner, SWIPE_GAIN, barDays, barSwipeReversed, barTarget, swipeTabs, turners, useKeepTasksTab } from "./pager.ts";
import { type Animation, PAGE_SPRING, VelocityTracker, animateSpring, frameWriter, rubberBand, springAt } from "./motion.ts";
import { InviteHost } from "./InviteHost.tsx";
import { PhoneTraining } from "./PhoneTraining.tsx";
import { UpdateHost } from "./UpdateHost.tsx";
import { trainingBase, trainingSub } from "./trainingBack.ts";

// The bottom bar's tabs. Links (the graph) isn't one: it opens from the Notes bar and from any item's
// Links section. Clock (the route "alarms") is the last where the alarm engine is (the phone build), not in a browser.
// Training has Tasks' old place (241); Tasks comes back after it when Settings keeps it in the bar, and is
// otherwise a full-screen page (from the to-dos sheet on Today).
type Tab = { key: string; label: string };
const tabsFor = (keepTasks: boolean): Tab[] => [
  { key: "today", label: "Today" },
  { key: "calendar", label: "Calendar" },
  { key: "training", label: "Training" },
  ...(keepTasks ? [{ key: "tasks", label: "Tasks" }] : []),
  { key: "notes", label: "Notes" },
  ...(hasAlarms ? [{ key: "alarms", label: "Clock" }] : []),
];
/** The Training page's route ("#/training?s=…"), kept while another tab shows, so coming back finds it as it was. */
let trainingHash = "#/training";
const tabHash = (key: string) => (key === "training" ? trainingHash : `#/${key}`);
/** The page key and query of a URL's hash route ("#/training?s=1" -> "training"). */
const hashRoute = (url: string): [string, URLSearchParams] => {
  const h = (url.split("#")[1] ?? "").replace(/^\/?/, "");
  const [path, q = ""] = h.split("?");
  return [path.split("/")[0], new URLSearchParams(q)];
};
/**
 * Going back to today (a tap on the tab already shown): the old view slides out as today's slides in, both
 * together, on a quick ease-out with no overshoot, as Google Calendar's Today does.
 */
const RESET_MS = 300;
const RESET_EASE = "cubic-bezier(.2, 0, 0, 1)";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/**
 * The pager's offset (down the side rail, [axis] Y, for its indicator). While it moves it's a 3D
 * translate (its own GPU layer, cheap to slide); at rest it's a plain 2D one, or none, so the page is
 * painted straight onto the screen at whole pixels. (A layer left in place gets resampled at
 * fractional offsets, which is what made text look soft.) Moving means the whole drag or settle, not
 * just a fractional offset: a fast slide reaching the first or last page mustn't drop the layer and
 * build it again mid-gesture, which repainted the pages with a flicker.
 */
const slide = (p: number, sign: number, moving: boolean, axis: "X" | "Y" = "X") => !moving
  ? (p ? `translate${axis}(${sign * p * 100}%)` : "none")
  : axis === "X" ? `translate3d(${sign * p * 100}%,0,0)` : `translate3d(0,${sign * p * 100}%,0)`;

/**
 * Where the pages are (in pages, fractional while moving), written straight to the track and the bar's
 * pill every frame: no React render while they move. A finger on the bar is followed through a short
 * critically damped chase (about 20 ms), so the bar's gear (pages move several times the finger's
 * travel) doesn't turn each touch sample into a visible step; letting go hands its speed to the settle.
 */
class ShellPos {
  p: number;
  /** Where the last settle or jump is taking the pages. */
  target: number;
  /** The side rail of a wide window: its indicator moves down the rail. */
  rail = false;
  /** The last page's index (the tabs can change with Settings). */
  last = 0;
  private moving = false;
  private anim: Animation | null = null;
  private chase: { target: number; v: number; raf: number; last: number } | null = null;
  track: HTMLElement | null = null;
  pill: HTMLElement | null = null;
  private shown: number;
  constructor(p: number, private width: () => number, private onShown: (i: number) => void) { this.p = p; this.shown = p; this.target = p; }
  draw(p: number) {
    this.p = p;
    this.paint();
    const r = clamp(Math.round(p), 0, this.last);
    // While moving, the chosen tab changes only once the pages are well past halfway, so a finger
    // wavering about the middle of a fast slide doesn't flick the tabs back and forth.
    if (r !== this.shown && (!this.moving || Math.abs(p - this.shown) > 0.6)) { this.shown = r; this.onShown(r); }
  }
  /** Writes the track's and the indicator's offsets for where the pages are. */
  paint() {
    if (this.track) this.track.style.transform = slide(this.p, -1, this.moving);
    if (this.pill) this.pill.style.transform = slide(this.p, 1, this.moving, this.rail ? "Y" : "X");
  }
  get resting() { return !this.moving; }
  stop() {
    this.anim?.stop(); this.anim = null;
    if (this.chase) { cancelAnimationFrame(this.chase.raf); this.chase = null; }
  }
  /**
   * A finger landing on the bar while the pages still move: they stop where they are, under it, so a
   * slide starting now carries on from there instead of jumping back to where the last one began.
   */
  grab() { if (this.anim || this.chase) this.stop(); }
  /** At once (a tap on a tab). */
  jump(i: number) { this.stop(); this.moving = false; this.target = i; this.draw(i); }
  /** Directly under a finger on the pages, already once per frame: [p] in pages. */
  drag(p: number) {
    this.stop();
    this.moving = true;
    this.draw(p);
  }
  /** Follows a finger: [target] in pages. */
  follow(target: number) {
    this.anim?.stop(); this.anim = null;
    this.moving = true;
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
    this.moving = true;
    this.target = i;
    const w = Math.max(1, this.width());
    this.anim = animateSpring(this.p * w, i * w, v * w, (x) => this.draw(x / w), () => { this.anim = null; this.moving = false; this.draw(i); }, PAGE_SPRING);
  }
}

export function PhoneApp() {
  const [path, query] = useRoute();
  const route = path[0] ?? "today";
  const keepTasks = useKeepTasksTab();
  const TABS = useMemo(() => tabsFor(keepTasks), [keepTasks]);
  const LAST = TABS.length - 1;
  const tabsRef = useRef(TABS);
  const routeTab = TABS.findIndex((t) => t.key === route);
  // The Training page reads its route (a session, a document...); while another tab shows, it keeps the last.
  const trainingQ = useRef(new URLSearchParams());
  if (route === "training") { trainingQ.current = query; trainingHash = `#/training${query.toString() ? `?${query}` : ""}`; }
  const [tab, setTab] = useState(routeTab >= 0 ? routeTab : 0);
  const tabRef = useRef(tab);
  // Pages already shown stay mounted (by key), so sliding back to them is instant. The rest arrive once the
  // app has settled, so a first slide across them doesn't build them mid-gesture: one page at a time,
  // when the phone is idle and no finger (or mouse button) is down or has just lifted. Building them
  // all at once, on a timer, was one long stall that landed on the first swipes after opening the app.
  const [mounted, setMounted] = useState(() => new Set([TABS[tab].key, TABS[0].key, TABS[1].key]));
  useEffect(() => {
    let down = 0, lastUp = 0, timer = 0, idle = 0, alive = true;
    let left = TABS.length;
    const onDown = () => { down++; };
    const onUp = () => { down = Math.max(0, down - 1); lastUp = performance.now(); };
    window.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    window.addEventListener("pointerup", onUp, { capture: true, passive: true });
    window.addEventListener("pointercancel", onUp, { capture: true, passive: true });
    const next = (wait: number) => { timer = window.setTimeout(ask, wait); };
    const ask = () => {
      if (typeof requestIdleCallback === "function") idle = requestIdleCallback(step, { timeout: 4000 });
      else step();
    };
    const step = () => {
      if (!alive) return;
      // Busy with a gesture (or its glide after the finger lifts): later.
      if (down > 0 || performance.now() - lastUp < 700) { next(500); return; }
      if (left <= 0) return;
      left--;
      startTransition(() => setMounted((m) => {
        const next = tabsRef.current.find((x) => !m.has(x.key));
        return next ? new Set([...m, next.key]) : m;
      }));
      if (left > 0) next(400);
    };
    next(1500);
    return () => {
      alive = false;
      clearTimeout(timer);
      if (idle && typeof cancelIdleCallback === "function") cancelIdleCallback(idle);
      window.removeEventListener("pointerdown", onDown, { capture: true });
      window.removeEventListener("pointerup", onUp, { capture: true });
      window.removeEventListener("pointercancel", onUp, { capture: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Bumped by a tap on the tab already shown: that page is built afresh (scroll, filters, search all reset).
  const [resets, setResets] = useState<Record<string, number>>({});
  const selectListeners = useRef(new Set<(i: number) => void>());
  const popBar = useRef<() => void>();
  const pagerEl = useRef<HTMLDivElement>(null);
  const [pos] = useState(() => new ShellPos(tab, () => pagerEl.current?.clientWidth ?? window.innerWidth, (r) => selectListeners.current.forEach((l) => l(r))));
  const wide = useWide();
  pos.rail = wide;
  pos.last = LAST;
  // Tasks put in or taken out of the bar (Settings): the page shown keeps its place by its key.
  useLayoutEffect(() => {
    const before = tabsRef.current;
    if (before === TABS) return;
    tabsRef.current = TABS;
    const key = before[tabRef.current]?.key;
    const i = Math.max(0, TABS.findIndex((x) => x.key === key));
    tabRef.current = i;
    pos.jump(i);
    setTab(i);
    setMounted((m) => (m.has(TABS[i].key) ? m : new Set([...m, TABS[i].key])));
  }, [TABS, pos]);
  // The render that brings the new bar comes before that effect, so it reads the page by its key too: the
  // old index could be past the end of a shorter bar (a crash on the phone, 2026-10-29).
  const shown = tabsRef.current === TABS ? tab : Math.max(0, TABS.findIndex((x) => x.key === tabsRef.current[tabRef.current]?.key));
  useLayoutEffect(() => pos.paint(), [wide, pos]);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const [adding, setAdding] = useState<AddRequest | null>(null);
  // The outline the calendar draws where a new event from a slot will go (it follows the panel).
  const [preview, setPreview] = useState<SlotPreview | null>(null);

  // The open note (one at a time). It stays open while another page is shown, shrunk into a chip above
  // the bar, so coming back to it finds it exactly as it was; [hash] is its route (the note's id once saved).
  const [dock, setDock] = useState<{ n: number; key: string; id: number | null; day: number | null; hash: string } | null>(null);
  const [minimized, setMinimized] = useState(false);
  const minimizedRef = useRef(false);
  minimizedRef.current = minimized;
  const minimizing = useRef(false);
  const kbUp = useKeyboardUp(), kbHeight = useKeyboardHeight();

  useLayoutEffect(() => { startPhonePlumbing(); }, []);
  // A session or a document on Training opened from elsewhere (Today's Training line, a link, a cold start)
  // gets the Training week put under it in the history, so back closes it to Training, not to the page it
  // came from (277). Synthetic hashchanges (replaceRoute) carry no oldURL: the last route seen stands in.
  useLayoutEffect(() => {
    const under = (from: string) => {
      const [to, q] = hashRoute(location.href);
      const base = trainingBase(from, to, q);
      if (!base) return;
      const here = location.hash;
      history.replaceState(null, "", base);
      history.pushState(null, "", here);
    };
    let last = hashRoute(location.href)[0];
    under("");
    const on = (e: HashChangeEvent) => {
      under(e.oldURL ? hashRoute(e.oldURL)[0] : last);
      last = hashRoute(location.href)[0];
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useLayoutEffect(() => watchNavButtons(), []);
  // The pages' own swipe (300). This is the last gesture in line: everything inside the page sees the finger
  // first and claims it (gesture.ts), so this only takes what nobody wanted. The pages move once per frame
  // through the shell's transform, at the finger's own speed times the pagers' gain, and past the first or
  // last tab give a little, like the other pagers. A later guard (275) goes in `refused`.
  const swipeState = useRef({ settle: (_i: number, _v?: number) => {}, noteOpen: false });
  useEffect(() => {
    const el = pagerEl.current;
    if (!el) return;
    let g: { id: number; x0: number; y0: number; t0: number; from: number; w: number; p: number; dragging: boolean; vt: VelocityTracker } | null = null;
    const write = frameWriter((p: number) => pos.drag(p));
    const noScroll = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };
    const stop = () => {
      g = null;
      el.removeEventListener("touchmove", noScroll);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    /** The finger wasn't for the pages: if it caught them moving, they go on to where they were going. */
    const leave = () => { stop(); if (!pos.resting) swipeState.current.settle(pos.target); };
    const refused = (t: Element) => !!t.closest(NO_SWIPE) || textTouch(t) || scrollsSideways(t, el);
    const onMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      g.vt.addEvent(e, "x");
      if (!g.dragging) {
        const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
        if (swipeClaimed(g.id) || rowDragging() || selectingText()) { leave(); return; }
        if (Math.abs(dy) > TOUCH_SLOP && Math.abs(dy) >= Math.abs(dx)) { leave(); return; } // a scroll
        if (Math.abs(dx) <= TOUCH_SLOP) return;
        // A finger that stayed still that long was a long press: what it picked up is its own.
        if (e.timeStamp - g.t0 > LONG_PRESS) { leave(); return; }
        g.dragging = true;
        g.x0 += Math.sign(dx) * TOUCH_SLOP; // like Compose, the drag starts from where the slop ran out
        el.addEventListener("touchmove", noScroll, { passive: false });
      }
      let p = g.from - (SWIPE_GAIN * (e.clientX - g.x0)) / g.w;
      if (p < 0) p = rubberBand(p * g.w, g.w) / g.w;
      else if (p > pos.last) p = pos.last + rubberBand((p - pos.last) * g.w, g.w) / g.w;
      g.p = clamp(p, g.from - 1, g.from + 1);
      write(g.p);
    };
    const onUp = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const cur = g;
      if (!cur.dragging) { leave(); return; }
      stop();
      write.cancel();
      swallowNextClick();
      const vx = -SWIPE_GAIN * cur.vt.velocity(e.timeStamp); // towards the next tab
      pos.drag(cur.p);
      swipeState.current.settle(barTarget(Math.round(cur.from), cur.p, vx, pos.last), vx / cur.w);
    };
    const onCancel = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const cur = g;
      if (!cur.dragging) { leave(); return; }
      stop();
      write.cancel();
      swipeState.current.settle(clamp(Math.round(cur.p), 0, pos.last), 0);
    };
    const onDown = (e: PointerEvent) => {
      if (e.isPrimary) clearSwipeClaim();
      if (g || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0) || !swipeTabs()) return;
      if (swipeState.current.noteOpen || refused(e.target as Element)) return;
      pos.grab();
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, from: pos.p, w: el.clientWidth || 1, p: pos.p, dragging: false, vt: new VelocityTracker() };
      g.vt.add(e.timeStamp, e.clientX);
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp, { passive: true });
      window.addEventListener("pointercancel", onCancel, { passive: true });
    };
    // A second finger is a pinch (the calendar's zoom), not a swipe.
    const onTwo = (e: TouchEvent) => {
      if (!g || e.touches.length < 2) return;
      const cur = g;
      stop();
      write.cancel();
      if (cur.dragging || !pos.resting) swipeState.current.settle(clamp(Math.round(pos.p), 0, pos.last), 0);
    };
    // A sideways trackpad swipe does the same (inner pagers first; ← → stay with the day and the week).
    const undoWheel = deskWheel(el, (dir) => {
      const i = clamp(Math.round(pos.target) + dir, 0, pos.last);
      if (i === Math.round(pos.target)) return false;
      swipeState.current.settle(i, 0);
      return true;
    }, (t) => !refused(t) && !swipeState.current.noteOpen, swipeTabs);
    el.addEventListener("pointerdown", onDown, { passive: true });
    el.addEventListener("touchstart", onTwo, { passive: true });
    return () => {
      stop();
      write.cancel();
      undoWheel();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("touchstart", onTwo);
    };
  }, [pos]);

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
      setMounted((m) => (m.has(TABS[i].key) ? m : new Set([...m, TABS[i].key])));
    });
    if (location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] !== TABS[i].key) history.replaceState(null, "", tabHash(TABS[i].key));
  };

  /**
   * Back to the page's base view (a tap on the tab already shown). On Today and Calendar, when that
   * changes the day shown, today slides in: a still copy of the old view moves out on one side while the
   * new one comes in from the other (RESET_MS, composited).
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
    // Training: back to its week, with any session or document put away.
    if (key === "training" && trainingQ.current.toString()) {
      history.replaceState(null, "", "#/training");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    flushSync(() => setResets((r) => ({ ...r, [key]: (r[key] ?? 0) + 1 })));
    const area = page?.querySelector<HTMLElement>(AREA);
    if (!ghost || !area) { ghost?.remove(); return; }
    const w = area.offsetWidth, dir = t > from ? 1 : -1;
    const opts: KeyframeAnimationOptions = { duration: RESET_MS, easing: RESET_EASE };
    area.animate([{ transform: `translate3d(${dir * w}px,0,0)` }, { transform: "translate3d(0,0,0)" }], opts);
    ghost.animate([{ transform: "translate3d(0,0,0)" }, { transform: `translate3d(${-dir * w}px,0,0)` }], { ...opts, fill: "forwards" })
      .finished.then(() => ghost.remove(), () => ghost.remove());
  };

  /**
   * A tap on a tab (taken as the finger lifts) goes there; a tap on the tab already shown puts it back to
   * its base view.
   */
  const onTabTap = (i: number) => {
    const key = TABS[i].key;
    // A tab tapped while a note is open: the note shrinks into its chip and that page shows.
    if (route === "note" && dock) {
      // Wide, the note sits beside the Notes list: Notes again leaves it there.
      if (wide && key === "notes" && tabRef.current === i) return;
      minimizing.current = true;
      history.replaceState(null, "", tabHash(TABS[i].key));
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      if (i === tabRef.current) popBar.current?.();
      return;
    }
    // Wide, the rail stays beside full-screen pages: a tab puts the page away and shows that tab.
    if (overlay && wide) {
      history.replaceState(null, "", tabHash(key));
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      return;
    }
    // Wide, a note put away comes back beside the Notes list.
    if (wide && key === "notes" && dock && minimized) {
      settle(i, 0, true);
      location.hash = dock.hash;
      return;
    }
    if (tabRef.current === i && pos.resting) { resetPage(i); return; }
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

  // The note's route opens it (or brings back the one in the chip); back to a page closes it, unless it was
  // put away into the chip; another full-screen page (an item from its links) opens over it.
  useLayoutEffect(() => {
    if (route === "note") {
      const id = path[1] && path[1] !== "new" ? Number(path[1]) : null;
      const day = query.get("day") ? Number(query.get("day")) : null;
      const key = (path[1] ?? "") + (day ?? "");
      setDock((d) => (d && (d.key === key || d.hash === location.hash) ? d : { n: (d?.n ?? 0) + 1, key, id, day, hash: location.hash }));
      setMinimized(false);
    } else if (routeTab >= 0) {
      if (minimizing.current) { minimizing.current = false; setMinimized(true); }
      else if (!minimizedRef.current) setDock(null);
    }
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  swipeState.current = { settle, noteOpen: route === "note" };
  // The note shrinks toward its chip as it's put away, and grows out of it when it's brought back (297).
  const noteLayer = useRef<HTMLDivElement>(null);
  const chipWas = useRef<ReturnType<typeof chipBox>>(null);
  useLayoutEffect(() => {
    const el = noteLayer.current;
    if (!el) return;
    const box = minimized ? chipBox() : chipWas.current;
    chipWas.current = null;
    if (box) noteMorph(el, box, !minimized);
  }, [minimized]);
  const overlay = routeTab < 0 && route !== "" ? route : null;
  const noteShown = route === "note" && !!dock;
  // While writing, the keyboard covers the bar: the note takes the whole screen.
  const noteKb = noteShown && (isNative ? kbUp : kbHeight > 0);
  // Back: overlays and panels close first (they push their own handlers), then other tabs return to Today.
  useEffect(() => {
    setShellBack(() => {
      if (overlay) history.back();
      else if (TABS[tabRef.current].key === "training" && trainingSub(trainingQ.current)) history.back();
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

  /** The + button: on Alarms it asks what to add; elsewhere what the page adds. */
  const fabTap = () => { if (TABS[tabRef.current].key === "alarms") openAlarmAddMenu(); else openAdd(); };
  const openAdd = () => {
    const key = TABS[tabRef.current].key;
    if (key === "notes") { go("note/new"); return; }
    const type: ItemType = key === "calendar" ? "EVENT" : "TASK";
    const day = key === "calendar" ? calendarSelectedDay() : key === "today" ? todayViewedDay() : todayEpoch();
    setAdding({ mode: "quick", type, day, min: null });
  };

  // The keys (desk.ts): Esc closes a full-screen page (after anything open over it), N is the + button,
  // T the page's "today", Ctrl+F the search (a note's own find bar is the note's).
  useEffect(() => {
    setDeskHandlers({
      back: () => {
        if (!overlay && !(TABS[tabRef.current].key === "training" && trainingSub(trainingQ.current))) return false;
        history.back();
        return true;
      },
      add: () => { if (!adding && (!overlay || wide)) fabTap(); },
      today: () => {
        if (overlay) return;
        if (TABS[tabRef.current].key === "calendar") { calendarGoToday(); return; }
        const home = TABS.findIndex((x) => x.key === "today");
        if (tabRef.current !== home) settle(home, 0, true);
        showTodayDay(todayEpoch());
      },
      find: () => {
        const field = route === "browse" ? document.querySelector<HTMLInputElement>(".p-searchfield input") : null;
        if (field) field.focus(); else openSearch();
      },
    });
  });
  useEffect(() => () => setDeskHandlers(null), []);

  const todosSheet = useTodosSheetOpen();
  const todoTab = useTodoTabShown();
  const noteChip = dock ? <NoteChip key={dock.n} hash={dock.hash} onOpen={() => { chipWas.current = chipBox(); location.hash = dock.hash; }} onClose={() => { setDock(null); setMinimized(false); }} /> : null;

  return (
    <div className={`p-root ${noteKb ? "note-kb" : ""} ${wide && TABS[shown].key === "notes" ? "notes-split" : ""} ${TABS[shown].key === "training" ? "on-training" : ""} ${TABS[shown].key === "tasks" && todoTab ? "on-todo" : ""} ${overlay === "tasks" ? "over-tasks" : ""}`}>
      <div className="p-pager" ref={pagerEl}>
        <div className="p-track" ref={(el) => { pos.track = el; if (el) pos.paint(); }}>
          {TABS.map((t, i) => (
            <div key={t.key} className="p-page" data-tab={t.key} ref={(el) => { pageEls.current[i] = el; }} style={{ left: `${i * 100}%` }} aria-hidden={i !== shown}>
              {mounted.has(t.key) && <Page key={resets[t.key] ?? 0} tabKey={t.key} onNewAt={onNewAt(setAdding, setPreview)} pending={preview} active={shown === i && !overlay}
                query={t.key === "training" ? trainingQ.current : null} />}
              {/* Wide, the open note shows beside the list; with none open, a word on where it goes. */}
              {wide && t.key === "notes" && (
                <div className="p-notes-pane" aria-hidden="true">
                  <MIcon name="oLightbulb" size={40} />
                  <span>Open a note to read and write it here</span>
                  <span className="small">N writes a new one</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <BottomBar tabs={TABS} pos={pos} start={shown} listeners={selectListeners.current} pop={popBar} onTap={onTabTap} onSettle={settle} />
      {/* One + button for every page, fixed in place while the pages slide under it; on Alarms it asks what
          to add. Wide, it heads the rail, which stays beside full-screen pages. On the phone it fades away over
          Training, which adds nothing with it (phone.css, on-training). */}
      {(!overlay || wide) && (
        <button className="p-fab" aria-label="Add" onClick={fabTap}>
          <MIcon name="fAdd" />
        </button>
      )}
      {dock && (
        <div ref={noteLayer} className={`p-overlay p-notelayer ${noteShown ? "" : "away"}`} aria-hidden={!noteShown}>
          <PhoneNote key={dock.n} id={dock.id} day={dock.day} shown={noteShown}
            onSaved={(nid) => setDock((d) => (d && d.n === dock.n ? { ...d, hash: d.hash.replace(/^#\/note\/[^?]*/, `#/note/${nid}`) } : d))} />
          {noteKb && <div className="p-navstrip" aria-hidden="true" />}
        </div>
      )}
      {overlay && overlay !== "note" && <Overlay key={path.join("/") + (query.get("edit") ?? "") + (query.get("n") ?? "")} route={route} path={path} query={query} />}
      {/* The chip stays over the to-dos (276): the Tasks page opened full-screen, and Today's to-dos sheet
          (it's on the page then, above the sheet's layer). */}
      {dock && minimized && (routeTab >= 0 || overlay === "tasks") && (todosSheet
        ? createPortal(<div className="p-chip-over">{noteChip}</div>, document.body)
        : noteChip)}
      <DrumHost />
      <SnackbarHost raised={!!overlay && (overlay !== "note" || noteKb)} />
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
const Page = memo(function Page({ tabKey, onNewAt, pending, active, query }: {
  tabKey: string; onNewAt: (day: number, min: number) => void; pending: SlotPreview | null; active: boolean; query: URLSearchParams | null;
}) {
  return <ErrorBoundary where={tabKey}>{pageOf(tabKey, onNewAt, pending, active, query)}</ErrorBoundary>;
}, (a, b) => a.tabKey === b.tabKey && (a.tabKey !== "calendar" || a.pending === b.pending) && (a.tabKey !== "alarms" || a.active === b.active)
  && (a.tabKey !== "training" || a.query?.toString() === b.query?.toString()));

function pageOf(tabKey: string, onNewAt: (day: number, min: number) => void, pending: SlotPreview | null, active: boolean, query: URLSearchParams | null) {
  switch (tabKey) {
    case "today": return <PhoneToday />;
    case "calendar": return <PhoneCalendar onNewAt={onNewAt} pending={pending} />;
    case "training": return <PhoneTraining query={query ?? new URLSearchParams()} />;
    case "tasks": return <PhoneTasks />;
    case "notes": return <PhoneNotes />;
    case "alarms": return <PhoneAlarms active={active} />;
    default: return null;
  }
}

/** Full-screen pages over the pager: an item, search, settings, training. (The open note is the shell's own.) */
function Overlay({ route, path, query }: { route: string; path: string[]; query: URLSearchParams }) {
  let body: ReactNode = null;
  if (route === "item" && path[1]) {
    const occ = query.get("occ") ? Number(query.get("occ")) : null;
    body = query.get("edit") === "1"
      ? <PhoneItemEditorPage key={`e${path[1]}`} id={Number(path[1])} occ={occ} dup={query.get("dup") === "1"} />
      : <PhoneItemView key={path[1]} id={Number(path[1])} occ={occ} />;
  } else if (route === "graph") {
    body = <PhoneGraph focusId={Number(query.get("focus")) || 0} />;
  } else if (route === "browse") {
    body = <PhoneSearch initialKind={query.get("kind") ?? ""} from={query.get("from") ?? ""} />;
  } else if (route === "settings") {
    body = path[1] === "categories" ? <PhoneCategories /> : path[1] === "trash" ? <PhoneTrash /> : path[1] === "problems" ? <PhoneProblems /> : path[1] === "looks" ? <PhoneLooks /> : path[1] === "import" ? <PhoneCalendarImport /> : path[1] === "backups" ? <PhoneBackups /> : <PhoneSettings />;
  } else if (route === "tasks") {
    body = <PhoneTasks back />;
  }
  return <div className={`p-overlay ${route === "graph" ? route : ""}`}><ErrorBoundary where={route}>{body}</ErrorBoundary><div className="p-navstrip" aria-hidden="true" /></div>;
}

/**
 * Material 3 navigation bar, as HomeScreen.kt draws it. A tap on a tab goes there at once (the
 * indicator grows into place, as M3's does); a finger slid along the bar (past the touch slop) drags
 * the pages instead, one tab width per page, with the indicator riding along, and letting go settles
 * on the nearest page, carried on by the finger's speed. Icons cross-fade between outlined and solid
 * and their colour follows the selection, like the native bar. The slide is watched before the
 * buttons see it, and a tap that wobbles less than the slop stays a tap.
 */
function BottomBar({ tabs, pos, start, listeners, pop, onTap, onSettle }: {
  tabs: Tab[]; pos: ShellPos; start: number; listeners: Set<(i: number) => void>; pop: MutableRefObject<(() => void) | undefined>;
  onTap: (i: number) => void; onSettle: (i: number, velocity?: number, jump?: boolean) => void;
}) {
  const [selected, setSelected] = useState(start);
  useEffect(() => { listeners.add(setSelected); return () => { listeners.delete(setSelected); }; }, [listeners]);
  const bar = useRef<HTMLElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const settleRef = useRef(onSettle);
  settleRef.current = onSettle;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
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
    // dir: 1 when the pages follow the finger along the bar (the indicator under it), -1 when reversed
    // in Settings (a slide to the right goes back, as a swipe on the pages does).
    // turner: Settings has the bar change days and weeks (300), on a page that has them.
    let g: { id: number; x0: number; from: number; sliding: boolean; vt: VelocityTracker; lastX: number; w: number; dir: 1 | -1; turner: PageTurner | null } | null = null;
    const tabW = () => g?.w ?? el.clientWidth / tabsRef.current.length;
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      g = null;
    };
    const onMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id || pos.rail) return; // the side rail is only tapped
      g.vt.addEvent(e, "x");
      g.lastX = e.clientX;
      const dx = e.clientX - g.x0;
      if (!g.sliding && Math.abs(dx) <= TOUCH_SLOP) return;
      if (!g.sliding) {
        g.x0 += Math.sign(dx) * TOUCH_SLOP;
        if (g.turner) g.turner.start(); else pill.current?.classList.remove("pop");
      }
      g.sliding = true;
      if (g.turner) { g.turner.move(e.clientX - g.x0); return; }
      // The pages go a little further than the finger, so a short slide turns a page.
      pos.follow(clamp(g.from + (g.dir * BAR_GAIN * (e.clientX - g.x0)) / tabW(), 0, pos.last));
    };
    // Whatever happens in [up], the slide ends: a throw mustn't leave the bar ignoring every touch.
    const onUp = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      try { up(e); } finally { stop(); }
    };
    const up = (e: PointerEvent) => {
      if (!g) return;
      if (g.sliding && g.turner) {
        swallowNextClick();
        g.turner.end(e.type === "pointerup" ? g.vt.velocity(e.timeStamp) : 0);
      } else if (g.sliding) {
        swallowNextClick();
        const at = clamp(g.from + (g.dir * BAR_GAIN * (g.lastX - g.x0)) / tabW(), 0, pos.last);
        const vx = g.dir * g.vt.velocity(e.timeStamp);
        // A flick turns a page whatever the distance; otherwise the nearest one.
        settleRef.current(barTarget(g.from, at, vx, pos.last), (BAR_GAIN * vx) / tabW());
      } else {
        // A tap, taken as the finger lifts (the tabs' own click is for the keyboard only).
        const tabEl = e.type === "pointerup" ? document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".p-tab") : null;
        if (tabEl && el.contains(tabEl)) tapRef.current(Number(tabEl.dataset.i));
        // Pages caught mid-settle by the finger and not sent anywhere by the tap go on where they were going.
        if (!pos.resting) settleRef.current(pos.target);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (g || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      pos.grab();
      const days = barDays();
      const turner = days ? turners[tabsRef.current[Math.round(pos.p)]?.key]?.current ?? null : null;
      g = { id: e.pointerId, x0: e.clientX, from: pos.p, sliding: false, vt: new VelocityTracker(), lastX: e.clientX, w: el.clientWidth / tabsRef.current.length, dir: !days && barSwipeReversed() ? -1 : 1, turner };
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
      <span className="p-pill-track" style={{ ["--tabs" as string]: tabs.length }} ref={(el) => { pos.pill = el; if (el) pos.paint(); }}>
        <span className="p-pill" ref={pill} />
      </span>
      {tabs.map((t, i) => (
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
 * The open note going into its chip (297), or out of it ([back]): the layer shrinks onto the place [to] and
 * fades as it gets there, on transform and opacity alone, so nothing is laid out while it moves.
 */
function noteMorph(el: HTMLElement, to: { left: number; top: number; width: number; height: number }, back: boolean) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const small = `translate3d(${to.left - r.left}px,${to.top - r.top}px,0) scale(${to.width / r.width},${to.height / r.height})`;
  const big = "translate3d(0,0,0) scale(1,1)";
  // Set around the animation, not in it: only transform and opacity keep it on the compositor. The layer
  // stays visible for it, and its usual entrance (p-in) keeps out of the way.
  el.style.visibility = "visible";
  el.style.transformOrigin = "0 0";
  el.style.animation = "none";
  const a = el.animate(back
    ? [{ transform: small, opacity: 0 }, { opacity: 1, offset: 0.45 }, { transform: big, opacity: 1 }]
    : [{ transform: big, opacity: 1 }, { opacity: 1, offset: 0.55 }, { transform: small, opacity: 0 }],
  { duration: back ? 260 : 230, easing: back ? "cubic-bezier(.2, 0, 0, 1)" : "cubic-bezier(.3, 0, .2, 1)" });
  const done = () => { el.style.visibility = ""; el.style.transformOrigin = ""; };
  a.onfinish = done;
  a.oncancel = done;
}

/** Where the chip sits, whatever it's doing: measured on its place, its own entrance doesn't count. */
function chipBox(): { left: number; top: number; width: number; height: number } | null {
  const chip = document.querySelector<HTMLElement>(".p-notechip"), place = chip?.parentElement;
  if (!chip || !place) return null;
  const p = place.getBoundingClientRect();
  return { left: p.left, top: p.bottom - chip.offsetHeight, width: chip.offsetWidth, height: chip.offsetHeight };
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
