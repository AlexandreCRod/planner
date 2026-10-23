// The list pages on the phone, drawn as the native screens are: Tasks (TasksScreen.kt), Notes
// (NotesScreen.kt), Links (GraphScreen.kt) and Search (BrowseScreen.kt). The data rules are the PC
// views' own (shared helpers), only the drawing is the phone's.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "../../domain/dates.ts";
import { today as todayEpoch } from "../../domain/dates.ts";
import { currentEntry, streak, type TaskEntry } from "../../domain/schedule.ts";
import { isRoutineItem, isRoutineSeries, routineEntry } from "../../domain/routines.ts";
import { showStreaks } from "../../store/routines.ts";
import { notePreview, preview } from "../../domain/text.ts";
import { type Item, type ItemType, NO_DAY, cssColor, displayTitle, isRecurring, newItem } from "../../domain/types.ts";
import { saveItem, type Snapshot, useSnapshot } from "../../store/store.ts";
import { KINDS, subtitle, typeLabel } from "../shared/kinds.ts";
import { TaskRow, go, openItem, replaceRoute, useCheckedHold, useNow } from "../shared/common.tsx";
import { isWide } from "../../platform.ts";
import { type P, buildGraph, useGraphSim } from "../shared/graph.ts";
import { AppBarActions, ChipRow, DropdownMenu, EmptyHint, FilterChip, IconButton, MIcon, Scaffold, SectionHeader, Segmented, TopAppBar } from "./chrome.tsx";
import { onColor } from "./PhoneCalendar.tsx";
import { findInNextNote } from "./NoteFind.tsx";
import { useNoteGrid } from "./noteDrag.ts";
import { listOrderChanges, pinOrderChanges, sortNotes } from "../../domain/noteOrder.ts";
import { TOUCH_SLOP } from "./press.ts";
import { VelocityTracker } from "./motion.ts";
import { feel } from "./haptics.ts";
import { useGlide } from "./glide.ts";
import { SwipeToTrash, TrashSwipeWay } from "./SwipeRow.tsx";
import { type Selection, SelectBox, SelectedMark, SelectionBar, useSelection } from "./Select.tsx";
import { spring, useSwipePager } from "./pager.ts";
import { flushSync } from "react-dom";
import { count } from "../../domain/plural.ts";
import { StreaksSheet } from "./StreaksSheet.tsx";
import { keepValue, keptValue, useKeep, useKeptScroll, useKeptState } from "./keep.ts";

// ---------- Tasks ----------

const GROUPS = ["Daily", "Weekly", "Monthly", "Yearly", "One-time", "Anytime"] as const;
function groupOf(e: TaskEntry): (typeof GROUPS)[number] {
  switch (e.item.freq) {
    case "DAILY": return "Daily";
    case "WEEKLY": return "Weekly";
    case "MONTHLY": return "Monthly";
    case "YEARLY": return "Yearly";
    default: return e.item.startDay === null ? "Anytime" : "One-time";
  }
}

/**
 * Tasks: Scheduled and To-do side by side. A sideways swipe turns between them, live like the other
 * pagers (the lists follow the finger, the switch's indicator rides along, release settles). The rows'
 * own swipe to the trash keeps the other way: on Scheduled a swipe left turns to To-do and a swipe right
 * removes a row; on To-do a swipe right turns back and a swipe left removes one.
 */
/** Opens Tasks on its To-do tab (from Today's "2 tasks without a date"), every time. */
export function openTodoTab() {
  try { localStorage.setItem("tasksTab", "todo"); } catch { /* private mode */ }
  todoListener?.();
  go("tasks");
}
let todoListener: (() => void) | null = null;
const savedTab = () => { try { return localStorage.getItem("tasksTab") === "todo"; } catch { return false; } };

