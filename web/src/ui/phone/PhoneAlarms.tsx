// The Alarms tab, drawn after the native AlarmsScreen.kt and ClockToolsPanes.kt: alarm clocks (the next
// one, a filter, close ones bundled), a timer, a stopwatch and a world clock, under Material 3 primary
// tabs. The four sections also turn with a finger swiped sideways, live like a pager, with the tab
// indicator riding along. Everything here is kept and rung by the native alarm engine (alarms/native.ts);
// in a browser the tab isn't shown.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import {
  type AlarmFilter, NARROW_DAYS, TIMER_PRESETS, alarmShown, bundle, isRepeating, pauseText, tidySchedule, stopwatchParts, cityName, cityZones, daysText, elapsed, formatDuration, lapLengths,
  nextRing, presetText, repeatText, timerLeft, untilText, zoneClock, zoneDayLabel, zoneOffsetLabel,
} from "../../domain/alarms.ts";
import { dayShort, epochOf, formatTime, relativeDay, use24h, weekday, ymd } from "../../domain/dates.ts";
import { type ClockAlarm, type ClockTimer, act, alarmState, hasAlarms, native, refreshAlarmState, useAlarmState } from "../../alarms/native.ts";
import { type Hourly, forecastView, useForecast, useWeather, weatherPage, weatherView } from "../../alarms/weather.ts";
import { cityLabel, searchCities, zoneOf } from "../../domain/cities.ts";
import { AppBarActions, Dialog, FilterChip, IconButton, MIcon, TopAppBar } from "./chrome.tsx";
import { pushBack } from "./native.ts";
import { BottomSheet, Switch, TextButton } from "./m3.tsx";
import { DatePickerDialog, MultiDatePickerDialog, TimePickerDialog } from "./pickers.tsx";
import { spring, useSwipePager } from "./pager.ts";
import { HeldTime } from "./TimeWheel.tsx";

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

// The shell's + button (fixed over every page) asks the Alarms page what to add.
const addMenuListeners = new Set<() => void>();
/** Opens the Alarms page's "what to add" menu (from the + button). */
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
/** An alarm's repeat line, with a pause or skipped days after it. */
const scheduleLine = (a: ClockAlarm, now: Date) => [repeatText(a, now, relative), a.enabled ? pauseText(a, todayNow(), shortDay) : ""].filter(Boolean).join(" · ");

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

