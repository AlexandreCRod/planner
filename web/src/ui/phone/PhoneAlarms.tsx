// The Clock tab (69: the route is still "alarms"), drawn after the native AlarmsScreen.kt and ClockToolsPanes.kt: alarm clocks (the next
// one, a filter, close ones bundled, and the next week's task and event alarms), a timer, a stopwatch and a world clock, under the app's pill
// switch (287). The four sections also turn with a finger swiped sideways, live like a pager, with the
// switch's thumb riding along. Everything here is kept and rung by the native alarm engine (alarms/native.ts);
// in a browser the tab isn't shown.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import {
  type CalendarAlarm, CALENDAR_ALARM_DAYS, NARROW_DAYS, TIMER_PRESETS, MAX_STOPWATCHES, isRepeating, newStopwatchId, shownAfterReset, stopwatchLabel, stopwatchesOf, pauseText, tidySchedule, stopwatchParts, cityName, cityZones, daysText, elapsed, formatDuration, lapLengths,
  nextRing, presetText, repeatText, swipeRemoves, timerLeft, timerShare, timerUndoMs, untilText, zoneClock, zoneDayLabel, zoneOffsetLabel,
} from "../../domain/alarms.ts";
import { addMonths, dayShort, daysInMonth, epochOf, formatTime, monthLong, monthShort, relativeDay, startOfWeek, use24h, weekday, ymd } from "../../domain/dates.ts";
import { type ClockAlarm, type ClockTimer, act, alarmState, hasAlarms, native, onNative, refreshAlarmState, useAlarmState } from "../../alarms/native.ts";
import { onFlush, useSnapshot } from "../../store/store.ts";
import { openItem } from "../shared/common.tsx";
import { type Hourly, forecastView, useForecast, useWeather, weatherPage, weatherView } from "../../alarms/weather.ts";
import { cityLabel, searchCities, zoneOf } from "../../domain/cities.ts";
import {
  CLOCK_FILTERS, type ClockFilter, type SeriesPlan, SKIP_WINDOW_DAYS, applyWindow, buildSeries, bundleAlarms, nextRingDay, quickWindows, ringsBetween, seriesPlan, seriesProblem, seriesTimes,
  selectedAlarms, selectionSwitch, shiftBundle, rowPick, shownBy, skipEachNext, skipNext, skipText, skipTomorrow, skippedNext, skipsOn, switchAlarms, toggleAlarms, toggleFilter, unskip,
  unskipDay, windowCount, windowKeys,
} from "../../domain/clockList.ts";
import { clockPrefs, useClockPrefs } from "../../alarms/clockPrefs.ts";
import { useAlarmSettings } from "../../alarms/settings.ts";
import { AppBarActions, Dialog, DropdownMenu, EmptyState, FilterChip, HScroll, IconButton, MIcon, Segmented, TopAppBar } from "./chrome.tsx";
import { useHorizontalSwipe } from "./gesture.ts";
import { useHold as useLongPress } from "./hold.ts";
import { BottomSheet, ListItem, Switch, TextButton, showSnackbar } from "./m3.tsx";
import { MultiDatePickerDialog, TimePickerDialog } from "./pickers.tsx";
import { type RangePick, rangeRole, slideRange, tapRange } from "./range.ts";
import { spring, swipeTabs, useSwipePager } from "./pager.ts";
import { DurationWheels, HeldTime, TimeWheels } from "./TimeWheel.tsx";
import { SlideStepper } from "./SlideStepper.tsx";
import { feel } from "./haptics.ts";
import { LONG_PRESS, TOUCH_SLOP } from "./press.ts";
import { mouseMenu } from "./desk.ts";
import { pushBack } from "./native.ts";
import { SelectedMark } from "./Select.tsx";

type Section = "alarm" | "timer" | "stopwatch" | "world";
const SECTIONS: [Section, string][] = [["alarm", "Alarms"], ["timer", "Timer"], ["stopwatch", "Stopwatch"], ["world", "World clock"]];
const LAST = SECTIONS.length - 1;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// A notification (or the quick-add line) can ask for a section; the page picks it up when it's shown.
let wanted: Section | null = null;
const wantListeners = new Set<() => void>();
/** Shows [section] the next time the Alarms page is drawn (or at once if it is). */
export function openAlarmSection(section: string) {
  const s = SECTIONS.find(([k]) => k === section)?.[0];
  if (!s) return;
  wanted = s;
  wantListeners.forEach((l) => l());
}

// The shell's + button (fixed over every page) asks the Clock page to add something.
const addMenuListeners = new Set<() => void>();
/** The + button on the Clock page: adds an alarm, a timer or a city, by the section shown (70). */
export function openAlarmAddMenu() { addMenuListeners.forEach((l) => l()); }

/** Dialogs and sheets go to the top of the page, so the sliding sections don't carry or clip them. */
const Layer = ({ children }: { children: ReactNode }) => createPortal(children, document.body);

/** The time now, every [period] ms while [active] (rememberTick). */
function useTick(period: number, active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    let t = 0;
    const step = () => { const n = Date.now(); setNow(n); t = window.setTimeout(step, period - (n % period)); };
    t = window.setTimeout(step, period - (Date.now() % period));
    return () => clearTimeout(t);
  }, [period, active]);
  return now;
}

const relative = (d: Date) => relativeDay(epochOf(d.getFullYear(), d.getMonth() + 1, d.getDate()));
/** "Mon 20" (within a few weeks, the month goes without saying). */
const shortDay = (day: number) => `${dayShort(weekday(day))} ${ymd(day).d}`;
const todayNow = () => { const n = new Date(); return epochOf(n.getFullYear(), n.getMonth() + 1, n.getDate()); };
/** An alarm's repeat line, with a pause or skipped days after it ("Skips tomorrow", 75). */
const scheduleLine = (a: ClockAlarm, now: Date) =>
  [repeatText(a, now, relative), a.enabled ? skipText(a, todayNow(), shortDay) || pauseText(a, todayNow(), shortDay) : ""].filter(Boolean).join(" · ");

// ---------- Asking for permissions, with the reason ----------

interface Ask { title: string; text: string; resolve: (ok: boolean) => void }
let ask: Ask | null = null;
const askListeners = new Set<() => void>();
const setAsk = (a: Ask | null) => { ask = a; askListeners.forEach((l) => l()); };

/**
 * Makes sure notifications are allowed before something that needs them (an alarm, a timer), first
 * saying why. Android only asks twice; after that the app's settings page opens instead.
 */
export async function ensureNotifications(what: string): Promise<boolean> {
  if (!hasAlarms) return true;
  await refreshAlarmState();
  if (alarmState().perms.notifications) return true;
  const yes = await new Promise<boolean>((resolve) => setAsk({
    title: "Allow notifications?",
    text: `${what} Android will ask you to allow them.`,
    resolve,
  }));
  if (!yes) return false;
  const r = await native.requestNotifications();
  if (!r.granted) await native.openSettings("notifications");
  await refreshAlarmState();
  return r.granted;
}

/** Where the permission question shows (one per app, from PhoneApp). */
export function PermissionHost() {
  const a = useSyncExternalStore((l) => { askListeners.add(l); return () => { askListeners.delete(l); }; }, () => ask);
  if (!a) return null;
  const done = (ok: boolean) => { setAsk(null); a.resolve(ok); };
  return (
    <Dialog title={a.title} onClose={() => done(false)} actions={<>
      <TextButton onClick={() => done(false)}>Not now</TextButton>
      <TextButton onClick={() => done(true)}>Allow</TextButton>
    </>}>{a.text}</Dialog>
  );
}

/** Cards for what keeps alarms from ringing properly, each with the way to fix it. */
function PermissionCards() {
  const { perms } = useAlarmState();
  const cards: { text: string; button: string; onClick: () => void }[] = [];
  if (!perms.notifications) cards.push({
    text: "Notifications are off for this app, so alarms and timers can't ring or show.",
    button: "Allow", onClick: () => void ensureNotifications("Alarms ring and timers count down through notifications, so this app needs them allowed."),
  });
  if (perms.notifications && !perms.fullScreen) cards.push({
    text: "Full-screen alarms are off: a ringing alarm shows as a notification instead of filling the locked screen.",
    button: "Turn on", onClick: () => void native.openSettings("fullScreen"),
  });
  if (!perms.exact) cards.push({
    text: "Alarms & reminders access is off, so alarms may ring a few minutes late.",
    button: "Turn on", onClick: () => void native.openSettings("exact"),
  });
  if (!cards.length) return null;
  return <>{cards.map((c) => (
    <div key={c.text} className="pa-warn">
      <MIcon name="oInfo" />
      <span className="grow">{c.text}</span>
      <TextButton onClick={c.onClick}>{c.button}</TextButton>
    </div>
  ))}</>;
}

// ---------- The page ----------