export const PhoneTasks = memo(function PhoneTasks() {
  const [todo, setTodo] = useState(savedTab);
  const [menu, setMenu] = useState(false);
  const [streaksOpen, setStreaksOpen] = useState(false);
  const index = todo ? 1 : 0;
  const idx = useRef(index);
  idx.current = index;
  const strip = useRef<HTMLDivElement>(null);
  const track = useRef<((p: number | null) => void) | null>(null);
  const stopSlide = useRef<(() => void) | null>(null);
  const setIndex = (i: number) => { idx.current = i; setTodo(i === 1); try { localStorage.setItem("tasksTab", i === 1 ? "todo" : "scheduled"); } catch { /* private mode */ } };
  /** Puts the strip back where its tab is, with nothing left over from a slide. */
  const rest = () => { stopSlide.current?.(); stopSlide.current = null; if (strip.current) strip.current.style.transform = ""; };
  // A tap on the switch slides there on the pager's spring; from elsewhere ([slide] false) it's just there.
  const showTab = (v: "scheduled" | "todo", slide = true) => {
    const i = v === "todo" ? 1 : 0, from = idx.current;
    rest();
    if (i === from) return;
    const el = strip.current, w = el?.parentElement?.clientWidth ?? 0;
    flushSync(() => setIndex(i));
    if (!slide || !el || !w) return;
    const place = (x: number) => { el.style.transform = x ? `translate3d(${x}px,0,0)` : ""; };
    stopSlide.current = spring((i - from) * w, 0, 0, place, () => { stopSlide.current = null; place(0); });
  };
  // The page is opened on To-do from Today while it's out of sight: no slide, just the right tab.
  useEffect(() => { todoListener = () => showTab("todo", false); return () => { todoListener = null; }; });
  const pager = useSwipePager<HTMLDivElement>({
    layers: () => [strip.current],
    onStep: (d) => setIndex(Math.min(1, Math.max(0, idx.current + d))),
    canStep: (d) => idx.current + d >= 0 && idx.current + d <= 1,
    yieldAtEdge: true,
    onMove: (x, w) => { stopSlide.current?.(); stopSlide.current = null; track.current?.(idx.current - x / w); },
    onSettled: () => track.current?.(null),
    allow: (t) => !t.closest("input, textarea, .p-chiprow"),
  });
  return (
    <Scaffold title="Tasks" flush actions={<>
      <AppBarActions />
      <span className="p-menu-anchor">
        <IconButton icon="oMoreVert" label="More" onClick={() => setMenu(true)} />
        <DropdownMenu open={menu} onClose={() => setMenu(false)} items={[{ label: "Streaks", icon: "fLocalFireDepartment", onClick: () => setStreaksOpen(true) }]} />
      </span>
    </>}>
      <div className="p-seg-wrap">
        <Segmented value={todo ? "todo" : "scheduled"} options={[["scheduled", "Scheduled"], ["todo", "To-do"]]} onChange={showTab} track={track} />
      </div>
      <div className="p-tabpager" ref={pager}>
        <div className="p-tabstrip" ref={strip} style={{ left: `${-index * 100}%` }}>
          <div className="p-list p-rows p-tabpage" style={{ left: 0 }} aria-hidden={todo}>
            <TrashSwipeWay.Provider value={swipeRight}><ScheduledList /></TrashSwipeWay.Provider>
          </div>
          <div className="p-list p-rows p-tabpage" style={{ left: "100%" }} aria-hidden={!todo}>
            <TrashSwipeWay.Provider value={swipeLeft}><TodoList /></TrashSwipeWay.Provider>
          </div>
        </div>
      </div>
      {streaksOpen && <StreaksSheet onClose={() => setStreaksOpen(false)} />}
    </Scaffold>
  );
});
const swipeRight = (dx: number) => dx > 0;
const swipeLeft = (dx: number) => dx < 0;

function ScheduledList() {
  const s = useSnapshot();
  const now = useNow();
  const t = todayEpoch();
  const [showDone, setShowDone] = useState(false);
  const [category, setCategory] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const hold = useCheckedHold();
  const streaks = showStreaks();
  const entries = s.items
    .filter((i) => i.type === "TASK" && i.startDay !== null && (category === null || i.categoryId === category))
    // A routine's box ticks today's (or the next) day, never a missed one.
    .map((i) => (isRoutineItem(i) ? routineEntry(i, s.done, t) : currentEntry(i, s.done, t)))
    .filter((e) => showDone || e.status !== "DONE" || isRecurring(e.item));
  const sorted = (list: TaskEntry[]) => [...list].sort((a, b) =>
    Number(a.status === "DONE") - Number(b.status === "DONE") || b.item.priority - a.item.priority ||
    (a.day ?? 1e9) - (b.day ?? 1e9) || (a.item.startMin ?? 1e9) - (b.item.startMin ?? 1e9) || a.item.title.localeCompare(b.item.title));
  return <>
    <ChipRow className="tasks">
      <FilterChip selected={showDone} onClick={() => setShowDone(!showDone)}>Show completed</FilterChip>
      {s.categories.map((c) => (
        <FilterChip key={c.id} selected={category === c.id} onClick={() => setCategory(category === c.id ? null : c.id)}>{c.name}</FilterChip>
      ))}
    </ChipRow>
    {entries.length === 0 && <EmptyHint>No tasks yet. Tap + and try "Stretch every day 7am".</EmptyHint>}
    {GROUPS.map((g) => {
      const list = hold.arrange(g, sorted(entries.filter((e) => groupOf(e) === g)), (e) => String(e.item.id));
      if (!list.length) return null;
      const isCollapsed = collapsed.has(g);
      return (
        <div key={g}>
          <SectionHeader expanded={!isCollapsed} onClick={() => {
            const n = new Set(collapsed);
            if (isCollapsed) n.delete(g); else n.add(g);
            setCollapsed(n);
          }}>{g} ({list.length})</SectionHeader>
          {!isCollapsed && list.map((e, index) => (
            <SwipeToTrash key={e.item.id} item={e.item}>
              <TaskRow entry={e} s={s} now={now} showDay priorityTag streakInfo={streaks && isRoutineSeries(e.item) ? streak(e.item, s.done, t) : undefined}
                onToggle={(done) => hold.onToggle(g, String(e.item.id), e, index, done)} />
            </SwipeToTrash>
          ))}
        </div>
      );
    })}
    <div className="p-endspace" />
  </>;
}