/** The Alarms tab. [active]: it's the page on screen (clocks only tick then). */
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
  const [menu, setMenu] = useState(false);
  const [newTimer, setNewTimer] = useState(false);
  const [addZone, setAddZone] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const stopSlide = useRef<(() => void) | null>(null);
  useEffect(() => { const open = () => setMenu(true); addMenuListeners.add(open); return () => { addMenuListeners.delete(open); }; }, []);

  // Where each tab's label sits, measured once (and again after a resize): reading them on every frame
  // of a slide, just after moving the pages, would make the browser recalculate styles mid-frame.
  const boxes = useRef<{ x: number; w: number }[] | null>(null);
  /** Puts the tab indicator under the label at [p] (between two tabs while sliding): transform only. */
  const placeIndicator = (p: number) => {
    const row = tabs.current, ind = indicator.current;
    if (!row || !ind) return;
    if (!boxes.current) {
      boxes.current = [...row.querySelectorAll<HTMLElement>(".pa-tab-label")].map((el) => ({ x: (el.parentElement as HTMLElement).offsetLeft + el.offsetLeft, w: el.offsetWidth }));
    }
    const bx = boxes.current;
    if (!bx.length) return;
    p = clamp(p, 0, LAST);
    const a = Math.floor(p), b = Math.min(LAST, a + 1), f = p - a;
    const x = bx[a].x + (bx[b].x - bx[a].x) * f, w = bx[a].w + (bx[b].w - bx[a].w) * f;
    // 100 px wide in CSS, stretched to the label; the corners are drawn back to 3 px after the stretch.
    const k = w / 100;
    ind.style.transform = `translate3d(${x}px,0,0) scaleX(${k})`;
    ind.style.borderRadius = k > 0 ? `${3 / k}px ${3 / k}px 0 0 / 3px 3px 0 0` : "";
  };
  useLayoutEffect(() => placeIndicator(index));
  useEffect(() => {
    const on = () => window.requestAnimationFrame(() => { boxes.current = null; placeIndicator(idx.current); });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  // Turning to a section another way: a tap on its tab slides there on the pager's spring.
  const show = (i: number) => {
    i = clamp(i, 0, LAST);
    const from = idx.current;
    if (i === from) return;
    stopSlide.current?.();
    const el = strip.current, w = el?.parentElement?.clientWidth ?? 0;
    flushSync(() => setIndex(i));
    if (!el || !w || Math.abs(i - from) > 1) { if (el) el.style.transform = ""; placeIndicator(i); return; }
    const place = (x: number) => { el.style.transform = x ? `translate3d(${x}px,0,0)` : ""; placeIndicator(i - x / w); };
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
    onMove: (x, w) => { stopSlide.current?.(); stopSlide.current = null; placeIndicator(idx.current - x / w); },
    allow: (t) => !t.closest(".p-switch, input, textarea, .pa-noswipe"),
  });

  const newAlarm = () => {
    show(0);
    setEditing({ alarm: { id: 0, hour: 7, minute: 0, label: "", days: 0, enabled: true, color: 0, sound: null }, isNew: true });
  };
  const startStopwatch = async () => {
    show(2);
    const sw = alarmState().tools.stopwatch;
    if (sw.startedAt == null) await act(native.stopwatch("start"));
  };

  return (
    <div className="p-scaffold pa-page">
      <TopAppBar title="Alarms" actions={<AppBarActions />} />
      <div className="pa-tabs" ref={tabs} role="tablist">
        {SECTIONS.map(([k, label], i) => (
          <button key={k} role="tab" aria-selected={index === i} className={`pa-tab ${index === i ? "on" : ""}`} onClick={() => show(i)}>
            <span className="pa-tab-label">{label}</span>
          </button>
        ))}
        <span className="pa-indicator" ref={indicator} />
      </div>
      <div className="pa-pager" ref={pager}>
        <div className="pa-strip" ref={strip} style={{ left: `${-index * 100}%` }}>
          {SECTIONS.map(([k], i) => (
            <div key={k} className="pa-section" style={{ left: `${i * 100}%` }} aria-hidden={i !== index}>
              {Math.abs(i - index) <= 1 || k === "alarm" ? (
                k === "alarm" ? <AlarmList alarms={st.alarms} zone={st.zone} rings={st.ring} active={active && index === i} onEdit={(a) => setEditing({ alarm: a, isNew: false })} onNew={newAlarm} />
                  : k === "timer" ? <TimersPane timers={st.tools.timers} active={active && index === i} onNew={() => setNewTimer(true)} />
                    : k === "stopwatch" ? <StopwatchPane active={active && index === i} />
                      : <WorldClockPane zones={st.tools.zones} local={st.zone} active={active && index === i} onAdd={() => setAddZone(true)} />
              ) : null}
            </div>
          ))}
        </div>
      </div>
      {/* Where the shell's + button sits: its menu opens above it. */}
      <div className="p-menu-anchor pa-fab-anchor">
        <AddDial open={menu} onClose={() => setMenu(false)} items={[
          { label: "New alarm", icon: "oAlarm", onClick: newAlarm },
          { label: "Start a timer", icon: "oTimer", onClick: () => { show(1); setNewTimer(true); } },
          { label: "Start the stopwatch", icon: "oAvTimer", onClick: () => void startStopwatch() },
          { label: "Add a world clock", icon: "oPublic", onClick: () => { show(3); setAddZone(true); } },
        ]} />
      </div>
      {editing && <Layer><AlarmEditor alarm={editing.alarm} isNew={editing.isNew} onClose={() => setEditing(null)} /></Layer>}
      {newTimer && <Layer><NewTimerDialog onClose={() => setNewTimer(false)} /></Layer>}
      {addZone && <Layer><ZonePickerDialog local={st.zone} onClose={() => setAddZone(false)} /></Layer>}
    </div>
  );
}

/**
 * What the + button adds on this page: round symbols stacked above it (the first one nearest the
 * button), each scaling in on a short stagger. Holding one shows its name (press.ts), a tap picks it,
 * and a tap outside or back closes the stack.
 */