/** The Clock tab. [active]: it's the page on screen (clocks only tick then). */
export function PhoneAlarms({ active }: { active: boolean }) {
  const st = useAlarmState();
  const [index, setIndex] = useState(() => {
    const i = wanted ? SECTIONS.findIndex(([k]) => k === wanted) : 0;
    wanted = null;
    return Math.max(0, i);
  });
  const idx = useRef(index);
  idx.current = index;
  const [editing, setEditing] = useState<{ alarm: ClockAlarm; isNew: boolean } | null>(null);
  // Several alarms picked (348): the top bar gives way to the selection's; back or ✕ ends it, as does leaving Alarms.
  const [sel, setSel] = useState<ReadonlySet<number>>(new Set());
  const selecting = sel.size > 0;
  useEffect(() => (selecting ? pushBack(() => setSel(new Set())) : undefined), [selecting]);
  useEffect(() => { if (index !== 0 || !active) setSel((x) => (x.size ? new Set() : x)); }, [index, active]);
  const listApi = useRef<{ skip: (group: ClockAlarm[]) => void } | null>(null);
  const addingSw = useRef(new Set<number>());
  const [newTimer, setNewTimer] = useState(false);
  const [addZone, setAddZone] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  /** The pill switch's thumb, moved along by a swipe between sections (as on Tasks and Progress). */
  const track = useRef<((p: number | null) => void) | null>(null);
  const stopSlide = useRef<(() => void) | null>(null);
  // The + button adds what the section shown holds (70): an alarm, a timer, a city, or another stopwatch
  // running beside the first (327).
  const addHere = useRef<() => void>(() => {});
  addHere.current = () => {
    const k = SECTIONS[idx.current][0];
    if (k === "alarm") newAlarm();
    else if (k === "timer") setNewTimer(true);
    else if (k === "world") setAddZone(true);
    else void addStopwatch();
  };
  useEffect(() => { const open = () => addHere.current(); addMenuListeners.add(open); return () => { addMenuListeners.delete(open); }; }, []);

  // Turning to a section another way: a tap on its tab slides there on the pager's spring.
  const show = (i: number) => {
    i = clamp(i, 0, LAST);
    const from = idx.current;
    if (i === from) return;
    stopSlide.current?.();
    const el = strip.current, w = el?.parentElement?.clientWidth ?? 0;
    flushSync(() => setIndex(i));
    if (!el || !w || Math.abs(i - from) > 1) { if (el) el.style.transform = ""; return; }
    const place = (x: number) => { el.style.transform = x ? `translate3d(${x}px,0,0)` : ""; };
    stopSlide.current = spring((i - from) * w, 0, 0, place, () => { stopSlide.current = null; place(0); });
  };
  useEffect(() => {
    const on = () => { if (wanted) { const i = SECTIONS.findIndex(([k]) => k === wanted); wanted = null; if (i >= 0) show(i); } };
    wantListeners.add(on);
    on();
    return () => { wantListeners.delete(on); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pager = useSwipePager<HTMLDivElement>({
    layers: () => [strip.current],
    onStep: (d) => setIndex((i) => clamp(i + d, 0, LAST)),
    canStep: (d) => idx.current + d >= 0 && idx.current + d <= LAST,
    onMove: (x, w) => { stopSlide.current?.(); stopSlide.current = null; track.current?.(idx.current - x / w); },
    onSettled: () => track.current?.(null),
    allow: (t) => !t.closest(".p-switch, input, textarea, .pa-noswipe"),
    yieldAtEdge: swipeTabs,
  });

  const newAlarm = () => {
    show(0);
    setEditing({ alarm: { id: 0, hour: 7, minute: 0, label: "", days: 0, enabled: true, color: 0, sound: null }, isNew: true });
  };
  /** Another stopwatch, counting at once; up to MAX_STOPWATCHES. */
  const addStopwatch = async () => {
    // Quick taps count the ones still on their way to the engine too.
    const list = [...stopwatchesOf(alarmState().tools), ...[...addingSw.current].map((id) => ({ id }))];
    const id = newStopwatchId(list, Date.now());
    if (id === null) { showSnackbar(`Up to ${MAX_STOPWATCHES} stopwatches`); return; }
    addingSw.current.add(id);
    try { await act(native.stopwatch("add", { id })); } finally { addingSw.current.delete(id); }
  };

  return (
    <div className="p-scaffold pa-page">
      {selecting
        ? <AlarmSelectionBar picked={selectedAlarms(st.alarms, sel)} onClear={() => setSel(new Set())} onSkip={(g) => listApi.current?.skip(g)} />
        : <TopAppBar title="Clock" actions={<AppBarActions />} />}
      {/* The pill switch, as for every choice of 2–4 sections (287); a swipe between sections moves its thumb. */}
      <div className="pa-tabs">
        <Segmented value={SECTIONS[index][0]} options={SECTIONS} track={track} onChange={(k) => show(SECTIONS.findIndex(([x]) => x === k))} />
      </div>
      <div className="pa-pager" ref={pager}>
        <div className="pa-strip" ref={strip} style={{ left: `${-index * 100}%` }}>
          {SECTIONS.map(([k], i) => (
            <div key={k} className="pa-section" style={{ left: `${i * 100}%` }} aria-hidden={i !== index}>
              {Math.abs(i - index) <= 1 || k === "alarm" ? (
                k === "alarm" ? <AlarmList alarms={st.alarms} zone={st.zone} rings={st.ring} active={active && index === i} onEdit={(a) => setEditing({ alarm: a, isNew: false })} onNew={newAlarm}
                  sel={sel} setSel={setSel} api={listApi} />
                  : k === "timer" ? <TimersPane timers={st.tools.timers} active={active && index === i} onNew={() => setNewTimer(true)} />
                    : k === "stopwatch" ? <StopwatchPane active={active && index === i} />
                      : <WorldClockPane zones={st.tools.zones} local={st.zone} active={active && index === i} onAdd={() => setAddZone(true)} />
              ) : null}
            </div>
          ))}
        </div>
      </div>
      {editing && <Layer><AlarmEditor alarm={editing.alarm} isNew={editing.isNew} group={seriesOf(editing.alarm, st.alarms)} onClose={() => setEditing(null)} /></Layer>}
      {newTimer && <Layer><NewTimerDialog onClose={() => setNewTimer(false)} /></Layer>}
      {addZone && <Layer><ZonePickerDialog local={st.zone} onClose={() => setAddZone(false)} /></Layer>}
    </div>
  );
}

// ---------- Alarms ----------

const save = (a: ClockAlarm) => act(native.saveClock(a));

/** The alarms of [a]'s series, in time order; none if it isn't in one (244). */
const seriesOf = (a: ClockAlarm, all: ClockAlarm[]) => (a.series == null ? [] : all.filter((x) => x.series === a.series).sort((x, y) => x.hour * 60 + x.minute - (y.hour * 60 + y.minute)));

function AlarmList({ alarms, zone, rings, active, onEdit, onNew, sel, setSel, api }: {
  alarms: ClockAlarm[]; zone: string; rings: { rings: boolean }; active: boolean; onEdit: (a: ClockAlarm) => void; onNew: () => void;
  sel: ReadonlySet<number>; setSel: (f: (s: ReadonlySet<number>) => ReadonlySet<number>) => void;
  api: React.MutableRefObject<{ skip: (group: ClockAlarm[]) => void } | null>;
}) {
  // No chip on shows every alarm; the list opens with the filter chosen in Settings (71).
  const [show, setShow] = useState<ClockFilter | null>(() => clockPrefs().defaultFilter);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const now = new Date(useTick(15_000, active));
  const list = alarms.filter((a) => shownBy(a, show, now));
  const groups = bundleAlarms(list, now, useClockPrefs().bundleWindow);
  const fc = useForecast(zone, active && alarms.some((a) => a.enabled));
  // Task and event alarms only where they ring: on this phone, while they're turned on.
  const cal = useCalendarAlarms(now.getTime(), hasAlarms && rings.rings);
  const [calOpen, setCalOpen] = useState(false);
  const [skipping, setSkipping] = useState<ClockAlarm[] | null>(null);
  /** The skip sheet is for alarms picked together (the selection's Skip…), not a card's bundle. */
  const [skipPicks, setSkipPicks] = useState(false);
  const skipCard = (g: ClockAlarm[]) => { setSkipPicks(false); setSkipping(g); };
  /** The Skip days sheet (317): for a bundle or an alarm, or every alarm, starting on one of its quick windows. */
  const [skipDays, setSkipDays] = useState<{ group: ClockAlarm[]; scope: SkipScope; quick: string } | null>(null);
  api.current = { skip: (g) => { setSkipPicks(true); setSkipping(g); } };
  const selecting = sel.size > 0;
  /** While selecting, a tap or hold on a card picks it (a bundle: all its alarms) or unpicks it (348). */
  const pick = (g: ClockAlarm[]) => setSel((s) => toggleAlarms(s, g.map((a) => a.id)));
  const picked = (g: ClockAlarm[]) => g.every((a) => sel.has(a.id));
  const groupOf = (a: ClockAlarm) => bundleAlarms(alarms, now, clockPrefs().bundleWindow).find((g) => g.some((x) => x.id === a.id)) ?? [a];
  return (
    // While selecting, a card's switch, Skip, start time and digits are inert: a tap there picks the card (phone.css).
    <div className={`pa-scroll ${selecting ? "selecting" : ""}`}>
      <PermissionCards />
      {!rings.rings && (
        <div className="pa-note"><MIcon name="oInfo" size={20} /><span>Event and task alarms are off on this phone. Turn them on in Settings.</span></div>
      )}
      {/* The top Skip… opens the Skip days sheet on every alarm (a holiday), at the next ring. */}
      <NextAlarm alarms={alarms} calendar={cal} now={now} onSkip={(a) => setSkipDays({ group: groupOf(a), scope: "all", quick: "Next ring" })} />
      {cal.length > 0 && (
        <button className="pa-cal-line" onClick={() => setCalOpen(true)}>
          <MIcon name="oCalendarToday" size={18} />
          <span>{cal.length === 1 ? "1 calendar alarm" : `${cal.length} calendar alarms`} today and tomorrow</span>
          <MIcon name="fKeyboardArrowRight" size={18} />
        </button>
      )}
      {alarms.length > 0 && (
        <HScroll className="pa-filter pa-noswipe">
          {CLOCK_FILTERS.map(([k, l]) => <FilterChip key={k} selected={show === k} onClick={() => setShow((f) => toggleFilter(f, k))}>{l}</FilterChip>)}
        </HScroll>
      )}
      {list.length === 0 && <EmptyState icon="oAlarm" title={!alarms.length ? (cal.length ? "No clock alarms" : "No alarms") : show === "weekdays" ? "No weekday alarms" : show === "weekend" ? "No weekend alarms" : show === "on" ? "No active alarms" : "No inactive alarms"} hint="Tap + to add one"
        onIcon={onNew} iconLabel="New alarm" />}
      {groups.map((g) => g.length === 1
        ? <AlarmCard key={g[0].id} a={g[0]} now={now} fc={fc} picked={selecting ? picked(g) : undefined}
          onClick={() => (selecting ? pick(g) : onEdit(g[0]))} onHold={() => (selecting ? pick(g) : skipCard(g))} />
        : <BundleCard key={g[0].id} group={g} now={now} fc={fc} open={g.some((a) => open[a.id])} picked={selecting ? picked(g) : undefined} sel={selecting ? sel : undefined}
          onOpen={() => (selecting ? pick(g) : setOpen((o) => toggleOpen(o, g)))} onEdit={(a) => (selecting ? pick(rowPick(a, g)) : onEdit(a))} onHold={() => (selecting ? pick(g) : skipCard(g))} />)}
      {calOpen && <CalendarAlarmsDialog list={cal} onClose={() => setCalOpen(false)} />}
      {skipping && <Layer><SkipSheet group={skipping} picks={skipPicks} now={now} onClose={() => setSkipping(null)} onSelect={selecting ? undefined : () => setSel(() => new Set(skipping.map((a) => a.id)))}
        onDays={() => setSkipDays({ group: skipping, scope: "group", quick: "Rest of week" })} /></Layer>}
      {skipDays && <Layer><SkipDaysSheet all={alarms} group={skipDays.group} scope0={skipDays.scope} quick0={skipDays.quick} now={now} onClose={() => setSkipDays(null)} /></Layer>}
    </div>
  );
}

/**
 * While a card's Skip can still be undone (369), what it skipped ("won't ring tomorrow"): if that was the only alarm
 * on, the "Alarm in ..." line at the top stays in place saying so, so the card and its Undo don't jump up.
 */
let skipHeld: string | null = null;
const skipHeldListeners = new Set<() => void>();
const holdSkip = (text: string | null) => { skipHeld = text; skipHeldListeners.forEach((l) => l()); };
const useSkipHeld = () => useSyncExternalStore((l) => { skipHeldListeners.add(l); return () => { skipHeldListeners.delete(l); }; }, () => skipHeld);

function NextAlarm({ alarms, calendar, now, onSkip }: { alarms: ClockAlarm[]; calendar: CalendarAlarm[]; now: Date; onSkip: (a: ClockAlarm) => void }) {
  const rings: { at: Date; title?: string; alarm?: ClockAlarm }[] = alarms.filter((a) => a.enabled)
    .map((alarm) => ({ at: nextRing(alarm, now), alarm })).filter((r): r is { at: Date; alarm: ClockAlarm } => r.at !== null);
  // The calendar's next one too (the list is soonest first; a skipped one doesn't ring).
  const c = calendar.find((x) => !x.skipped);
  if (c) rings.push({ at: new Date(c.at), title: c.title.trim() || "Untitled" });
  const held = useSkipHeld();
  if (!rings.length) {
    return held ? (
      <div className="pa-next">
        <div className="pa-next-head"><div className="t-title-large grow">No alarm on</div></div>
        <div className="t-body-medium muted pa-line">{held}</div>
      </div>
    ) : null;
  }
  const { at, title, alarm } = rings.reduce((x, y) => (y.at < x.at ? y : x));
  return (
    <div className="pa-next">
      <div className="pa-next-head">
        <div className="t-title-large grow">Alarm in {untilText(at, now)}</div>
        {/* The next clock alarm (or its bundle) can be skipped from here (75). */}
        {alarm && <TextButton onClick={() => onSkip(alarm)}>Skip…</TextButton>}
      </div>
      <div className="t-body-medium muted pa-line">{relative(at)} at {formatTime(at.getHours() * 60 + at.getMinutes())}{title ? ` · ${title}` : ""}</div>
    </div>
  );
}

// ---------- Task and event alarms ("From calendar") ----------

/**
 * Today's and tomorrow's task and event alarms, worked out by the engine itself with its skips and early
 * snoozes (AlarmScheduler.upcoming, 194), read again each minute and whenever the engine says they changed.
 * Empty when [on] is false.
 */
function useCalendarAlarms(now: number, on: boolean): CalendarAlarm[] {
  const [list, setList] = useState<CalendarAlarm[]>([]);
  // Minute by minute is plenty: the list moves on as alarms pass (and a new day comes in at midnight).
  const minute = Math.floor(now / 60_000);
  const [stamp, setStamp] = useState(0);
  useEffect(() => {
    if (!on) return;
    // The engine's skips, snoozes and data changed (a push from this page: "mirror").
    return onNative("changed", (what) => { if (["overrides", "resume", "mirror", "done", "ring"].includes(what)) setStamp((n) => n + 1); });
  }, [on]);
  useEffect(() => {
    if (!on) { setList([]); return; }
    let live = true;
    void native.calendarAlarms(CALENDAR_ALARM_DAYS).then((l) => { if (live) setList(l); });
    return () => { live = false; };
  }, [on, minute, stamp]);
  return useMemo(() => list.filter((a) => (a.skipped ? a.original : a.at) > minute * 60_000), [list, minute]);
}

/** How many show before "more": the group stays compact. */
/**
 * Today's and tomorrow's task and event alarms in a small window, opened from the line under the next
 * alarm: time, day and title; tapping one opens its item. Skip keeps that one occurrence from ringing (as
 * Stop on the upcoming-alarm notice does), with Undo; a skipped one stays listed, greyed, until it's put
 * back or its time passes.
 */
function CalendarAlarmsDialog({ list, onClose }: { list: CalendarAlarm[]; onClose: () => void }) {
  const snap = useSnapshot();
  const minOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
  const skip = (a: CalendarAlarm) => {
    const d = new Date(a.at);
    const day = relative(d);
    void act(native.earlyStop(a.reminderId, a.original));
    showSnackbar(`It won't ring ${day === "Today" || day === "Tomorrow" ? day.toLowerCase() : day} at ${formatTime(minOf(d))}`, "Undo",
      () => void act(native.resetAlarm(a.reminderId, a.original)));
  };
  const unskip = (a: CalendarAlarm) => void act(native.resetAlarm(a.reminderId, a.original));
  return (
    <Dialog title="From calendar" onClose={onClose} actions={<TextButton onClick={onClose}>Close</TextButton>}>
      {list.length === 0 && <div className="t-body-medium">No calendar alarms today or tomorrow.</div>}
      {list.map((a) => {
        const item = snap.byId.get(a.itemId);
        const d = new Date(a.at);
        return (
          <div key={`${a.reminderId}:${a.original}`} className={`pa-cal-row ${a.skipped ? "off" : ""}`} role="button"
            onClick={() => { if (item) { onClose(); openItem(item, a.day); } }}>
            <span className={`pa-cal-time ${a.skipped ? "pa-cal-skipped" : ""}`}>{formatTime(minOf(d))}</span>
            <span className="pa-cal-day">{a.skipped ? `Skipped · ${relative(d)}` : relative(d)}</span>
            <span className="pa-cal-title">{a.title.trim() || "Untitled"}</span>
            <button className="p-text-btn pa-cal-skip" onClick={(e) => { e.stopPropagation(); if (a.skipped) unskip(a); else skip(a); }}>{a.skipped ? "Undo" : "Skip"}</button>
          </div>
        );
      })}
    </Dialog>
  );
}

/** The weather when [a] next rings: a small symbol and °C, or nothing past the forecast (or while off). */
function AlarmWeather({ a, now, fc }: { a: ClockAlarm; now: Date; fc: Hourly | null }) {
  const v = a.enabled ? forecastView(fc, nextRing(a, now)) : null;
  if (!v) return null;
  return <span className="pa-cardwx" aria-label={`${v.label}, ${v.text} when it rings`}><MIcon name={v.icon} size={18} />{v.text}</span>;
}

function AlarmCard({ a, now, fc, picked, onClick, onHold }: { a: ClockAlarm; now: Date; fc: Hourly | null; picked?: boolean; onClick: () => void; onHold: () => void }) {
  const hold = useHold(onHold, onClick);
  return (
    <div className={`pa-card pa-alarm ${a.enabled ? "" : "off"} ${picked ? "sel" : ""}`} role="button" aria-pressed={picked} {...hold}>
      {picked && <SelectedMark />}
      <div className="grow">
        {a.label.trim() && <div className="t-body-medium pa-label pa-line">{a.label.trim()}</div>}
        <div className="pa-time48"><HeldTime step={1} min={a.hour * 60 + a.minute} onHoldStill={onHold} onChange={(m) => void save({ ...a, hour: Math.floor(m / 60), minute: m % 60 })} /></div>
        <div className="t-body-medium muted pa-line">{scheduleLine(a, now)}</div>
      </div>
      <AlarmWeather a={a} now={now} fc={fc} />
      <div className="pa-side">
        <Switch checked={a.enabled} label="On" onChange={(v) => void save({ ...a, enabled: v })} />
        <SkipButton group={[a]} now={now} />
      </div>
    </div>
  );
}

const saveAll = (list: ClockAlarm[]) => Promise.all(list.map((a) => native.saveClock(a))).then(refreshAlarmState);
/** "today", "tomorrow" or "Tue 3", after "won't ring". */
const dayWord = (d: number, today: number) => (d === today ? "today" : d === today + 1 ? "tomorrow" : shortDay(d));
/** When [group] would ring on [day], skips aside: "Tomorrow at 07:00", for a button's hover text. */
const ringWhen = (group: ClockAlarm[], day: number) => {
  const { y, m, d } = ymd(day);
  const mins = group.filter((a) => a.enabled).map((a) => a.hour * 60 + a.minute);
  return `${relative(new Date(y, m - 1, d))} at ${formatTime(mins.length ? Math.min(...mins) : 0)}`;
};

/**
 * The one-tap Skip under a card's switch (317): the alarm, or the whole bundle, doesn't ring the next time it
 * would, with Undo in the message; the card then says "Skips tomorrow" and the button turns into Undo, which
 * brings that ring back. Hidden (but keeping its room) while there's nothing to skip.
 */
function SkipButton({ group, now }: { group: ClockAlarm[]; now: Date }) {
  const today = todayNow();
  /**
   * What a Skip just changed, while its Undo can still put it back (369): a one-off alarm skipped is simply off,
   * so without this its card would lose the button, and Undo would only be in the message at the bottom.
   */
  const [just, setJust] = useState<{ before: ClockAlarm[]; day: number } | null>(null);
  const skipped = skippedNext(group, now);
  const day = skipped ?? (just && group.every((a) => !a.enabled || !just.before.some((b) => b.id === a.id)) ? just.day : null);
  const next = day === null ? skipNext(group, now) : [];
  const nextDay = day ?? nextRingDay(group, now);
  if (nextDay === null || (day === null && !next.length)) return <span className="pa-skipbtn none" aria-hidden="true" />;
  const many = group.length > 1;
  const when = ringWhen(group, nextDay);
  const tap = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (day !== null) {
      setJust(null); holdSkip(null);
      void saveAll(skipped !== null ? unskipDay(group, day) : just?.before ?? []);
      return;
    }
    const before = group.filter((a) => next.some((c) => c.id === a.id));
    void saveAll(next);
    setJust({ before, day: nextDay });
    const text = `${many ? "These alarms" : "It"} won't ring ${dayWord(nextDay, today)}`;
    holdSkip(`${many ? "These alarms won't" : "It won't"} ring ${dayWord(nextDay, today)}`);
    showSnackbar(text, "Undo", () => { setJust(null); holdSkip(null); void saveAll(before); },
      { onGone: () => { setJust(null); holdSkip(null); } });
  };
  // Undo takes Skip's place, as quiet as Skip was (369: not a filled button).
  return (
    <button className={`p-text-btn pa-skipbtn ${day !== null ? "undo" : ""}`} onClick={tap}
      title={day !== null ? `Ring ${dayWord(day, today)} after all` : `Skip ${when}`}
      aria-label={day !== null ? `Undo skip: ring ${dayWord(day, today)}` : `Skip ${when}`}>
      {day !== null ? "Undo" : "Skip"}
    </button>
  );
}

/** Inside an open bundle, each alarm's own skip (317): a symbol, lit while its next ring is skipped. */
function RowSkip({ a, now }: { a: ClockAlarm; now: Date }) {
  const today = todayNow();
  const day = skippedNext([a], now);
  const next = day === null ? skipNext([a], now) : [];
  const nextDay = day ?? nextRingDay([a], now);
  if (nextDay === null || (day === null && !next.length)) return <span className="pa-rowskip none" aria-hidden="true" />;
  const label = day !== null ? `${formatTime(a.hour * 60 + a.minute)} rings ${dayWord(day, today)} after all` : `Skip ${formatTime(a.hour * 60 + a.minute)} ${dayWord(nextDay, today)}`;
  return (
    <button className={`p-icon pa-rowskip ${day !== null ? "on" : ""}`} aria-pressed={day !== null} aria-label={label} title={label}
      onClick={(e) => {
        e.stopPropagation();
        if (day !== null) { void saveAll(unskipDay([a], day)); return; }
        void saveAll(next);
        showSnackbar(`${formatTime(a.hour * 60 + a.minute)} won't ring ${dayWord(nextDay, today)}`, "Undo", () => void save(a));
      }}>
      <MIcon name="oAlarmOff" size={20} />
    </button>
  );
}

/** Marks every alarm of [group] open or closed, so the bundle stays open whichever of them is deleted. */
const toggleOpen = (open: Record<number, boolean>, group: ClockAlarm[]) => {
  const on = !group.some((a) => open[a.id]);
  return { ...open, ...Object.fromEntries(group.map((a) => [a.id, on])) };
};

/** Deletes an alarm or a whole bundle or series, with Undo putting them back as they were. */
function deleteAlarms(group: ClockAlarm[]) {
  const gone = Promise.all(group.map((a) => native.deleteClock(a.id)));
  void act(gone);
  showSnackbar(group.length === 1 ? "Alarm removed" : `${group.length} alarms removed`, "Undo",
    () => void gone.then((taken) => Promise.all(group.map((a, i) => native.saveClock(a, taken[i].snoozeUntil)))).then(refreshAlarmState));
}

/**
 * The top bar while several alarms are picked (348): ✕, how many, then what fits them all: Skip… (the skip
 * popup for them together), the switch (off while any is on, else on) and Delete, each with Undo. Each action
 * ends the selection.
 */
function AlarmSelectionBar({ picked, onClear, onSkip }: { picked: ClockAlarm[]; onClear: () => void; onSkip: (group: ClockAlarm[]) => void }) {
  const to = selectionSwitch(picked);
  const n = picked.length, them = n === 1 ? "Alarm" : `${n} alarms`;
  const flip = () => {
    const changed = switchAlarms(picked, to);
    onClear();
    if (!changed.length) return;
    const before = picked.filter((a) => changed.some((c) => c.id === a.id));
    void saveAll(changed);
    showSnackbar(`${changed.length === 1 ? "Alarm" : `${changed.length} alarms`} turned ${to}`, "Undo", () => void saveAll(before));
  };
  return (
    <header className="p-appbar p-selbar pa-selbar">
      <IconButton icon="fClose" label="Stop selecting" onClick={onClear} />
      <div className="p-appbar-title">{n} selected</div>
      <TextButton onClick={() => { onClear(); onSkip(picked); }} disabled={!n}>Skip…</TextButton>
      <TextButton onClick={flip} disabled={!n} aria-label={`Turn ${them.toLowerCase()} ${to}`}>{to === "off" ? "Turn off" : "Turn on"}</TextButton>
      <IconButton icon="oDelete" label="Delete" disabled={!n} onClick={() => { onClear(); deleteAlarms(picked); }} />
    </header>
  );
}

function BundleCard({ group, now, fc, open, picked, sel, onOpen, onEdit, onHold }: {
  group: ClockAlarm[]; now: Date; fc: Hourly | null; open: boolean; picked?: boolean; sel?: ReadonlySet<number>; onOpen: () => void; onEdit: (a: ClockAlarm) => void; onHold: () => void;
}) {
  const hold = useHold(onHold, onOpen);
  const on = group.filter((a) => a.enabled).length;
  const first = group[0], last = group[group.length - 1];
  // A series has the one switch (244): its rows only open the editor, for the whole series.
  const series = first.series != null;
  const h24 = use24h();
  const [picking, setPicking] = useState(false);
  const firstMin = first.hour * 60 + first.minute;
  const skipDayOf = skippedNext(group, now);
  /** The heading time moved: every alarm in the bundle moves as much (110), with Undo. */
  const moveTo = (to: number) => {
    const moved = shiftBundle(group, to);
    const by = moved[0].hour * 60 + moved[0].minute - firstMin;
    if (!by) return;
    void Promise.all(moved.map((a) => native.saveClock(a))).then(refreshAlarmState);
    const m = Math.abs(by), span = m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
    showSnackbar(`${group.length} alarms moved ${span} ${by > 0 ? "later" : "earlier"}`, "Undo",
      () => void Promise.all(group.map((a) => native.saveClock(a))).then(refreshAlarmState));
  };
  return (
    <div className={`pa-card pa-bundle ${on ? "" : "off"} ${picked ? "sel" : ""}`} aria-pressed={picked}>
      {picked && <SelectedMark />}
      <div className="pa-bundle-head" role="button" {...hold}>
        <div className="grow">
          {/* The weather once for the bundle (74): when its first alarm that's on rings next. */}
          <div className="t-body-medium muted pa-bundle-count">
            <span>{[series ? [first.label.trim(), `${group.length} alarms`, `every ${seriesPlan(group).every} min`].filter(Boolean).join(" · ") : skipDayOf !== null ? `${group.length} alarms` : `${group.length} alarms · ${on} on`,
              skipDayOf !== null ? skipsOn(skipDayOf, todayNow(), shortDay) : ""].filter(Boolean).join(" · ")}</span>
            <AlarmWeather a={group.find((a) => a.enabled) ?? first} now={now} fc={fc} />
          </div>
          {/* The first time can be held (a drum) or tapped (the time picker): the whole bundle moves with it. */}
          <div className={`pa-time36 ${h24 ? "" : "h12"}`}>
            <span className="pa-bundle-start" role="button" aria-label="Move the whole bundle" onClick={(e) => { e.stopPropagation(); setPicking(true); }}>
              <HeldTime step={1} min={firstMin} onHoldStill={onHold} onChange={moveTo} />
            </span> – {formatTime(last.hour * 60 + last.minute)}
          </div>
        </div>
        <span className="muted pa-expand"><MIcon name={open ? "fExpandLess" : "fExpandMore"} /></span>
        <div className="pa-side">
          <Switch checked={on > 0} label="All on" onChange={(v) => void Promise.all(group.map((a) => native.saveClock({ ...a, enabled: v }))).then(refreshAlarmState)} />
          <SkipButton group={group} now={now} />
        </div>
      </div>
      <div className={`pa-bundle-body ${open ? "open" : ""}`}>
        <div>
          {group.map((a) => {
            // While selecting, a row picked on its own has the card's outline and tick (a whole bundle: the card's).
            const rowSel = !!sel && !picked && sel.has(a.id);
            return (
            <div key={a.id} className={`pa-bundle-row ${a.enabled ? "" : "off"} ${rowSel ? "sel" : ""}`} role="button" aria-pressed={sel ? sel.has(a.id) : undefined} onClick={() => onEdit(a)}>
              {rowSel && <SelectedMark />}
              <div className="grow">
                <div className="pa-time24">{formatTime(a.hour * 60 + a.minute)}</div>
                <div className="t-body-small muted pa-line">{[a.label.trim(), scheduleLine(a, now)].filter(Boolean).join(" · ")}</div>
              </div>
              <RowSkip a={a} now={now} />
              {!series && <Switch checked={a.enabled} label="On" onChange={(v) => void save({ ...a, enabled: v })} />}
            </div>
            );
          })}
          <div className="pa-bundle-foot"><TextButton className="icon" onClick={() => deleteAlarms(group)}><MIcon name="oDelete" size={18} /> Delete all</TextButton></div>
        </div>
      </div>
      {picking && <Layer><TimePickerDialog step={1} value={firstMin} onPick={moveTo} onClose={() => setPicking(false)} /></Layer>}
    </div>
  );
}

/** Eats the click that may follow a lifted finger, wherever it lands (for the next 400 ms). */
function swallowNextClick() {
  const eat = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); };
  window.addEventListener("click", eat, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 400);
}