/** Tasks with no date or time, Google Tasks style, with a line to add one straight away. */
function TodoList() {
  const s = useSnapshot();
  const now = useNow();
  const hold = useCheckedHold();
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(false);
  const undated = s.items.filter((i) => i.type === "TASK" && i.startDay === null);
  const open = undated.filter((i) => !s.done.isDone(i.id, NO_DAY))
    .sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt)
    .map((item): TaskEntry => ({ item, day: null, status: "ANYTIME", missed: 0 }));
  const shown = hold.arrange("todo", open, (e) => String(e.item.id));
  const done = undated.filter((i) => s.done.isDone(i.id, NO_DAY)).sort((a, b) => b.updatedAt - a.updatedAt);
  const add = () => {
    const title = text.trim();
    if (!title) return;
    saveItem(newItem({ type: "TASK", title }));
    setText("");
  };
  // A ticked to-do glides down into Completed (or into its header, when it's folded away).
  const box = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const doneKeys = new Set(done.map((i) => `t${i.id}`));
  useGlide(box, layer, (k) => doneKeys.has(k));
  return <div className="p-glide" ref={box}>
    <div ref={layer} />
    <div className="p-todo-add">
      <MIcon name="oAddTask" />
      <input placeholder="Add a to-do" value={text} enterKeyHint="done" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
      {text.trim() && <button className="p-text-btn" onClick={add}>Add</button>}
    </div>
    {!shown.length && !done.length && <EmptyHint>Nothing to do. Type above to add a task with no date.</EmptyHint>}
    {shown.map((e, index) => (
      <div key={e.item.id} data-glide={`t${e.item.id}`}>
        <SwipeToTrash item={e.item}>
          <TaskRow entry={e} s={s} now={now} priorityTag onToggle={(isDone) => hold.onToggle("todo", String(e.item.id), e, index, isDone)} />
        </SwipeToTrash>
      </div>
    ))}
    {done.length > 0 && <>
      <div data-glide="completed" data-glide-into="">
        <SectionHeader expanded={showDone} onClick={() => setShowDone(!showDone)}>Completed ({done.length})</SectionHeader>
      </div>
      {showDone && done.map((item) => (
        <div key={`d${item.id}`} data-glide={`t${item.id}`}>
          <SwipeToTrash item={item}>
            <TaskRow entry={{ item, day: null, status: "DONE", missed: 0 }} s={s} now={now} />
          </SwipeToTrash>
        </div>
      ))}
    </>}
    <div className="p-endspace" />
  </div>;
}

// ---------- Notes ----------

const NOTE_FONTS = ["", "Georgia, 'Noto Serif', serif", "'Droid Sans Mono', 'Roboto Mono', monospace", "'Dancing Script', cursive"];
type NoteFilter = "notes" | "pinned" | "daily" | "hidden";
const EMPTY_NOTES: Record<NoteFilter, string> = {
  hidden: "No hidden notes.",
  daily: "No daily notes yet. Open a day's note from Today or the calendar.",
  pinned: "No pinned notes.",
  notes: "No notes yet. Tap + to write one.",
};