function AddDial({ open, onClose, items }: { open: boolean; onClose: () => void; items: { label: string; icon: string; onClick: () => void }[] }) {
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useLayoutEffect(() => {
    if (open) { setShown(true); setLeaving(false); }
    else if (shown) { setLeaving(true); const t = window.setTimeout(() => { setShown(false); setLeaving(false); }, 120); return () => clearTimeout(t); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => (open ? pushBack(onClose) : undefined), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  return <>
    <div className="p-menu-scrim" onPointerDown={onClose} />
    <div className={`pa-dial ${leaving ? "out" : ""}`} role="menu">
      {items.map((it, i) => (
        <button key={it.label} role="menuitem" className="pa-dial-btn" aria-label={it.label} style={{ animationDelay: `${i * 28}ms` }}
          onClick={() => { onClose(); it.onClick(); }}>
          <MIcon name={it.icon} />
        </button>
      ))}
    </div>
  </>;
}

// ---------- Alarms ----------

type Show = AlarmFilter;
const SHOW: [Show, string][] = [["all", "All"], ["on", "Active"], ["off", "Inactive"], ["weekdays", "Weekdays"], ["weekend", "Weekend"]];

const save = (a: ClockAlarm) => act(native.saveClock(a));

function AlarmList({ alarms, zone, rings, active, onEdit, onNew }: {
  alarms: ClockAlarm[]; zone: string; rings: { rings: boolean }; active: boolean; onEdit: (a: ClockAlarm) => void; onNew: () => void;
}) {
  const [show, setShow] = useState<Show>("all");
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const now = new Date(useTick(15_000, active));
  const list = alarms.filter((a) => alarmShown(a, show, now));
  const groups = bundle(list);
  const fc = useForecast(zone, active && alarms.some((a) => a.enabled));
  return (
    <div className="pa-scroll">
      <PermissionCards />
      {!rings.rings && (
        <div className="pa-note"><MIcon name="oInfo" size={20} /><span>Event and task alarms are off on this phone. Turn them on in Settings.</span></div>
      )}
      <NextAlarm alarms={alarms} now={now} />
      {alarms.length > 0 && (
        <div className="pa-filter pa-noswipe">
          {SHOW.map(([k, l]) => <FilterChip key={k} selected={show === k} onClick={() => setShow(k)}>{l}</FilterChip>)}
        </div>
      )}
      {list.length === 0 && <Empty icon="oAlarm" title={!alarms.length ? "No alarms" : show === "weekdays" ? "No weekday alarms" : show === "weekend" ? "No weekend alarms" : `No ${SHOW.find(([k]) => k === show)![1].toLowerCase()} alarms`} text="Tap + to add one"
        onIcon={onNew} iconLabel="New alarm" />}
      {groups.map((g) => g.length === 1
        ? <AlarmCard key={g[0].id} a={g[0]} now={now} fc={fc} onClick={() => onEdit(g[0])} />
        : <BundleCard key={g[0].id} group={g} now={now} fc={fc} open={!!open[g[0].id]} onOpen={() => setOpen((o) => ({ ...o, [g[0].id]: !o[g[0].id] }))} onEdit={onEdit} />)}
    </div>
  );
}

function NextAlarm({ alarms, now }: { alarms: ClockAlarm[]; now: Date }) {
  const rings = alarms.filter((a) => a.enabled).map((a) => nextRing(a, now)).filter((d): d is Date => d !== null);
  if (!rings.length) return null;
  const at = rings.reduce((x, y) => (y < x ? y : x));
  return (
    <div className="pa-next">
      <div className="t-title-large">Alarm in {untilText(at, now)}</div>
      <div className="t-body-medium muted">{relative(at)} at {formatTime(at.getHours() * 60 + at.getMinutes())}</div>
    </div>
  );
}

function Empty({ icon, title, text, action, onIcon, iconLabel }: { icon: string; title: string; text?: string; action?: ReactNode; onIcon?: () => void; iconLabel?: string }) {
  return (
    <div className="pa-empty">
      {onIcon
        ? <button className="pa-empty-icon" aria-label={iconLabel} onClick={onIcon}><MIcon name={icon} size={56} /></button>
        : <MIcon name={icon} size={56} />}
      <div className="t-title-medium">{title}</div>
      {text && <div className="t-body-medium muted">{text}</div>}
      {action}
    </div>
  );
}

/** The weather when [a] next rings: a small symbol and °C, or nothing past the forecast (or while off). */
function AlarmWeather({ a, now, fc }: { a: ClockAlarm; now: Date; fc: Hourly | null }) {
  const v = a.enabled ? forecastView(fc, nextRing(a, now)) : null;
  if (!v) return null;
  return <span className="pa-cardwx" aria-label={`${v.label}, ${v.text} when it rings`}><MIcon name={v.icon} size={18} />{v.text}</span>;
}

function AlarmCard({ a, now, fc, onClick }: { a: ClockAlarm; now: Date; fc: Hourly | null; onClick: () => void }) {
  return (
    <div className={`pa-card pa-alarm ${a.enabled ? "" : "off"}`} role="button" onClick={onClick}>
      <div className="grow">
        {a.label.trim() && <div className="t-body-medium pa-label">{a.label.trim()}</div>}
        <div className="pa-time48"><HeldTime step={1} min={a.hour * 60 + a.minute} onChange={(m) => void save({ ...a, hour: Math.floor(m / 60), minute: m % 60 })} /></div>
        <div className="t-body-medium muted pa-line">{scheduleLine(a, now)}</div>
      </div>
      <AlarmWeather a={a} now={now} fc={fc} />
      <Switch checked={a.enabled} label="On" onChange={(v) => void save({ ...a, enabled: v })} />
    </div>
  );
}

function BundleCard({ group, now, fc, open, onOpen, onEdit }: {
  group: ClockAlarm[]; now: Date; fc: Hourly | null; open: boolean; onOpen: () => void; onEdit: (a: ClockAlarm) => void;
}) {
  const on = group.filter((a) => a.enabled).length;
  const first = group[0], last = group[group.length - 1];
  return (
    <div className={`pa-card pa-bundle ${on ? "" : "off"}`}>
      <div className="pa-bundle-head" role="button" onClick={onOpen}>
        <div className="grow">
          <div className="t-body-medium muted">{group.length} alarms · {on} on</div>
          <div className="pa-time36">{formatTime(first.hour * 60 + first.minute)} – {formatTime(last.hour * 60 + last.minute)}</div>
        </div>
        <span className="muted pa-expand"><MIcon name={open ? "fExpandLess" : "fExpandMore"} /></span>
        <Switch checked={on > 0} label="All on" onChange={(v) => void Promise.all(group.map((a) => native.saveClock({ ...a, enabled: v }))).then(refreshAlarmState)} />
      </div>
      <div className={`pa-bundle-body ${open ? "open" : ""}`}>
        <div>
          {group.map((a) => (
            <div key={a.id} className={`pa-bundle-row ${a.enabled ? "" : "off"}`} role="button" onClick={() => onEdit(a)}>
              <div className="grow">
                <div className="pa-time24">{formatTime(a.hour * 60 + a.minute)}</div>
                <div className="t-body-small muted pa-line">{[a.label.trim(), scheduleLine(a, now)].filter(Boolean).join(" · ")}</div>
              </div>
              <AlarmWeather a={a} now={now} fc={fc} />
              <Switch checked={a.enabled} label="On" onChange={(v) => void save({ ...a, enabled: v })} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** New or changed alarm: a big time (tap to change), the days, a label and the sound (AlarmEditor). */
function AlarmEditor({ alarm, isNew, onClose }: { alarm: ClockAlarm; isNew: boolean; onClose: () => void }) {
  const [minute, setMinute] = useState(alarm.hour * 60 + alarm.minute);
  const [label, setLabel] = useState(alarm.label);
  const [days, setDays] = useState(alarm.days);
  const [dates, setDates] = useState<number[]>(alarm.dates ?? []);
  const [skip, setSkip] = useState<number[]>(alarm.skip ?? []);
  const [pausedUntil, setPausedUntil] = useState<number | null>(alarm.pausedUntil ?? null);
  const [picker, setPicker] = useState<null | "dates" | "skip" | "until">(null);
  const [sound, setSound] = useState(alarm.sound);
  const [pickTime, setPickTime] = useState(isNew);
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
          <span className="t-title-medium grow">{isNew ? "New alarm" : "Alarm"}</span>
          {!isNew && <TextButton className="icon" onClick={() => { void act(native.deleteClock(alarm.id)); close(); }}><MIcon name="oDelete" size={18} /> Delete</TextButton>}
        </div>
        <button className="pa-bigtime" onClick={() => setPickTime(true)}><HeldTime step={1} min={minute} onChange={setMinute} /></button>
        <div className="pa-erow">
          <MIcon name="fRepeat" />
          {dates.length ? (
            <button className="pa-dates" onClick={() => setPicker("dates")}>
              <span className="t-body-large pa-line">{dates.slice(0, 4).map(shortDay).join(", ") + (dates.length > 4 ? ` +${dates.length - 4}` : "")}</span>
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
        {repeating && <>
          <div className="p-divider" />
          <div className="pa-erow pa-pause">
            <MIcon name="oEventBusy" />
            {pause ? <>
              <button className="pa-pause-text t-body-large" onClick={() => setPicker(pausedUntil != null && pausedUntil > today ? "until" : "skip")}>{pause}</button>
              <IconButton icon="fClose" label="Stop pausing" onClick={() => { setSkip([]); setPausedUntil(null); }} />
            </> : <>
              <span className="t-body-large muted grow">Pause</span>
              <TextButton onClick={() => setPicker("skip")}>Skip days</TextButton>
              <TextButton onClick={() => setPicker("until")}>Until…</TextButton>
            </>}
          </div>
        </>}
        <div className="p-divider" />
        <label className="pa-erow">
          <MIcon name="oLabel" />
          <input className="pa-label-input" value={label} placeholder="Add label" enterKeyHint="done" autoCapitalize="sentences"
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
          <button className="p-filled-btn" onClick={() => {
            const a = tidySchedule({ ...alarm, hour: Math.floor(minute / 60), minute: minute % 60, label: label.trim(), days, sound, enabled: true, dates, skip, pausedUntil }, today);
            close();
            void ensureNotifications("This alarm rings at its time even with the app closed, through a notification.").then(() => save(a));
          }}>Save</button>
        </div>
      </div>
    )}</BottomSheet>
    {pickTime && <TimePickerDialog value={minute} onPick={setMinute} onClose={() => setPickTime(false)} />}
    {picker === "dates" && <MultiDatePickerDialog title="Ring on these dates" value={dates} from={today} onPick={setDates} onClose={() => setPicker(null)} />}
    {picker === "skip" && <MultiDatePickerDialog title="Skip these days" value={skip} from={today} onPick={(d) => { setSkip(d); if (d.length) setPausedUntil(null); }} onClose={() => setPicker(null)} />}
    {picker === "until" && <DatePickerDialog value={pausedUntil ?? today + 7} onPick={(d) => { setPausedUntil(d > today ? d : null); setSkip([]); }} onClose={() => setPicker(null)} />}
  </>;
}

// ---------- Timer ----------

const startTimer = async (durationMs: number, label = "") => {
  await ensureNotifications("A running timer shows its countdown in a notification and rings when it's done, even with the screen locked.");
  await act(native.timer("start", { durationMs, label }));
};

function TimersPane({ timers, active, onNew }: { timers: ClockTimer[]; active: boolean; onNew: () => void }) {
  const running = timers.some((t) => t.endAt != null);
  const now = useTick(250, active && running);
  return (
    <div className="pa-scroll pa-gap12 pa-top12">
      <PermissionCards />
      {timers.length === 0 && <Empty icon="oTimer" title="No timers" text="Tap + or a length below" />}
      <div className="pa-presets">
        {TIMER_PRESETS.map((m) => <button key={m} className="p-assist pa-chip" onClick={() => void startTimer(m * 60_000)}>{presetText(m)}</button>)}
        <button className="p-assist pa-chip" onClick={onNew}>Other…</button>
      </div>
      {[...timers].sort((a, b) => a.id - b.id).map((t) => <TimerCard key={t.id} t={t} now={now} />)}
    </div>
  );
}

function TimerCard({ t, now }: { t: ClockTimer; now: number }) {
  const left = timerLeft(t, now);
  const running = t.endAt != null;
  const run = (action: "pause" | "resume" | "plus" | "reset" | "delete") => void act(native.timer(action, { id: t.id }));
  return (
    <div className="pa-card pa-timer">
      <div className="pa-timer-head">
        <span className="t-body-medium muted grow">{t.label.trim() || `${formatDuration(t.durationMs)} timer`}</span>
        <IconButton icon="fClose" label="Delete timer" onClick={() => run("delete")} />
      </div>
      <div className={`pa-time52 ${running ? "" : "muted"}`}>{formatDuration(left)}</div>
      <div className="pa-buttons">
        {running
          ? <button className="pa-tonal" onClick={() => run("pause")}>Pause</button>
          : <button className="p-filled-btn" onClick={() => run("resume")}>{left === t.durationMs ? "Start" : "Resume"}</button>}
        <button className="p-outlined-btn" onClick={() => run("plus")}>+1:00</button>
        {left !== t.durationMs && <TextButton onClick={() => run("reset")}>Reset</TextButton>}
      </div>
    </div>
  );
}

/** Hours, minutes and seconds (and a label) for a new timer; it starts on "Start" (NewTimerDialog). */
function NewTimerDialog({ onClose }: { onClose: () => void }) {
  const [h, setH] = useState(""), [m, setM] = useState(""), [s, setS] = useState(""), [label, setLabel] = useState("");
  const total = ((Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0)) * 1000;
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 2);
  const start = () => { if (total > 0) { onClose(); void startTimer(total, label.trim()); } };
  return (
    <Dialog title="New timer" onClose={onClose} actions={<>
      <TextButton onClick={onClose}>Cancel</TextButton>
      <TextButton disabled={total <= 0} onClick={start}>Start</TextButton>
    </>}>
      <div className="pa-hms">
        <Field label="h" value={h} onChange={(v) => setH(digits(v))} numeric autoFocus />
        <Field label="min" value={m} onChange={(v) => setM(digits(v))} numeric />
        <Field label="s" value={s} onChange={(v) => setS(digits(v))} numeric />
      </div>
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

function StopwatchPane({ active }: { active: boolean }) {
  const sw = useAlarmState().tools.stopwatch;
  const running = sw.startedAt != null;
  const now = useTick(31, active && running);
  const total = elapsed(sw, now);
  const lengths = lapLengths(sw.laps);
  const run = (a: "start" | "pause" | "lap" | "reset") => void act(native.stopwatch(a));
  const shown = stopwatchParts(total);
  return (
    <div className="pa-scroll pa-sw">
      <div className="pa-sw-time">{shown.main}<span className="pa-sw-cs">.{shown.cs}</span></div>
      <div className="pa-buttons center">
        {running ? <>
          <button className="p-outlined-btn" onClick={() => run("lap")}>Lap</button>
          <button className="pa-tonal" onClick={() => run("pause")}>Pause</button>
        </> : <>
          {total > 0 && <button className="p-outlined-btn" onClick={() => run("reset")}>Reset</button>}
          <button className="p-filled-btn" onClick={() => run("start")}>{total > 0 ? "Resume" : "Start"}</button>
        </>}
      </div>
      {lengths.length > 0 && <>
        <div className="p-divider pa-sw-divider" />
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

// ---------- World clock ----------

const systemZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function WorldClockPane({ zones, local, active, onAdd }: { zones: string[]; local: string; active: boolean; onAdd: () => void }) {
  const now = useTick(1000, active);
  const here = local || systemZone();
  const h24 = use24h();
  return (
    <div className="pa-scroll pa-gap12 pa-top16">
      <div className="pa-local">
        <div className="pa-local-text">
          <div className="pa-time52">{zoneClock(here, now, h24)}</div>
          <div className="t-body-medium muted">{cityName(here)} · here</div>
        </div>
        <WeatherChip id={here} now={now} active={active} />
      </div>
      {zones.length === 0 && <Empty icon="oPublic" title="No cities" action={<TextButton onClick={onAdd}>Add a city</TextButton>} />}
      {zones.map((z) => <CityCard key={z} zone={z} here={here} now={now} h24={h24} active={active} />)}
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

/** A city on the world clock, by its stored id (a zone, or "zone#Name": domain/cities.ts). */
function CityCard({ zone: id, here, now, h24, active }: { zone: string; here: string; now: number; h24: boolean; active: boolean }) {
  const zone = zoneOf(id);
  let sub = "";
  try { sub = [zoneDayLabel(zone, now, here), zoneOffsetLabel(zone, now, here)].filter(Boolean).join(" · "); } catch { return null; }
  return (
    <div className="pa-card pa-city">
      <div className="grow pa-city-text">
        <div className="t-title-medium pa-line">{cityLabel(id)}</div>
        <div className="t-body-small muted pa-line">{sub}</div>
      </div>
      <WeatherChip id={id} now={now} active={active} />
      <span className="pa-time26">{zoneClock(zone, now, h24)}</span>
      <IconButton icon="fClose" label="Remove" onClick={() => void act(native.zone("remove", id))} />
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