/**
 * A tap or a long press (a right-click with the mouse) on an alarm card: handlers to spread on it. A press
 * on the held digits, a switch or the bundle's start time is theirs, not the card's; the digits hand a hold
 * that lifts without moving back to the card (347), so only a hold that moves on turns their drum.
 */
function useHold(onHold: () => void, onTap: () => void) {
  const st = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const cb = useRef({ onHold, onTap });
  cb.current = { onHold, onTap };
  // The bundle's start time is the card's to hold between its digits (its tap opens the time picker).
  const theirs = (t: EventTarget) => t instanceof Element && !!t.closest(".tw-part, .p-switch, .pa-skipbtn, .pa-rowskip");
  const cancel = () => { if (st.current) clearTimeout(st.current.timer); };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      cancel();
      if (theirs(e.target) || (e.pointerType === "mouse" && e.button !== 0)) { st.current = null; return; }
      const p = { timer: 0, x: e.clientX, y: e.clientY, fired: false };
      p.timer = window.setTimeout(() => { p.fired = true; feel("pickup"); cb.current.onHold(); }, LONG_PRESS);
      st.current = p;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = st.current;
      if (p && !p.fired && (Math.abs(e.clientX - p.x) > TOUCH_SLOP || Math.abs(e.clientY - p.y) > TOUCH_SLOP)) { clearTimeout(p.timer); st.current = null; }
    },
    // After a hold the finger's lift mustn't land as a tap on what the hold opened (the sheet's scrim).
    onPointerUp: () => { cancel(); if (st.current?.fired) swallowNextClick(); },
    onPointerCancel: () => { cancel(); st.current = null; },
    // A tap on the digits is the card's (306): only their hold is theirs, and it swallows its own click.
    onClick: (e: React.MouseEvent) => {
      const p = st.current;
      st.current = null;
      if (!p?.fired && !(e.target instanceof Element && e.target.closest(".p-switch, .pa-bundle-start, .pa-skipbtn, .pa-rowskip"))) cb.current.onTap();
    },
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); if (mouseMenu(e)) { cancel(); st.current = null; cb.current.onHold(); } },
  };
}