export const PhoneNotes = memo(function PhoneNotes() {
  const s = useSnapshot();
  const [filter, setFilter] = useState<NoteFilter>("notes");
  const [tag, setTag] = useState<number | null>(null);
  // Hidden notes stay off the page (Search finds them); a Hidden chip lists them while there are any.
  const hiddenCount = useMemo(() => s.items.filter((i) => i.type === "NOTE" && i.hidden).length, [s]);
  const matching = useMemo(() => s.items.filter((i) => i.type === "NOTE")
    .filter((n) => (filter === "hidden" ? !!n.hidden : !n.hidden))
    .filter((n) => (filter === "daily" ? n.noteDay !== null : filter === "hidden" || (n.noteDay === null && (filter !== "pinned" || n.pinned))))
    .filter((n) => tag === null || (s.tagsByItem.get(n.id) ?? []).some((t) => t.id === tag)), [s, filter, tag, hiddenCount]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pinned first in their own order (dragged into place), then the rest by last edit or where they were
  // dragged to. The cards stay in this order in the page; while one is dragged, only their places on
  // the grid follow the order it's being dragged into.
  const notes = useMemo(() => sortNotes(matching), [matching]);
  const [liveOrder, setLiveOrder] = useState<number[] | null>(null);
  const shownIds = useMemo(() => notes.map((n) => n.id), [notes]);
  const sel = useSelection(shownIds);
  const grid = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  // Notes and Pinned can be put in order; daily and hidden notes keep theirs.
  const canOrder = filter === "notes" || filter === "pinned";
  const noteGrid = useNoteGrid({
    grid: () => grid.current, scroller: () => grid.current?.closest<HTMLElement>(".p-list") ?? null, order: liveOrder ?? shownIds,
    groupOf: (id) => { const n = byId.get(id); return !n || !canOrder ? null : n.pinned ? "pinned" : "other"; },
    setOrder: setLiveOrder, isSelected: (id) => sel.ids.has(id), unselect: (id) => sel.toggle(id),
    onDrop: (ids, moved) => {
      const changes: { id: number; pinOrder?: number; listOrder?: number }[] = byId.get(moved)?.pinned
        ? pinOrderChanges(notes, ids.filter((id) => byId.get(id)?.pinned))
        : listOrderChanges(notes, ids, moved);
      for (const c of changes) { const n = s.byId.get(c.id); if (n) saveItem({ ...n, ...c }); }
    },
  });
  return (
    <Scaffold title="Notes" flush bar={sel.active ? <SelectionBar sel={sel} items={(ids) => notes.filter((n) => ids.has(n.id))} /> : undefined} actions={<>
      <IconButton icon="oConstellation" label="Links" onClick={() => go("graph")} />
      <AppBarActions />
    </>}>
      <div className="p-list notes">
        <ChipRow className="notes">
          {(["notes", "pinned", "daily"] as const).map((k) => (
            <FilterChip key={k} selected={filter === k} onClick={() => setFilter(k)}>{k === "notes" ? "Notes" : k === "pinned" ? "Pinned" : "Daily notes"}</FilterChip>
          ))}
          {(hiddenCount > 0 || filter === "hidden") && <FilterChip selected={filter === "hidden"} onClick={() => setFilter(filter === "hidden" ? "notes" : "hidden")}>Hidden</FilterChip>}
          {s.tags.map((t) => <FilterChip key={t.id} selected={tag === t.id} onClick={() => setTag(tag === t.id ? null : t.id)}>#{t.name}</FilterChip>)}
        </ChipRow>
        {notes.length === 0 && <EmptyHint>{EMPTY_NOTES[filter]}</EmptyHint>}
        <div className="p-notegrid" ref={grid}>
          {notes.map((n) => <NoteCard key={n.id} n={n} s={s} sel={sel} onDragDown={canOrder ? noteGrid.down : undefined} />)}
        </div>
        <div className="p-endspace" />
      </div>
    </Scaffold>
  );
});

/**
 * Opens a note. Wide, the note shows beside the list, and one already open there gives way to it (so
 * one step back still closes the pane, however many notes were looked at).
 */
function openNote(n: Item) {
  if (isWide() && location.hash.replace(/^#\/?/, "").startsWith("note/")) replaceRoute(`note/${n.id}`);
  else openItem(n);
}

function NoteCard({ n, s, sel, onDragDown }: { n: Item; s: Snapshot; sel: Selection; onDragDown?: (id: number, e: React.PointerEvent<HTMLElement>) => void }) {
  const picked = sel.ids.has(n.id);
  const bg = n.bgColor !== null ? cssColor(n.bgColor) : undefined;
  const fg = bg ? onColor(bg) : undefined;
  const accentArgb = n.color ?? (n.categoryId !== null ? s.categoryById.get(n.categoryId)?.color ?? null : null);
  const text = notePreview(n.content);
  const tags = (s.tagsByItem.get(n.id) ?? []).map((t) => `#${t.name}`).join(" ");
  const links = s.neighbours(n.id).size;
  const updated = Math.floor((n.updatedAt - new Date(n.updatedAt).getTimezoneOffset() * 60000) / 86400000);
  // A card can also be dragged into another place, after a long press (noteDrag.ts).
  const sp = sel.pressProps(n.id);
  const press = onDragDown ? { ...sp, onPointerDown: (e: React.PointerEvent<HTMLElement>) => { sp.onPointerDown(e); onDragDown(n.id, e); } } : sp;
  return (
    <div className={`p-notecard ${picked ? "sel" : ""}`} role="button" aria-pressed={sel.active ? picked : undefined} data-note={n.id} {...press}
      onClick={(e) => sel.tap(n.id, () => openNote(n), e)} style={{ background: bg, color: fg, fontFamily: NOTE_FONTS[n.fontFamily] || undefined }}>
      {accentArgb !== null && <div className="accent" style={{ background: cssColor(accentArgb) }} />}
      {picked ? <SelectedMark /> : <SelectBox onPick={() => sel.toggle(n.id)} />}
      <div className="in">
        <div className="head">
          <span className="title">{n.noteDay !== null ? formatDate(n.noteDay) : n.title || "Untitled"}</span>
          {n.pinned && <MIcon name="fPushPin" size={14} />}
        </div>
        {text && <div className="text">{text}</div>}
        <div className="foot">
          <span className="grow">{tags || formatDate(updated)}</span>
          {links > 0 && <><MIcon name="oLink" size={12} /><span>{links}</span></>}
        </div>
      </div>
    </div>
  );
}

// ---------- Links (graph) ----------

/**
 * The links graph, a page of its own (from the Notes bar, or an item's Links section with that item in
 * focus). Positions never go through React: the layout steps (domain/graphSim.ts) and every gesture
 * write the SVG's attributes straight from refs, once a frame, so hundreds of nodes stay smooth.
 * A node grabbed with a finger sticks under it and the layout warms up, so what's linked to it follows
 * on its springs; let go, it keeps the finger's speed. A tap picks the nearest node; one finger on empty
 * space pans, two pinch.
 */
export const PhoneGraph = memo(function PhoneGraph({ focusId = 0 }: { focusId?: number }) {
  const s = useSnapshot();
  // Back from an item opened here finds the graph as it was: filters, focus, the picked node, the
  // view and where every node had settled (the layout doesn't start over).
  const keep = useKeep();
  const [types, setTypes] = useKeptState<Set<ItemType>>(keep, "types", () => new Set(["NOTE", "TASK", "EVENT"]));
  const [orphans, setOrphans] = useKeptState(keep, "orphans", false);
  const [focus, setFocus] = useKeptState(keep, "focus", focusId);
  const [depth, setDepth] = useKeptState(keep, "depth", 2);
  const [selected, setSelected] = useKeptState(keep, "selected", 0);
  // The view (pan and zoom) lives in a ref while fingers move; the state copy only re-renders labels.
  const [view, setViewState] = useState(() => keptValue<{ x: number; y: number; k: number }>(keep, "view") ?? { x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  const [pos] = useState(() => { const p = { current: keptValue<Map<number, P>>(keep, "pos") ?? new Map<number, P>() }; keepValue(keep, "pos", p.current); return p; });
  const box = useRef<HTMLDivElement>(null);
  const size = useRef({ w: 400, h: 600 });
  const [svgSize, setSvgSize] = useState({ w: 400, h: 600 });
  const nodeEls = useRef(new Map<number, SVGGElement>());
  const edgeEls = useRef(new Map<string, SVGLineElement>());
  const graph = useMemo(() => buildGraph(s, types, orphans, focus, depth), [s, types, orphans, focus, depth]);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  /** Writes every node and line where the layout and the view put them. */
  const draw = () => {
    const v = viewRef.current, { w, h } = size.current;
    const sx = (x: number) => w / 2 + v.x + x * v.k, sy = (y: number) => h / 2 + v.y + y * v.k;
    const scaleR = Math.min(1.6, Math.max(0.6, v.k));
    const g = graphRef.current;
    for (const n of g.nodes) {
      const el = nodeEls.current.get(n.id), p = pos.current.get(n.id);
      if (!el || !p) continue;
      el.setAttribute("transform", `translate(${sx(p.x).toFixed(2)} ${sy(p.y).toFixed(2)})`);
      // Sized per node, at its first placing too: a node that has just arrived (the Unlinked filter) has
      // no position for the first draw, so a size given only on zoom changes left it without a circle.
      const key = `${scaleR}|${g.degree.get(n.id) ?? 0}`;
      if (el.dataset.size !== key) {
        el.dataset.size = key;
        const r = (7 + Math.sqrt(g.degree.get(n.id) ?? 0) * 4) * scaleR;
        for (const c of el.querySelectorAll<SVGCircleElement>("circle")) c.setAttribute("r", String(r * Number(c.dataset.f ?? 1) + Number(c.dataset.add ?? 0)));
        el.querySelector("text")?.setAttribute("y", String(r + 2));
      }
    }
    for (const [a, b] of g.edges) {
      const el = edgeEls.current.get(`${a}-${b}`), pa = pos.current.get(a), pb = pos.current.get(b);
      if (!el || !pa || !pb) continue;
      el.setAttribute("x1", sx(pa.x).toFixed(2)); el.setAttribute("y1", sy(pa.y).toFixed(2));
      el.setAttribute("x2", sx(pb.x).toFixed(2)); el.setAttribute("y2", sy(pb.y).toFixed(2));
    }
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const sim = useGraphSim(graph, pos, () => drawRef.current(), keep.back);
  // The view as it is when the page goes (an item opened from it), for coming back.
  useEffect(() => () => keepValue(keep, "view", viewRef.current), []); // eslint-disable-line react-hooks/exhaustive-deps
  // New nodes or a new selection re-render the elements: place them at once.
  useLayoutEffect(() => { for (const el of nodeEls.current.values()) delete el.dataset.size; draw(); });

  const setView = (v: { x: number; y: number; k: number }) => { viewRef.current = v; setViewState(v); };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { size.current = { w: el.clientWidth, h: el.clientHeight }; setSvgSize(size.current); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let start: { view: typeof view; cx: number; cy: number; d: number } | null = null;
    let tap: { x: number; y: number; id: number } | null = null;
    // A node under the first finger: dragged instead of panning.
    let held: { id: number; pointer: number; dx: number; dy: number; vt: VelocityTracker; vtY: VelocityTracker; moved: boolean } | null = null;
    let viewMoved = false;
    const toWorld = (x: number, y: number) => {
      const r = el.getBoundingClientRect(), v = viewRef.current;
      return { x: (x - r.left - r.width / 2 - v.x) / v.k, y: (y - r.top - r.height / 2 - v.y) / v.k };
    };
    const nearest = (x: number, y: number) => {
      const w = toWorld(x, y), v = viewRef.current;
      let best = 0, bestD = Infinity;
      for (const n of graphRef.current.nodes) {
        const p = pos.current.get(n.id);
        if (!p) continue;
        const d = Math.hypot(p.x - w.x, p.y - w.y);
        if (d < bestD) { bestD = d; best = n.id; }
      }
      return bestD < 28 / Math.min(1, v.k) ? best : 0;
    };
    const mid = () => {
      const p = [...pts.values()];
      const cx = p.reduce((a, q) => a + q.x, 0) / p.length, cy = p.reduce((a, q) => a + q.y, 0) / p.length;
      const d = p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0;
      return { cx, cy, d };
    };
    const rebase = () => { start = pts.size ? { view: viewRef.current, ...mid() } : null; };
    let raf = 0;
    const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawRef.current(); }); };
    const letGo = (t: number) => {
      if (!held) return;
      if (held.moved) feel("settle");
      const k = viewRef.current.k;
      // px per ms on screen → world units per layout step (about 16.7 ms).
      sim.unpin(held.id, (held.vt.velocity(t) * 16.7) / k, (held.vtY.velocity(t) * 16.7) / k);
      held = null;
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element).closest("button, .p-graphcard")) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture(e.pointerId);
      tap = pts.size === 1 ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
      if (pts.size === 1) {
        const id = nearest(e.clientX, e.clientY);
        if (id) {
          const p = pos.current.get(id)!, w = toWorld(e.clientX, e.clientY);
          held = { id, pointer: e.pointerId, dx: p.x - w.x, dy: p.y - w.y, vt: new VelocityTracker(), vtY: new VelocityTracker(), moved: false };
          held.vt.add(e.timeStamp, e.clientX); held.vtY.add(e.timeStamp, e.clientY);
        }
      } else letGo(e.timeStamp);
      rebase();
    };
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TOUCH_SLOP) tap = null;
      if (held && held.pointer === e.pointerId) {
        held.vt.addEvent(e, "x"); held.vtY.addEvent(e, "y");
        if (tap) return;
        if (!held.moved) { held.moved = true; feel("pickup"); }
        const w = toWorld(e.clientX, e.clientY);
        sim.pin(held.id, w.x + held.dx, w.y + held.dy);
        return;
      }
      if (tap) return;
      const m = mid();
      const r = el.getBoundingClientRect();
      const k = start.d && m.d ? Math.max(0.2, Math.min(4, start.view.k * (m.d / start.d))) : start.view.k;
      // Keep the world point that was under the fingers' centre under it.
      const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
      const wx = (start.cx - ox - start.view.x) / start.view.k, wy = (start.cy - oy - start.view.y) / start.view.k;
      viewRef.current = { k, x: m.cx - ox - wx * k, y: m.cy - oy - wy * k };
      viewMoved = true;
      later();
    };
    const onUp = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (tap && tap.id === e.pointerId) setSelected(nearest(e.clientX, e.clientY));
      if (held && held.pointer === e.pointerId) letGo(e.timeStamp);
      tap = null;
      rebase();
      // The labels and sizes follow the zoom once the fingers are off.
      if (!pts.size && viewMoved) { viewMoved = false; setViewState(viewRef.current); }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleType = (t: ItemType) => { const n = new Set(types); if (n.has(t)) n.delete(t); else n.add(t); setTypes(n); };
  const neighbours = new Set(selected ? graph.edges.flatMap(([a, b]) => (a === selected ? [b] : b === selected ? [a] : [])) : []);
  const sel = s.byId.get(selected);
  const pv = sel ? preview(sel.content, 140) : "";

  return (
    <Scaffold title="Links" flush back>
      <ChipRow className="graph">
        {([["NOTE", "Notes"], ["TASK", "Tasks"], ["EVENT", "Events"]] as [ItemType, string][]).map(([t, l]) => (
          <FilterChip key={t} selected={types.has(t)} onClick={() => toggleType(t)}>{l}</FilterChip>
        ))}
        <FilterChip selected={orphans} onClick={() => setOrphans(!orphans)}>Unlinked</FilterChip>
        {focus !== 0 && <>
          <FilterChip selected onClick={() => setFocus(0)}>Focused · clear</FilterChip>
          <FilterChip selected={depth === 1} onClick={() => setDepth(depth === 1 ? 2 : 1)}>Depth {depth}</FilterChip>
        </>}
      </ChipRow>
      <div className="p-graph" ref={box}>
        {graph.nodes.length === 0 && <div className="p-graph-empty"><span>No connections yet.<br />Link items with Link in their editor.</span></div>}
        <svg width={svgSize.w} height={svgSize.h}>
          {graph.edges.map(([a, b]) => {
            const hot = a === selected || b === selected;
            return <line key={`${a}-${b}`} className={hot ? "hot" : ""} ref={(el) => { if (el) edgeEls.current.set(`${a}-${b}`, el); else edgeEls.current.delete(`${a}-${b}`); }} />;
          })}
          {graph.nodes.map((n) => {
            const deg = graph.degree.get(n.id) ?? 0;
            const dim = selected !== 0 && n.id !== selected && !neighbours.has(n.id);
            return (
              <g key={n.id} ref={(el) => { if (el) nodeEls.current.set(n.id, el); else nodeEls.current.delete(n.id); }}>
                <circle fill={s.colorOf(n)} fillOpacity={dim ? 0.3 : 1} />
                {n.type === "TASK" && <circle className="ring" />}
                {n.type === "EVENT" && <circle className="dot" data-f="0.45" />}
                {(n.id === selected || n.id === focus) && <circle className="hl" data-add="3" />}
                {(view.k > 0.55 || deg >= 3 || n.id === selected) && (
                  <text className={dim ? "dim" : ""}>{(n.title || "Untitled").slice(0, 28)}</text>
                )}
              </g>
            );
          })}
        </svg>
        <IconButton className="p-graph-reset" icon="oZoomOutMap" label="Reset view" onClick={() => { setView({ x: 0, y: 0, k: 1 }); sim.reheat(0.3); }} />
        {sel && (
          <div className="p-graphcard">
            <div className="t-title-medium">{sel.title || "Untitled"}</div>
            <div className="t-body-small muted">{typeLabel(sel)} · {count(graph.degree.get(sel.id) ?? 0, "connection")}</div>
            {pv && <div className="t-body-small clamp3">{pv}</div>}
            <div className="actions">
              <button className="p-text-btn icon" onClick={() => openItem(sel)}><MIcon name="oOpenInNew" size={18} />Open</button>
              <button className="p-text-btn icon" onClick={() => { setFocus(sel.id); setView({ ...viewRef.current, x: 0, y: 0 }); }}><MIcon name="oCenterFocusStrong" size={18} />Focus</button>
            </div>
          </div>
        )}
      </div>
    </Scaffold>
  );
});

// ---------- Search ----------

const SORTS: [string, string][] = [["updated", "Recently edited"], ["date", "Date"], ["title", "Title"], ["links", "Most connected"]];
const TYPE_ICON: Record<ItemType, string> = { TASK: "oTaskAlt", EVENT: "fEvent", NOTE: "oDescription" };

/** The kinds Search starts with when opened from a page: that page's own (none: All). */
const PAGE_KINDS: Record<string, string[]> = {
  notes: ["NOTES"],
  tasks: ["TASKS", "RECURRING_TASKS"],
  calendar: ["EVENTS", "RECURRING_EVENTS"],
};

export function PhoneSearch({ initialKind, from = "" }: { initialKind: string; from?: string }) {
  const s = useSnapshot();
  // Back to Search (from a result) finds it as it was: words, filters, sort and scroll.
  const keep = useKeep();
  const [q, setQ] = useKeptState(keep, "q", "");
  // The kinds shown (several can be picked; none is All). Opened from a page, that page's kinds.
  const [kinds, setKinds] = useKeptState<ReadonlySet<string>>(keep, "kinds", () => new Set(
    (initialKind ? initialKind.split(",") : PAGE_KINDS[from] ?? []).filter((k) => KINDS.some(([x]) => x === k && x !== "ALL"))));
  const toggleKind = (k: string) => setKinds((ks) => {
    if (k === "ALL") return new Set();
    const n = new Set(ks);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const [cat, setCat] = useKeptState<number | null>(keep, "cat", null);
  const [tag, setTag] = useKeptState<number | null>(keep, "tag", null);
  const [sort, setSort] = useKeptState(keep, "sort", "updated");
  const [menu, setMenu] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useKeptScroll(keep, "list", () => root.current?.querySelector<HTMLElement>(".p-list"));
  // As BrowseScreen.kt: the field takes the focus unless the page was opened on a kind (or is come back to).
  useEffect(() => { if (!initialKind && !keep.back) { const t = window.setTimeout(() => input.current?.focus(), 250); return () => clearTimeout(t); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => new Map(KINDS.map(([k, , t]) => [k, s.items.filter(t).length])), [s]);
  const results = useMemo(() => {
    const tests = KINDS.filter(([k]) => kinds.has(k)).map(([, , t]) => t);
    const test = (i: Item) => !tests.length || tests.some((t) => t(i));
    const ql = q.toLowerCase();
    const qt = ql.replace(/^#/, "");
    return s.items
      .filter(test)
      .filter((i) => cat === null || i.categoryId === cat)
      .filter((i) => tag === null || (s.tagsByItem.get(i.id) ?? []).some((t) => t.id === tag))
      .filter((i) => !ql.trim() || i.title.toLowerCase().includes(ql) || preview(i.content, 10000).toLowerCase().includes(ql) || (s.tagsByItem.get(i.id) ?? []).some((t) => t.name.toLowerCase().includes(qt)))
      .sort((a, b) => sort === "title" ? a.title.toLowerCase().localeCompare(b.title.toLowerCase()) : sort === "date" ? (a.startDay ?? a.noteDay ?? 1e9) - (b.startDay ?? b.noteDay ?? 1e9)
        : sort === "links" ? s.neighbours(b.id).size - s.neighbours(a.id).size : b.updatedAt - a.updatedAt);
  }, [s, q, kinds, cat, tag, sort]);
  const shownIds = useMemo(() => results.map((i) => i.id), [results]);
  const sel = useSelection(shownIds);

  return (
    <div className="p-scaffold" ref={root}>
      {sel.active ? <SelectionBar sel={sel} items={(ids) => results.filter((i) => ids.has(i.id))} /> : <TopAppBar back className="search" title={
        <div className="p-searchfield">
          <MIcon name="oSearch" />
          <input ref={input} placeholder="Search everything" value={q} enterKeyHint="search" onChange={(e) => setQ(e.target.value)} />
          {q && <IconButton icon="fClose" label="Clear" onClick={() => { setQ(""); input.current?.focus(); }} />}
        </div>
      } actions={
        <div className="p-menu-anchor">
          <IconButton icon="fSort" label="Sort" onClick={() => setMenu(true)} />
          <DropdownMenu open={menu} onClose={() => setMenu(false)} items={SORTS.map(([k, l]) => ({ label: l, checked: sort === k, onClick: () => setSort(k) }))} />
        </div>
      } />}
      <div className="p-content flush">
        <ChipRow className="search">
          {KINDS.map(([k, l]) => <FilterChip key={k} selected={k === "ALL" ? kinds.size === 0 : kinds.has(k)} onClick={() => toggleKind(k)}>{l} {counts.get(k) ?? 0}</FilterChip>)}
        </ChipRow>
        {(s.categories.length > 0 || s.tags.length > 0) && (
          <ChipRow className="search">
            {s.categories.map((c) => <FilterChip key={c.id} selected={cat === c.id} onClick={() => setCat(cat === c.id ? null : c.id)}>{c.name}</FilterChip>)}
            {s.tags.map((t) => <FilterChip key={t.id} selected={tag === t.id} onClick={() => setTag(tag === t.id ? null : t.id)}>#{t.name}</FilterChip>)}
          </ChipRow>
        )}
        <div className="p-count">{count(results.length, "result")}</div>
        <div className="p-list">
          {results.map((i) => {
            const pv = preview(i.content, 80);
            const picked = sel.ids.has(i.id);
            return (
              <div key={i.id} className={`p-itemrow ${picked ? "sel" : ""}`} role="button" aria-pressed={sel.active ? picked : undefined}
                {...sel.pressProps(i.id)} onClick={(e) => sel.tap(i.id, () => { if (i.type === "NOTE") findInNextNote(q); openItem(i); }, e)}>
                <MIcon name={TYPE_ICON[i.type]} size={20} color={s.colorOf(i)} />
                <div className="grow">
                  <div className="title">{displayTitle(i)}</div>
                  <div className="sub">{subtitle(i, s)}{pv && <><br />{pv}</>}</div>
                </div>
                {picked ? <SelectedMark /> : <SelectBox onPick={() => sel.toggle(i.id)} />}
              </div>
            );
          })}
          <div className="p-endspace" />
        </div>
      </div>
    </div>
  );
}