/**
 * Skipping (75), from a long press on an alarm or a bundle, or "Skip…" by the next alarm: the next ring,
 * tomorrow's, or ringing as usual again; each with Undo. The engine already rings by the skip days.
 */
function SkipSheet({ group, picks, now, onClose, onDays, onSelect }: { group: ClockAlarm[]; picks?: boolean; now: Date; onClose: () => void; onDays: () => void; onSelect?: () => void }) {
  const today = todayNow();
  const nextDay = nextRingDay(group, now);
  // Alarms picked together skip each one's own next ring; a bundle (or one alarm) the day it next rings.
  const next = picks ? skipEachNext(group, now) : skipNext(group, now), tomorrow = skipTomorrow(group, now);
  const nextDays = new Set(group.map((a) => nextRingDay([a], now)).filter((d) => d !== null));
  const eachOwn = picks && nextDays.size > 1;
  const back = group.map((a) => unskip(a, today)).filter((a): a is ClockAlarm => a !== null);
  const first = group[0], last = group[group.length - 1];
  const many = group.length > 1;
  const title = picks && many ? `${group.length} selected alarms` : many ? `${formatTime(first.hour * 60 + first.minute)} – ${formatTime(last.hour * 60 + last.minute)} · ${group.length} alarms`
    : `${formatTime(first.hour * 60 + first.minute)}${first.label.trim() ? ` · ${first.label.trim()}` : ""}`;
  const dayWord = (d: number) => (d === today ? "today" : d === today + 1 ? "tomorrow" : shortDay(d));
  /** Saves [changed], with Undo putting back how they were. */
  const apply = (changed: ClockAlarm[], text: string) => {
    if (!changed.length) return;
    const before = group.filter((a) => changed.some((c) => c.id === a.id));
    void Promise.all(changed.map((a) => native.saveClock(a))).then(refreshAlarmState);
    showSnackbar(text, "Undo", () => void Promise.all(before.map((a) => native.saveClock(a))).then(refreshAlarmState));
  };
  const what = many ? "These alarms" : "It";
  // The first ring of that day, for the "Skip next" line.
  const nextAt = group.filter((a) => a.enabled).map((a) => nextRing(a, now)).filter((d): d is Date => d !== null).sort((x, y) => +x - +y)[0];
  return (
    <BottomSheet onClose={onClose}>{(close) => (
      <div className="pa-skip">
        <div className="p-sheet-title">{title}</div>
        {next.length > 0 && nextDay !== null && nextAt && (
          <ListItem leading={<MIcon name="oAlarmOff" />} headline="Skip next" supporting={eachOwn ? "Each one's next ring" : `${relative(nextAt)} at ${formatTime(nextAt.getHours() * 60 + nextAt.getMinutes())}`}
            onClick={() => { close(); apply(next, eachOwn ? "These alarms skip their next ring" : `${what} won't ring ${dayWord(nextDay)}`); }} />
        )}
        {tomorrow.length > 0 && nextDay !== today + 1 && (
          <ListItem leading={<MIcon name="oEventBusy" />} headline="Skip tomorrow" supporting={many ? `None of them rings ${shortDay(today + 1)}` : `It won't ring ${shortDay(today + 1)}`}
            onClick={() => { close(); apply(tomorrow, `${what} won't ring tomorrow`); }} />
        )}
        {back.length > 0 && (
          <ListItem leading={<MIcon name="oAlarm" />} headline="Ring as usual" supporting="Stop skipping days"
            onClick={() => { close(); apply(back, many ? "These alarms ring as usual again" : "It rings as usual again"); }} />
        )}
        {group.some((a) => a.enabled) && (
          <ListItem leading={<MIcon name="oCalendarToday" />} headline="Skip a few days…" supporting="Pick the days, see each ring, keep any"
            onClick={() => { close(); window.setTimeout(onDays, 210); }} />
        )}
        {!next.length && !tomorrow.length && !back.length && (
          <div className="pa-skip-none t-body-medium muted">{group.some((a) => a.enabled) ? "Nothing to skip: no ring is coming." : "Off, so there's nothing to skip."}</div>
        )}
        {many && <ListItem leading={<MIcon name="oDelete" />} headline={`Delete all ${group.length} alarms`} onClick={() => { close(); deleteAlarms(group); }} />}
        {/* Several alarms at once (348): this one picked, then a tap on others adds them. */}
        {onSelect && <ListItem leading={<MIcon name="oCheckBox" />} headline="Select more" supporting="Then tap other alarms to add them" onClick={() => { close(); onSelect(); }} />}
      </div>
    )}</BottomSheet>
  );
}

type SkipScope = "group" | "all";
const mondayFirst = () => localStorage.getItem("weekStartsMonday") !== "false";
const WEEK_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
/** "Tue 3 Nov". */
const dayLong = (d: number) => `${shortDay(d)} ${monthShort(ymd(d).m)}`;
const ringsWord = (n: number) => `${n} ${n === 1 ? "ring" : "rings"}`;

/**
 * Skip days (317, replacing the editor's Pause): pick a window (a quick chip, or two days on the calendar,
 * whose dots mark the days with rings), see every ring in it day by day, untick any to keep it ringing (a
 * bundle's row opens into its alarms), then "Skip 3 rings", with Undo. For this bundle or alarm, or for every
 * alarm. Rings already off (skipped, or paused by an older build) show ticked as already off; unticking one
 * makes it ring. On a wide window it's a dialog. [onApply]: the editor's draft takes the result instead of
 * it being saved.
 */
function SkipDaysSheet({ all, group, scope0, quick0, now, onClose, onApply }: {
  all: ClockAlarm[]; group: ClockAlarm[]; scope0: SkipScope; quick0: string; now: Date; onClose: () => void; onApply?: (changed: ClockAlarm[]) => void;
}) {
  const today = todayNow();
  const window0 = useClockPrefs().bundleWindow;
  const [scope, setScope] = useState<SkipScope>(scope0);
  // The alarms as they are now (the engine may have changed them since the sheet opened).
  const mine = group.map((g) => all.find((a) => a.id === g.id) ?? g);
  const scoped = scope === "all" ? all.filter((a) => a.enabled) : mine;
  const quick = quickWindows(today, nextRingDay(scoped, now));
  const [r, setR] = useState<RangePick>(() => {
    const q = quick.find(([n]) => n === quick0) ?? quick.find(([n]) => n === "Next 7 days")!;
    return { start: q[1], end: q[2], next: "start" };
  });
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [month, setMonth] = useState(() => { const { y, m } = ymd(r.start); return epochOf(y, m, 1); });
  const last = today + SKIP_WINDOW_DAYS - 1;
  const end = r.next === "end" ? r.start : r.end;
  const days = useMemo(() => ringsBetween(scoped, r.start, end, now, window0), [scoped, r.start, end, now, window0]);
  const off = new Set(windowKeys(days).filter((k) => !kept.has(k)));
  const count = windowCount(days, off);
  const keptN = days.reduce((n, d) => n + d.entries.reduce((m, e) => m + e.rings.filter((x) => !x.off && kept.has(x.key)).length, 0), 0);
  // The calendar: this month's days with a ring get a dot.
  const { y, m } = ymd(month);
  const n = daysInMonth(y, m);
  const lead = month - startOfWeek(month, mondayFirst());
  const dots = useMemo(() => new Set(ringsBetween(scoped, Math.max(today, month), Math.min(last, month + n - 1), now, window0).map((d) => d.day)), [scoped, month, n, today, last, now, window0]);
  const cells: (number | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: n }, (_, i) => month + i)];
  while (cells.length % 7) cells.push(null);
  const letters = mondayFirst() ? WEEK_LETTERS : [WEEK_LETTERS[6], ...WEEK_LETTERS.slice(0, 6)];
  const drag = useRef<{ id: number; anchor: number; last: number; moved: boolean } | null>(null);
  const dayAt = (x: number, yy: number) => {
    const el = document.elementFromPoint(x, yy)?.closest<HTMLElement>("[data-day]");
    const d = el ? Number(el.dataset.day) : NaN;
    return Number.isFinite(d) && d >= today && d <= last ? d : null;
  };
  const pick = (d: number) => { setR((x) => tapRange(x, d)); feel("tick"); };
  // The first quick choice that is the window picked ("Next ring" and "Tomorrow" can be the same day).
  const quickOn = r.next === "start" ? quick.find(([, a, b]) => a === r.start && b === r.end)?.[0] : undefined;
  const span = r.start === end ? dayLong(r.start) : `${shortDay(r.start)} – ${dayLong(end)}`;
  const nd = end - r.start + 1;
  const toggle = (keys: string[]) => setKept((k) => {
    const next = new Set(k);
    const anyTicked = keys.some((x) => !k.has(x));
    for (const x of keys) { if (anyTicked) next.add(x); else next.delete(x); }
    return next;
  });
  const keyed = (keys: string[]) => ({
    role: "checkbox" as const, tabIndex: 0,
    onClick: () => toggle(keys),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(keys); } },
  });
  const paused = scoped.filter((a) => a.pausedUntil != null && a.pausedUntil > today);
  const go = (close: () => void) => {
    const changed = applyWindow(days, off, today);
    close();
    if (!changed.length) return;
    if (onApply) { onApply(changed); return; }
    const before = changed.map((c) => all.find((a) => a.id === c.id)).filter((a): a is ClockAlarm => !!a);
    void saveAll(changed);
    const when = r.start === end ? dayWord(r.start, today) : `${shortDay(r.start)} – ${shortDay(end)}`;
    const text = !count.skips ? "Saved"
      : scope === "group" && !keptN ? `${group.length > 1 ? "These alarms" : "It"} won't ring ${when}` : `${ringsWord(count.skips)} skipped, ${when}`;
    showSnackbar(text, "Undo", () => void saveAll(before));
  };
  return (
    <BottomSheet onClose={onClose} className="pa-skipdays">{(close) => (
      // Esc closes it on the phone build too (the browser's Esc is the shell's: desk.ts).
      <div className="pa-sd" role="dialog" aria-label="Skip days" onKeyDown={(e) => { if (e.key === "Escape" && hasAlarms) { e.stopPropagation(); close(); } }}>
        <div className="p-sheet-title">Skip days</div>
        {!onApply && (
          <div className="pa-sd-chips">
            <FilterChip selected={scope === "group"} check onClick={() => setScope("group")}>{group.length > 1 ? "This bundle" : "This alarm"}</FilterChip>
            <FilterChip selected={scope === "all"} check onClick={() => setScope("all")}>All alarms</FilterChip>
          </div>
        )}
        <HScroll className="pa-sd-chips pa-sd-quick pa-noswipe">
          {quick.map(([name, a, b]) => (
            <FilterChip key={name} selected={name === quickOn} check onClick={() => { setR({ start: a, end: b, next: "start" }); const q = ymd(a); setMonth(epochOf(q.y, q.m, 1)); }}>{name}</FilterChip>
          ))}
        </HScroll>
        <div className="pa-sd-cal">
          <div className="p-dp-nav">
            <span className="p-dp-month static">{monthLong(m)} {y}</span>
            <span className="grow" />
            <IconButton icon="fKeyboardArrowLeft" label="Previous month" disabled={month <= today - ymd(today).d + 1} onClick={() => setMonth(addMonths(month, -1))} />
            <IconButton icon="fKeyboardArrowRight" label="Next month" disabled={month + n > last} onClick={() => setMonth(addMonths(month, 1))} />
          </div>
          <div className="p-dp-week">{letters.map((l, i) => <span key={i}>{l}</span>)}</div>
          {/* Tap the first day, then the last; or slide across them. */}
          <div className="p-dp-days p-mdp-days p-rdp-days pa-sd-days"
            onPointerDown={(e) => {
              if (drag.current || (e.pointerType === "mouse" && e.button !== 0)) return;
              const d = dayAt(e.clientX, e.clientY);
              if (d === null) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { id: e.pointerId, anchor: d, last: d, moved: false };
            }}
            onPointerMove={(e) => {
              const g = drag.current;
              if (!g || e.pointerId !== g.id) return;
              const d = dayAt(e.clientX, e.clientY);
              if (d === null || d === g.last) return;
              g.moved = true; g.last = d;
              setR(slideRange(g.anchor, d));
            }}
            onPointerUp={(e) => {
              const g = drag.current;
              if (!g || g.id !== e.pointerId) return;
              drag.current = null;
              if (g.moved) setR(slideRange(g.anchor, g.last)); else pick(g.anchor);
            }}
            onPointerCancel={(e) => { if (drag.current?.id === e.pointerId) drag.current = null; }}>
            {cells.map((d, i) => {
              if (d === null) return <span key={i} />;
              const role = r.next === "end" ? (d === r.start ? "single" : null) : rangeRole(r, d), col = i % 7;
              const cls = [
                role && role !== "inside" ? "sel" : "", role ? "band" : "", role === "single" ? "one" : "", role === "start" ? "rs" : "", role === "end" ? "re" : "",
                col === 0 ? "c0" : "", col === 6 ? "c6" : "", d === month ? "m0" : "", d === month + n - 1 ? "m1" : "", d === today ? "today" : "",
              ].join(" ");
              return (
                <button key={i} data-day={d} className={cls} disabled={d < today || d > last} aria-pressed={!!role}
                  aria-label={`${dayLong(d)}${dots.has(d) ? ", has rings" : ""}`}
                  // Enter or Space (no pointer): the same as a tap.
                  onClick={(e) => { if (e.detail === 0) pick(d); }}>
                  <span>{ymd(d).d}</span>{dots.has(d) && <i className="pa-sd-dot" />}
                </button>
              );
            })}
          </div>
        </div>
        <div className="pa-sd-sum"><b>{span}</b><span>{nd > 1 ? `${nd} days · ` : ""}{ringsWord(count.skips)} to skip{keptN ? `, ${keptN} kept` : ""}</span></div>
        <div className="pa-sd-list">
          {days.length === 0 && <div className="pa-sd-empty t-body-medium muted">No rings on {r.start === end ? "that day" : "those days"}.</div>}
          {days.map((d) => (
            <div key={d.day}>
              <div className="pa-sd-day">{dayLong(d.day)}{d.day === today ? " · today" : d.day === today + 1 ? " · tomorrow" : ""}</div>
              {d.entries.map((e) => {
                const keys = e.rings.map((x) => x.key);
                const ticked = keys.filter((k) => !kept.has(k)).length;
                const state = ticked === keys.length ? "on" : ticked ? "mid" : "";
                const allOff = e.rings.every((x) => x.off);
                const tag = !ticked ? <span className="pa-sd-tag rings">Rings</span> : allOff ? <span className="pa-sd-tag">Already off</span> : null;
                if (e.rings.length === 1) {
                  const a = e.rings[0].alarm;
                  return (
                    <div key={keys[0]} className={`pa-sd-ring ${ticked ? "" : "kept"}`} aria-checked={!!ticked} {...keyed(keys)}>
                      <span className={`pa-sd-box ${state}`} />
                      <span className="pa-sd-tx"><span className="pa-sd-t">{formatTime(a.hour * 60 + a.minute)}</span>
                        <span className="pa-sd-l">{[a.label.trim(), isRepeating(a) ? "" : "once"].filter(Boolean).join(" · ")}</span></span>
                      {tag}
                    </div>
                  );
                }
                const ek = `${d.day}:${e.rings[0].alarm.id}`, isOpen = open.has(ek);
                const first = e.rings[0].alarm, lastA = e.rings[e.rings.length - 1].alarm;
                return (
                  <div key={ek}>
                    <div className={`pa-sd-ring ${ticked ? "" : "kept"}`} aria-checked={state === "mid" ? "mixed" : !!ticked} {...keyed(keys)}>
                      <span className={`pa-sd-box ${state}`} />
                      <span className="pa-sd-tx"><span className="pa-sd-t">{formatTime(first.hour * 60 + first.minute)} – {formatTime(lastA.hour * 60 + lastA.minute)}</span>
                        <span className="pa-sd-l">{[first.label.trim(), `${e.rings.length} alarms`, state === "mid" ? `${keys.length - ticked} kept` : ""].filter(Boolean).join(" · ")}</span></span>
                      {tag}
                      <button className={`p-icon pa-sd-exp ${isOpen ? "open" : ""}`} aria-expanded={isOpen} aria-label={isOpen ? "Close the bundle" : "Each alarm"}
                        onClick={(ev) => { ev.stopPropagation(); setOpen((o) => { const x = new Set(o); if (x.has(ek)) x.delete(ek); else x.add(ek); return x; }); }}
                        onKeyDown={(ev) => ev.stopPropagation()}>
                        <MIcon name="fExpandMore" />
                      </button>
                    </div>
                    {isOpen && e.rings.map((x) => (
                      <div key={x.key} className={`pa-sd-ring sub ${kept.has(x.key) ? "kept" : ""}`} aria-checked={!kept.has(x.key)} {...keyed([x.key])}>
                        <span className={`pa-sd-box ${kept.has(x.key) ? "" : "on"}`} />
                        <span className="pa-sd-tx"><span className="pa-sd-t">{formatTime(x.alarm.hour * 60 + x.alarm.minute)}</span>
                          {x.alarm.label.trim() && <span className="pa-sd-l">{x.alarm.label.trim()}</span>}</span>
                        {kept.has(x.key) ? <span className="pa-sd-tag rings">Rings</span> : x.off ? <span className="pa-sd-tag">Already off</span> : null}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
          {paused.map((a) => (
            <div key={a.id} className="pa-sd-quiet">{a.label.trim() || formatTime(a.hour * 60 + a.minute)} skips its rings until {shortDay(a.pausedUntil!)}, when it rings again: they show as already off.</div>
          ))}
        </div>
        <div className="p-sheet-buttons pa-sd-buttons">
          <TextButton onClick={close}>Cancel</TextButton>
          <button className="p-filled-btn" disabled={!count.skips && !count.back} onClick={() => go(close)}>
            {count.skips ? `Skip ${ringsWord(count.skips)}` : count.back ? "Save" : "Nothing to skip"}
          </button>
        </div>
      </div>
    )}</BottomSheet>
  );
}

/**
 * New or changed alarm: the time on scroll wheels (220), the days, a label and the sound (AlarmEditor); or,
 * with Series on, from that time to another, every so many minutes (244). [group]: the series it opened
 * from, which it edits as a whole.
 */
function AlarmEditor({ alarm, isNew, group, onClose }: { alarm: ClockAlarm; isNew: boolean; group: ClockAlarm[]; onClose: () => void }) {
  const rings = useAlarmSettings();
  const plan0 = group.length ? seriesPlan(group) : null;
  const [minute, setMinute] = useState(plan0?.from ?? alarm.hour * 60 + alarm.minute);
  const [isSeries, setIsSeries] = useState(plan0 !== null);
  const [to, setTo] = useState(plan0?.to ?? Math.min(1439, alarm.hour * 60 + alarm.minute + 60));
  const [every, setEvery] = useState(plan0?.every ?? 10);
  const [longRing, setLongRing] = useState(!alarm.shortRing);
  const [pickTo, setPickTo] = useState(false);
  const plan: SeriesPlan = { from: minute, to, every };
  const problem = isSeries ? seriesProblem(plan) : null;
  const times = seriesTimes(plan);
  const [label, setLabel] = useState(alarm.label);
  const [days, setDays] = useState(alarm.days);
  const [dates, setDates] = useState<number[]>(alarm.dates ?? []);
  const [skip, setSkip] = useState<number[]>(alarm.skip ?? []);
  const [pausedUntil, setPausedUntil] = useState<number | null>(alarm.pausedUntil ?? null);
  const [picker, setPicker] = useState<null | "dates" | "skipDays">(null);
  const [sound, setSound] = useState(alarm.sound);
  const today = todayNow();
  const sched = { hour: Math.floor(minute / 60), minute: minute % 60, days, dates, skip, pausedUntil };
  const repeating = isRepeating(sched);
  const pause = pauseText(sched, today, shortDay);
  const pickSound = async () => {
    const r = await native.pickSound(sound, "Alarm sound");
    if (r.picked) setSound(r.uri ?? null);
  };
  return <>
    <BottomSheet onClose={onClose}>{(close) => (
      <div className="pa-editor">
        <div className="pa-editor-head">
          <span className="t-title-medium grow">{isSeries ? "Alarm series" : isNew ? "New alarm" : "Alarm"}</span>
          {!isNew && <TextButton className="icon" onClick={() => { deleteAlarms(group.length ? group : [alarm]); close(); }}><MIcon name="oDelete" size={18} /> Delete</TextButton>}
        </div>
        <div className="pa-wheels"><TimeWheels step={1} value={minute} onChange={setMinute} /></div>
        <div className="pa-erow pa-series-row">
          <MIcon name="oSchedule" />
          <span className="t-body-large grow">{isSeries ? `From ${formatTime(minute)}` : "Series of alarms"}</span>
          <Switch checked={isSeries} label="Series of alarms" onChange={setIsSeries} />
        </div>
        {isSeries && <>
          <button className="pa-erow pa-series-to" onClick={() => setPickTo(true)}>
            <span className="t-body-large grow">Until {formatTime(to)}</span>
          </button>
          <div className="pa-series-every">
            <span className="t-body-large grow">Every</span>
            <SlideStepper value={every} onChange={(v) => setEvery(v ?? 1)} step={1} min={1} max={120} unit="min" buttons label="Minutes between alarms" />
          </div>
          <div className={`pa-series-sum t-body-small ${problem ? "bad" : "muted"}`}>{problem ?? `${times.length} alarms · last at ${formatTime(times[times.length - 1])}`}</div>
          <div className="pa-erow pa-series-long">
            <span className="grow">
              <span className="t-body-large">Ring like a clock alarm</span>
              <span className="t-body-small muted pa-series-sub">{longRing ? `Each rings up to ${rings.clockRingMinutes} min` : `Each rings ${rings.alarmRingMinutes} min, like a calendar alarm`}</span>
            </span>
            <Switch checked={longRing} label="Ring like a clock alarm" onChange={setLongRing} />
          </div>
        </>}
        <div className="p-divider" />
        <div className="pa-erow">
          <MIcon name="fRepeat" />
          {dates.length ? (
            <button className="pa-dates" onClick={() => setPicker("dates")}>
              <span className="t-body-large pa-line">{dates.slice(0, 4).map(shortDay).join(", ") + (dates.length > 4 ? `, ${dates.length - 4} more` : "")}</span>
            </button>
          ) : (
            <div className="pa-days">
              {NARROW_DAYS.map((d, i) => {
                const on = (days & (1 << i)) !== 0;
                return <button key={i} className={on ? "on" : ""} aria-pressed={on} onClick={() => setDays(days ^ (1 << i))}>{d}</button>;
              })}
            </div>
          )}
        </div>
        <div className="pa-days-text">
          <span className="t-body-small muted grow">{dates.length ? (dates.length === 1 ? "On one date" : `On ${dates.length} chosen dates`) : daysText(days)}</span>
          {dates.length
            ? <TextButton onClick={() => setDates([])}>Weekdays</TextButton>
            : <TextButton onClick={() => setPicker("dates")}>Dates…</TextButton>}
        </div>
        {/* "Skip days…" (317, in Pause's place) opens the Skip days sheet on this alarm as edited; Save keeps
            what it picked. The row stays while the alarm rings once (a quiet line instead), so picking the first
            day (or clearing the last) doesn't make the sheet grow and the day buttons jump under the finger (72). */}
        <div className="p-divider" />
        <div className="pa-erow pa-pause">
            <MIcon name="oEventBusy" />
            {!repeating ? <span className="t-body-large muted grow pa-line">Skip days: for repeating alarms</span>
            : <>
              <button className={`pa-pause-text t-body-large grow ${pause ? "" : "muted"}`} onClick={() => setPicker("skipDays")}>{pause || "Skip days…"}</button>
              {pause && <IconButton icon="fClose" label="Ring as usual" onClick={() => { setSkip([]); setPausedUntil(null); }} />}
            </>}
        </div>
        <div className="p-divider" />
        <label className="pa-erow">
          <MIcon name="oLabel" />
          <input className="pa-label-input" value={label} placeholder="Add title" enterKeyHint="done" autoCapitalize="sentences"
            onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </label>
        <div className="p-divider" />
        <button className="pa-erow" onClick={() => void pickSound()}>
          <MIcon name="oMusicNote" />
          <span className="t-body-large">{sound == null ? "Default alarm sound" : "Custom sound"}</span>
        </button>
        <div className="p-divider" />
        <div className="p-sheet-buttons">
          <TextButton onClick={close}>Cancel</TextButton>
          <button className="p-filled-btn" disabled={problem !== null} onClick={() => {
            const a = tidySchedule({ ...alarm, hour: Math.floor(minute / 60), minute: minute % 60, label: label.trim(), days, sound, enabled: true, dates, skip, pausedUntil }, today);
            close();
            void ensureNotifications("This alarm rings at its time even with the app closed, through a notification.").then(async () => {
              if (!isSeries) {
                // A series turned back into one alarm: the rest of it goes.
                await Promise.all(group.filter((x) => x.id !== alarm.id).map((x) => native.deleteClock(x.id)));
                return save({ ...a, series: null, shortRing: false });
              }
              const stamp = Date.now();
              const made = buildSeries({ ...a, shortRing: !longRing }, plan, group.length ? group : isNew ? [] : [alarm], alarm.series ?? stamp, stamp);
              // One after the other: each save sets an alarm and rewrites the engine's list.
              for (const id of made.remove) await native.deleteClock(id);
              for (const x of made.save) await native.saveClock(x);
              await refreshAlarmState();
            });
          }}>Save</button>
        </div>
      </div>
    )}</BottomSheet>
    {pickTo && <TimePickerDialog step={1} value={to} onPick={setTo} onClose={() => setPickTo(false)} />}
    {picker === "dates" && <MultiDatePickerDialog title="Ring on these dates" value={dates} from={today} onPick={setDates} onClose={() => setPicker(null)} />}
    {picker === "skipDays" && (() => {
      const draft: ClockAlarm = { ...alarm, hour: Math.floor(minute / 60), minute: minute % 60, days, dates, skip, pausedUntil, enabled: true };
      return <SkipDaysSheet all={[draft]} group={[draft]} scope0="group" quick0="Next ring" now={new Date()} onClose={() => setPicker(null)}
        onApply={(changed) => { const c = changed[0]; if (c) { setSkip(c.skip ?? []); setPausedUntil(c.pausedUntil ?? null); } }} />;
    })()}
  </>;
}

// ---------- Timer ----------

const startTimer = async (durationMs: number, label = "") => {
  await ensureNotifications("A running timer shows its countdown in a notification and rings when it's done, even with the screen locked.");
  await act(native.timer("start", { durationMs, label }));
};

function TimersPane({ timers: all, active, onNew }: { timers: ClockTimer[]; active: boolean; onNew: () => void }) {
  // A deleted timer leaves the page at once, but is only really deleted when its Undo has gone unused, so
  // Undo brings it back as it was, still counting.
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set());
  const stay = (id: number) => setLeaving((l) => new Set([...l].filter((x) => x !== id)));
  const timers = all.filter((t) => !leaving.has(t.id));
  const running = timers.some((t) => t.endAt != null);
  const now = useTick(250, active && running);
  const remove = (t: ClockTimer) => {
    const left = timerLeft(t, Date.now()), wait = timerUndoMs(left, t.endAt != null);
    let done = false;
    const commit = () => { if (done) return; done = true; offFlush(); void act(native.timer("delete", { id: t.id })).then(() => stay(t.id)); };
    const offFlush = onFlush(commit);
    setLeaving((l) => new Set([...l, t.id]));
    if (!wait) { commit(); showSnackbar("Timer removed"); return; }
    showSnackbar("Timer removed", "Undo", () => {
      if (done) { void act(native.timer("restore", { json: JSON.stringify(t) })); return; } // the app was put away meanwhile
      done = true;
      offFlush();
      stay(t.id);
    }, { ms: wait, onGone: commit });
  };
  return (
    <div className="pa-scroll pa-gap12 pa-top12">
      <PermissionCards />
      {/* The big symbol starts a new timer too (77), like the alarms' one adds an alarm. */}
      {timers.length === 0 && <EmptyState icon="oTimer" title="No timers" hint="Tap the timer, + or a length below" onIcon={onNew} iconLabel="New timer" />}
      <div className="pa-presets">
        {TIMER_PRESETS.map((m) => <button key={m} className="p-assist pa-chip" onClick={() => void startTimer(m * 60_000)}>{presetText(m)}</button>)}
        <button className="p-assist pa-chip" onClick={onNew}>Other…</button>
      </div>
      {[...timers].sort((a, b) => a.id - b.id).map((t) => <TimerCard key={t.id} t={t} now={now} onDelete={() => remove(t)} />)}
    </div>
  );
}

function TimerCard({ t, now, onDelete }: { t: ClockTimer; now: number; onDelete: () => void }) {
  const left = timerLeft(t, now);
  const running = t.endAt != null;
  // Stopped part-way (not one reset to its full length, which waits for Start).
  const paused = !running && left !== t.durationMs;
  const run = (action: "pause" | "resume" | "plus" | "reset") => void act(native.timer(action, { id: t.id }));
  return (
    <div className={`pa-card pa-timer ${running ? "running" : ""} ${paused ? "paused" : ""}`}>
      <div className="pa-timer-head">
        <span className="t-body-medium muted grow">{t.label.trim() || `${formatDuration(t.durationMs)} timer`}{paused && <span className="pa-paused"> · Paused</span>}</span>
        <IconButton icon="fClose" label="Delete timer" onClick={onDelete} />
      </div>
      {/* One row (76): the time, then Reset (its symbol), +1:00 and Pause or Resume. */}
      <div className="pa-timer-row">
        <div className={`pa-time36 grow ${running ? "" : "muted"}`}>{formatDuration(left)}</div>
        {left !== t.durationMs && <IconButton icon="fReplay" label="Reset" onClick={() => run("reset")} />}
        <button className="p-outlined-btn pa-small-btn" onClick={() => run("plus")}>+1:00</button>
        {running
          ? <button className="pa-tonal pa-small-btn" onClick={() => run("pause")}>Pause</button>
          : <button className="p-filled-btn pa-small-btn" onClick={() => run("resume")}>{left === t.durationMs ? "Start" : "Resume"}</button>}
      </div>
      {/* What's left, along the card's bottom edge (233): the accent while it runs, grey while paused. */}
      <div className="pa-timer-bar" aria-hidden="true"><span style={{ transform: `scaleX(${timerShare(t, left)})` }} /></div>
    </div>
  );
}

/** Hours, minutes and seconds on wheels (220), and a label, for a new timer; it starts on "Start" (NewTimerDialog). */
function NewTimerDialog({ onClose }: { onClose: () => void }) {
  const [total, setTotal] = useState(0), [label, setLabel] = useState("");
  const start = () => { if (total > 0) { onClose(); void startTimer(total, label.trim()); } };
  return (
    <Dialog title="New timer" onClose={onClose} actions={<>
      <TextButton onClick={onClose}>Cancel</TextButton>
      <TextButton disabled={total <= 0} onClick={start}>Start</TextButton>
    </>}>
      <DurationWheels ms={total} onChange={setTotal} />
      <Field label="Label (optional)" value={label} onChange={setLabel} onEnter={start} />
    </Dialog>
  );
}

function Field({ label, value, onChange, numeric, autoFocus, onEnter }: {
  label: string; value: string; onChange: (v: string) => void; numeric?: boolean; autoFocus?: boolean; onEnter?: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) { const t = window.setTimeout(() => ref.current?.focus(), 60); return () => clearTimeout(t); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="p-tf">
      <input ref={ref} value={value} placeholder=" " inputMode={numeric ? "numeric" : "text"} enterKeyHint="done"
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onEnter?.(); }} />
      <span className="p-tf-label">{label}</span>
    </label>
  );
}

// ---------- Stopwatch ----------

/**
 * The first stopwatch big, as it always was; the ones added with + (327, up to MAX_STOPWATCHES) as smaller cards
 * under its buttons, each with Start/Pause, Lap, Reset, an optional name and a delete with Undo. The engine keeps
 * them all (ClockTools.kt), counting from timestamps, so they run on with the app closed.
 */
function StopwatchPane({ active }: { active: boolean }) {
  // A Reset shows at once, but the engine is only told once its Undo has gone unused (341), as a delete.
  const [resetting, setResetting] = useState<ReadonlySet<number>>(new Set());
  const unReset = (id: number) => setResetting((l) => new Set([...l].filter((x) => x !== id)));
  const pendingReset = useRef(new Map<number, () => void>());
  const all = stopwatchesOf(useAlarmState().tools).map((x) => shownAfterReset(x, resetting));
  // A deleted one leaves at once, but is only really deleted once its Undo has gone unused (as a timer).
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set());
  const stay = (id: number) => setLeaving((l) => new Set([...l].filter((x) => x !== id)));
  const sw = all[0];
  const more = all.slice(1).filter((x) => !leaving.has(x.id));
  const running = all.some((x) => x.startedAt != null);
  const now = useTick(31, active && running);
  const total = elapsed(sw, now);
  const lengths = lapLengths(sw.laps);
  const run = (a: "start" | "pause" | "lap" | "reset", id = sw.id) => {
    if (a === "reset") { reset(id); return; }
    if (a === "start") askForStopwatchLine();
    pendingReset.current.get(id)?.();   // started again before the Undo went: the reset goes first
    void act(native.stopwatch(a, { id }));
  };
  const reset = (id: number) => {
    const label = stopwatchLabel(all.find((x) => x.id === id) ?? {}, Math.max(0, all.findIndex((x) => x.id === id)));
    let done = false;
    const finish = () => { done = true; offFlush(); pendingReset.current.delete(id); };
    const commit = () => { if (done) return; finish(); void act(native.stopwatch("reset", { id })).then(() => unReset(id)); };
    const offFlush = onFlush(commit);
    pendingReset.current.set(id, commit);
    setResetting((l) => new Set([...l, id]));
    // Its notification goes at once too, and comes back on Undo (350: a long press on a running one resets it).
    void act(native.stopwatch("hide", { id }));
    showSnackbar(`${label} reset`, "Undo", () => { if (done) return; finish(); unReset(id); void act(native.stopwatch("show", { id })); }, { onGone: commit });
  };
  const shown = stopwatchParts(total);
  const remove = (id: number, label: string) => {
    let done = false;
    const commit = () => { if (done) return; done = true; offFlush(); void act(native.stopwatch("remove", { id })).then(() => stay(id)); };
    const offFlush = onFlush(commit);
    setLeaving((l) => new Set([...l, id]));
    // Its notification goes at once too, and comes back on Undo (review of 2.10.1, finding 6).
    void act(native.stopwatch("hide", { id }));
    showSnackbar(`${label} removed`, "Undo", () => { if (done) return; done = true; offFlush(); stay(id); void act(native.stopwatch("show", { id })); }, { onGone: commit });
  };
  return (
    <div className="pa-scroll pa-sw">
      {/* A tap on the count starts it, and pauses it while it runs (350; 326 had it do nothing then); a long
          press resets it, with Undo. */}
      <SwCount className="pa-sw-time" running={sw.startedAt != null} total={total} label={stopwatchLabel(sw, 0)}
        onTap={() => run(sw.startedAt != null ? "pause" : "start")} onReset={() => run("reset")}>
        {shown.main}<span className="pa-sw-cs">.{shown.cs}</span>
      </SwCount>
      <div className="pa-buttons center">
        {sw.startedAt != null ? <>
          <button className="p-outlined-btn" onClick={() => run("lap")}>Lap</button>
          <button className="pa-tonal" onClick={() => run("pause")}>Pause</button>
        </> : <>
          {total > 0 && <button className="p-outlined-btn" onClick={() => run("reset")}>Reset</button>}
          <button className="p-filled-btn" onClick={() => run("start")}>{total > 0 ? "Resume" : "Start"}</button>
        </>}
      </div>
      {more.length > 0 && (
        <div className="pa-sw-more">
          {more.map((x) => {
            // Named by its place among all of them (as the notification does).
            const i = all.findIndex((y) => y.id === x.id), label = stopwatchLabel(x, i);
            return <StopwatchCard key={x.id} sw={x} label={label} placeholder={stopwatchLabel({}, i)} now={now}
              onRun={(a) => run(a, x.id)} onDelete={() => remove(x.id, label)} />;
          })}
        </div>
      )}
      {lengths.length > 0 && <>
        <div className="p-divider pa-sw-divider" />
        {more.length > 0 && <div className="pa-sw-lapshead t-body-medium muted">Laps · {stopwatchLabel(sw, 0)}</div>}
        {/* Newest lap first, like a phone's clock app. */}
        {lengths.map((len, i) => ({ n: i + 1, len, at: sw.laps[i] })).reverse().map((l) => (
          <div key={l.n} className="pa-lap">
            <span className="muted">Lap {l.n}</span>
            <span className="mono">{formatDuration(l.len, true)}</span>
            <span className="mono muted">{formatDuration(l.at, true)}</span>
          </div>
        ))}
      </>}
    </div>
  );
}

let askedForLine = false;
/**
 * A running stopwatch shows in the notifications (350): with them off for the app, it asks once per visit,
 * with the reason, the first time one starts.
 */
function askForStopwatchLine() {
  if (askedForLine || !hasAlarms || alarmState().perms.notifications) return;
  askedForLine = true;
  void ensureNotifications("A running stopwatch shows in your notifications, counting, so you can see it and pause it from there.");
}

/**
 * A stopwatch's count (350): a tap starts it, or pauses it while it runs; a long press (a right-click) resets
 * it once it has counted, with Undo (the pane's reset).
 */
function SwCount({ className, running, total, label, onTap, onReset, children }: {
  className: string; running: boolean; total: number; label: string; onTap: () => void; onReset: () => void; children: ReactNode;
}) {
  const hold = useLongPress(total > 0 ? onReset : undefined);
  const { fired, ...press } = hold;
  return (
    <div className={`${className} tap`} role="button" tabIndex={0} aria-label={`${running ? "Pause" : total > 0 ? "Resume" : "Start"} ${label}`}
      {...press} onClick={() => { if (!fired()) onTap(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } }}>
      {children}
    </div>
  );
}

/** One added stopwatch: its name (tap to type one), its count (a tap starts or pauses it, a long press resets it), the last lap, and its buttons. */
function StopwatchCard({ sw, label, placeholder, now, onRun, onDelete }: {
  sw: { id: number; name?: string; startedAt: number | null; accumulatedMs: number; laps: number[] }; label: string; placeholder: string; now: number;
  onRun: (a: "start" | "pause" | "lap" | "reset") => void; onDelete: () => void;
}) {
  const running = sw.startedAt != null;
  const total = elapsed(sw, now);
  const shown = stopwatchParts(total);
  const [name, setName] = useState(sw.name ?? "");
  useEffect(() => setName(sw.name ?? ""), [sw.name]);
  const save = () => { const v = name.trim(); if (v !== (sw.name ?? "").trim()) void act(native.stopwatch("rename", { id: sw.id, name: v })); };
  const laps = sw.laps.length, last = laps ? sw.laps[laps - 1] - (laps > 1 ? sw.laps[laps - 2] : 0) : 0;
  return (
    <div className={`pa-card pa-swcard ${running ? "running" : ""}`}>
      <div className="pa-timer-head">
        <input className="pa-sw-name grow" value={name} placeholder={placeholder} aria-label={`Name of ${label}`} enterKeyHint="done" maxLength={40}
          onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
        <IconButton icon="fClose" label={`Delete ${label}`} onClick={onDelete} />
      </div>
      <div className="pa-timer-row">
        <SwCount className={`pa-time36 grow ${running ? "" : "muted"}`} running={running} total={total} label={label}
          onTap={() => onRun(running ? "pause" : "start")} onReset={() => onRun("reset")}>
          {shown.main}<span className="pa-sw-cs">.{shown.cs}</span>
        </SwCount>
        {running
          ? <button className="p-outlined-btn pa-small-btn" onClick={() => onRun("lap")}>Lap</button>
          : total > 0 && <IconButton icon="fReplay" label={`Reset ${label}`} onClick={() => onRun("reset")} />}
        {running
          ? <button className="pa-tonal pa-small-btn" onClick={() => onRun("pause")}>Pause</button>
          : <button className="p-filled-btn pa-small-btn" onClick={() => onRun("start")}>{total > 0 ? "Resume" : "Start"}</button>}
      </div>
      {laps > 0 && <div className="pa-swcard-lap muted">Lap {laps} · <span className="mono">{formatDuration(last, true)}</span></div>}
    </div>
  );
}

// ---------- World clock ----------

const systemZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function WorldClockPane({ zones: all, local, active, onAdd }: { zones: string[]; local: string; active: boolean; onAdd: () => void }) {
  const now = useTick(1000, active);
  const here = local || systemZone();
  const h24 = use24h();
  // A removed city leaves at once, but is only really removed once its Undo has gone unused, so Undo puts it
  // back in its place (as a deleted timer does).
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const stay = (id: string) => setLeaving((l) => new Set([...l].filter((x) => x !== id)));
  const zones = all.filter((z) => !leaving.has(z));
  const remove = (id: string) => {
    let done = false;
    const commit = () => { if (done) return; done = true; offFlush(); void act(native.zone("remove", id)).then(() => stay(id)); };
    const offFlush = onFlush(commit);
    setLeaving((l) => new Set([...l, id]));
    showSnackbar(`${cityLabel(id)} removed`, "Undo", () => {
      if (done) { void act(native.zone("add", id)); return; } // the app was put away meanwhile
      done = true;
      offFlush();
      stay(id);
    }, { onGone: commit });
  };
  return (
    <div className="pa-scroll pa-gap12 pa-top16">
      <div className="pa-local">
        <div className="pa-local-text">
          <div className="pa-time52">{zoneClock(here, now, h24)}</div>
          <div className="t-body-medium muted">{cityName(here)} · here</div>
        </div>
        <WeatherChip id={here} now={now} active={active} />
      </div>
      {zones.length === 0 && <EmptyState icon="oPublic" title="No cities" onIcon={onAdd} iconLabel="Add a city" action={<TextButton onClick={onAdd}>Add a city</TextButton>} />}
      {zones.map((z) => <CityCard key={z} zone={z} here={here} now={now} h24={h24} active={active} onRemove={() => remove(z)} />)}
      {/* With cities listed, the globe stays as the list's last row (326): a new city lands just there. */}
      {zones.length > 0 && (
        <button className="pa-city-add" onClick={onAdd}>
          <MIcon name="oPublic" />
          <span>Add a city</span>
        </button>
      )}
    </div>
  );
}

/**
 * A city's weather now: its symbol and temperature, or a quiet cloud and a dash until the first reading
 * arrives (or while offline). Tapping it opens the weather app (or a weather page).
 */
function WeatherChip({ id, now, active }: { id: string; now: number; active: boolean }) {
  const w = useWeather(id, active);
  const v = w ? weatherView(w, id, now) : null;
  return (
    <button className={`pa-wx ${v ? "" : "none"}`} aria-label={v ? `${v.label}, ${v.text}. Open the weather` : "Weather. Open the weather"}
      onClick={() => void native.openWeather(weatherPage(id))}>
      <MIcon name={v ? v.icon : "oCloud"} size={22} />
      <span>{v ? v.text : "–°C"}</span>
    </button>
  );
}

/**
 * A city on the world clock, by its stored id (a zone, or "zone#Name": domain/cities.ts): hours and minutes,
 * no seconds (233). A swipe left removes it (the card follows the finger, then slides away); a long press
 * (a right-click) offers Remove. Either way with Undo.
 */
function CityCard({ zone: id, here, now, h24, active, onRemove }: {
  zone: string; here: string; now: number; h24: boolean; active: boolean; onRemove: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const hold = useLongPress(() => setMenu(true));
  const card = useHorizontalSwipe<HTMLDivElement>({
    accept: (dx) => dx < 0,
    onStart: () => { const el = card.current; if (el) el.style.transition = "none"; },
    onMove: (dx) => { const el = card.current; if (el) el.style.transform = `translate3d(${Math.min(0, dx)}px,0,0)`; },
    onEnd: (dx, vx) => {
      const el = card.current;
      if (!el) return;
      const w = el.offsetWidth;
      const goes = swipeRemoves(dx, vx, w);
      el.style.transition = `transform ${goes ? 160 : 220}ms cubic-bezier(.2, 0, 0, 1), opacity 160ms linear`;
      el.style.transform = goes ? `translate3d(${-w - 16}px,0,0)` : "";
      if (goes) { el.style.opacity = "0"; feel("tick"); window.setTimeout(onRemove, 160); }
    },
  });
  const zone = zoneOf(id);
  let sub = "";
  try { sub = [zoneDayLabel(zone, now, here), zoneOffsetLabel(zone, now, here)].filter(Boolean).join(" · "); } catch { return null; }
  const { fired: _fired, ...press } = hold;
  // The menu sits beside the card, not in it: the card clips what overflows its rounded corners.
  return (
    <div className="pa-city-wrap">
      <div className="pa-card pa-city" ref={card} {...press}>
        <div className="grow pa-city-text">
          <div className="t-title-medium pa-line">{cityLabel(id)}</div>
          <div className="t-body-small muted pa-line">{sub}</div>
        </div>
        <WeatherChip id={id} now={now} active={active} />
        <span className="pa-time26">{zoneClock(zone, now, h24, false)}</span>
      </div>
      <div className="p-menu-anchor pa-city-menu">
        <DropdownMenu open={menu} onClose={() => setMenu(false)} items={[{ label: "Remove", icon: "oDelete", onClick: onRemove }]} />
      </div>
    </div>
  );
}

/** Cities to add to the world clock, by name, with a search box (ZonePickerDialog). */
function ZonePickerDialog({ local, onClose }: { local: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const all = useMemo(() => {
    const ids = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    return cityZones(ids);
  }, []);
  const now = Date.now();
  const here = local || systemZone();
  // The city table by name or country; other time zones only once something is typed.
  const shown = useMemo(() => searchCities(q, all), [q, all]);
  return (
    <Dialog title="Add a city" onClose={onClose} actions={<TextButton onClick={onClose}>Cancel</TextButton>}>
      <Field label="Search" value={q} onChange={setQ} autoFocus />
      <div className="pa-zones">
        {shown.map((c) => (
          <button key={c.id} className="pa-zone" onClick={() => { onClose(); void act(native.zone("add", c.id)); }}>
            <span className="t-body-large">{c.name}</span>
            <span className="t-body-small muted">{c.place} · {zoneOffsetLabel(zoneOf(c.id), now, here)}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}


