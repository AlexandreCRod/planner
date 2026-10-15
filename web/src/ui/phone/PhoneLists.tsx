// The list pages on the phone, drawn as the native screens are: Tasks (TasksScreen.kt), Notes
// (NotesScreen.kt), Links (GraphScreen.kt) and Search (BrowseScreen.kt). The data rules are the PC
// views' own (shared helpers), only the drawing is the phone's.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "../../domain/dates.ts";
import { today as todayEpoch } from "../../domain/dates.ts";
import { currentEntry, streak, type TaskEntry } from "../../domain/schedule.ts";
import { preview } from "../../domain/text.ts";
import { type Item, type ItemType, NO_DAY, cssColor, displayTitle, isRecurring, newItem } from "../../domain/types.ts";
import { saveItem, type Snapshot, useSnapshot } from "../../store/store.ts";
import { KINDS, subtitle } from "../BrowseView.tsx";
import { TaskRow, openItem, useCheckedHold, useNow } from "../common.tsx";
import { type P, buildGraph, useGraphSim } from "../GraphView.tsx";
import { typeLabel } from "../LinksSection.tsx";
import { ChipRow, DropdownMenu, EmptyHint, FilterChip, IconButton, MIcon, Scaffold, SectionHeader, Segmented, TopAppBar } from "./chrome.tsx";
import { onColor } from "./PhoneCalendar.tsx";
import { TOUCH_SLOP } from "./press.ts";

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

export const PhoneTasks = memo(function PhoneTasks() {
  const [todo, setTodo] = useState(() => localStorage.getItem("tasksTab") === "todo");
  const showTab = (v: "scheduled" | "todo") => { setTodo(v === "todo"); localStorage.setItem("tasksTab", v); };
  return (
    <Scaffold title="Tasks" flush>
      <div className="p-seg-wrap">
        <Segmented value={todo ? "todo" : "scheduled"} options={[["scheduled", "Scheduled"], ["todo", "To-do"]]} onChange={showTab} />
      </div>
      <div className="p-list p-rows">{todo ? <TodoList /> : <ScheduledList />}</div>
    </Scaffold>
  );
});

function ScheduledList() {
  const s = useSnapshot();
  const now = useNow();
  const t = todayEpoch();
  const [showDone, setShowDone] = useState(false);
  const [category, setCategory] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const hold = useCheckedHold();
  const entries = s.items
    .filter((i) => i.type === "TASK" && i.startDay !== null && (category === null || i.categoryId === category))
    .map((i) => currentEntry(i, s.done, t))
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
            <TaskRow key={e.item.id} entry={e} s={s} now={now} showDay streakInfo={isRecurring(e.item) ? streak(e.item, s.done, t) : undefined}
              onToggle={(done) => hold.onToggle(g, String(e.item.id), e, index, done)} />
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
  return <>
    <div className="p-todo-add">
      <MIcon name="oAddTask" />
      <input placeholder="Add a to-do" value={text} enterKeyHint="done" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
      {text.trim() && <button className="p-text-btn" onClick={add}>Add</button>}
    </div>
    {!shown.length && !done.length && <EmptyHint>Nothing to do. Type above to add a task with no date.</EmptyHint>}
    {shown.map((e, index) => (
      <TaskRow key={e.item.id} entry={e} s={s} now={now} onToggle={(isDone) => hold.onToggle("todo", String(e.item.id), e, index, isDone)} />
    ))}
    {done.length > 0 && <>
      <SectionHeader expanded={showDone} onClick={() => setShowDone(!showDone)}>Completed ({done.length})</SectionHeader>
      {showDone && done.map((item) => <TaskRow key={`d${item.id}`} entry={{ item, day: null, status: "DONE", missed: 0 }} s={s} now={now} />)}
    </>}
    <div className="p-endspace" />
  </>;
}

// ---------- Notes ----------

const NOTE_FONTS = ["", "Georgia, 'Noto Serif', serif", "'Droid Sans Mono', 'Roboto Mono', monospace", "'Dancing Script', cursive"];
type NoteFilter = "notes" | "pinned" | "daily";
const EMPTY_NOTES: Record<NoteFilter, string> = {
  daily: "No daily notes yet. Open a day's note from Today or the calendar.",
  pinned: "No pinned notes.",
  notes: "No notes yet. Tap + to write one.",
};

export const PhoneNotes = memo(function PhoneNotes() {
  const s = useSnapshot();
  const [filter, setFilter] = useState<NoteFilter>("notes");
  const [tag, setTag] = useState<number | null>(null);
  const notes = useMemo(() => s.items.filter((i) => i.type === "NOTE")
    .filter((n) => (filter === "daily" ? n.noteDay !== null : n.noteDay === null && (filter !== "pinned" || n.pinned)))
    .filter((n) => tag === null || (s.tagsByItem.get(n.id) ?? []).some((t) => t.id === tag))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt), [s, filter, tag]);
  // Two columns, each card going under the shorter one (a staggered grid, in list order).
  const cols = useMemo(() => {
    const out: [Item[], Item[]] = [[], []];
    const h = [0, 0];
    for (const n of notes) {
      const c = h[0] <= h[1] ? 0 : 1;
      out[c].push(n);
      h[c] += 70 + Math.min(8, Math.ceil(preview(n.content, 220).length / 26)) * 16;
    }
    return out;
  }, [notes]);
  return (
    <Scaffold title="Notes" flush>
      <div className="p-list notes">
        <ChipRow className="notes">
          {(["notes", "pinned", "daily"] as const).map((k) => (
            <FilterChip key={k} selected={filter === k} onClick={() => setFilter(k)}>{k === "notes" ? "Notes" : k === "pinned" ? "Pinned" : "Daily notes"}</FilterChip>
          ))}
          {s.tags.map((t) => <FilterChip key={t.id} selected={tag === t.id} onClick={() => setTag(tag === t.id ? null : t.id)}>#{t.name}</FilterChip>)}
        </ChipRow>
        {notes.length === 0 && <EmptyHint>{EMPTY_NOTES[filter]}</EmptyHint>}
        <div className="p-notegrid">
          {cols.map((col, i) => <div key={i} className="p-notecol">{col.map((n) => <NoteCard key={n.id} n={n} s={s} />)}</div>)}
        </div>
        <div className="p-endspace" />
      </div>
    </Scaffold>
  );
});

function NoteCard({ n, s }: { n: Item; s: Snapshot }) {
  const bg = n.bgColor !== null ? cssColor(n.bgColor) : undefined;
  const fg = bg ? onColor(bg) : undefined;
  const accentArgb = n.color ?? (n.categoryId !== null ? s.categoryById.get(n.categoryId)?.color ?? null : null);
  const text = preview(n.content, 220);
  const tags = (s.tagsByItem.get(n.id) ?? []).map((t) => `#${t.name}`).join(" ");
  const links = s.neighbours(n.id).size;
  const updated = Math.floor((n.updatedAt - new Date(n.updatedAt).getTimezoneOffset() * 60000) / 86400000);
  return (
    <div className="p-notecard" role="button" onClick={() => openItem(n)} style={{ background: bg, color: fg, fontFamily: NOTE_FONTS[n.fontFamily] || undefined }}>
      {accentArgb !== null && <div className="accent" style={{ background: cssColor(accentArgb) }} />}
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

export const PhoneGraph = memo(function PhoneGraph() {
  const s = useSnapshot();
  const [types, setTypes] = useState<Set<ItemType>>(new Set(["NOTE", "TASK", "EVENT"]));
  const [orphans, setOrphans] = useState(false);
  const [focus, setFocus] = useState(0);
  const [depth, setDepth] = useState(2);
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pos = useRef(new Map<number, P>());
  const [, setFrame] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 400, h: 600 });
  const graph = useMemo(() => buildGraph(s, types, orphans, focus, depth), [s, types, orphans, focus, depth]);
  useGraphSim(graph, pos, setFrame);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // One finger pans, two pinch (0.2× to 4×, around the fingers), a tap picks the nearest node
  // within reach, as detectTransformGestures and detectTapGestures do on the native canvas.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let start: { view: typeof view; cx: number; cy: number; d: number } | null = null;
    let tap: { x: number; y: number; id: number } | null = null;
    const mid = () => {
      const p = [...pts.values()];
      const cx = p.reduce((a, q) => a + q.x, 0) / p.length, cy = p.reduce((a, q) => a + q.y, 0) / p.length;
      const d = p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0;
      return { cx, cy, d };
    };
    const rebase = () => { start = pts.size ? { view: viewRef.current, ...mid() } : null; };
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element).closest("button, .p-graphcard")) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture(e.pointerId);
      tap = pts.size === 1 ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
      rebase();
    };
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TOUCH_SLOP) tap = null;
      if (tap) return;
      const m = mid();
      const r = el.getBoundingClientRect();
      const k = start.d && m.d ? Math.max(0.2, Math.min(4, start.view.k * (m.d / start.d))) : start.view.k;
      // Keep the world point that was under the fingers' centre under it.
      const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
      const wx = (start.cx - ox - start.view.x) / start.view.k, wy = (start.cy - oy - start.view.y) / start.view.k;
      setView({ k, x: m.cx - ox - wx * k, y: m.cy - oy - wy * k });
    };
    const onUp = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (tap && tap.id === e.pointerId) {
        const r = el.getBoundingClientRect();
        const v = viewRef.current;
        const wx = (e.clientX - r.left - r.width / 2 - v.x) / v.k, wy = (e.clientY - r.top - r.height / 2 - v.y) / v.k;
        let best = 0, bestD = Infinity;
        for (const n of graphRef.current.nodes) {
          const p = pos.current.get(n.id);
          if (!p) continue;
          const d = Math.hypot(p.x - wx, p.y - wy);
          if (d < bestD) { bestD = d; best = n.id; }
        }
        setSelected(bestD < 28 / Math.min(1, v.k) ? best : 0);
      }
      tap = null;
      rebase();
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const toggleType = (t: ItemType) => { const n = new Set(types); if (n.has(t)) n.delete(t); else n.add(t); setTypes(n); };
  const neighbours = new Set(selected ? graph.edges.flatMap(([a, b]) => (a === selected ? [b] : b === selected ? [a] : [])) : []);
  const sel = s.byId.get(selected);
  const { w, h } = size;
  const P = (id: number) => { const p = pos.current.get(id); return p ? { x: w / 2 + view.x + p.x * view.k, y: h / 2 + view.y + p.y * view.k } : null; };
  const scaleR = Math.min(1.6, Math.max(0.6, view.k));
  const pv = sel ? preview(sel.content, 140) : "";

  return (
    <Scaffold title="Links" flush>
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
        {graph.nodes.length === 0 && <div className="p-graph-empty"><span>No connections yet.<br />Link items from their editor, or type [[Title]] inside a note.</span></div>}
        <svg width={w} height={h}>
          {graph.edges.map(([a, b]) => {
            const pa = P(a), pb = P(b);
            if (!pa || !pb) return null;
            const hot = a === selected || b === selected;
            return <line key={`${a}-${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className={hot ? "hot" : ""} />;
          })}
          {graph.nodes.map((n) => {
            const p = P(n.id);
            if (!p) return null;
            const deg = graph.degree.get(n.id) ?? 0;
            const r = (7 + Math.sqrt(deg) * 4) * scaleR;
            const dim = selected !== 0 && n.id !== selected && !neighbours.has(n.id);
            return (
              <g key={n.id}>
                <circle cx={p.x} cy={p.y} r={r} fill={s.colorOf(n)} fillOpacity={dim ? 0.3 : 1} />
                {n.type === "TASK" && <circle cx={p.x} cy={p.y} r={r} className="ring" />}
                {n.type === "EVENT" && <circle cx={p.x} cy={p.y} r={r * 0.45} className="dot" />}
                {(n.id === selected || n.id === focus) && <circle cx={p.x} cy={p.y} r={r + 3} className="hl" />}
                {(view.k > 0.55 || deg >= 3 || n.id === selected) && (
                  <text x={p.x} y={p.y + r + 2} className={dim ? "dim" : ""}>{(n.title || "Untitled").slice(0, 28)}</text>
                )}
              </g>
            );
          })}
        </svg>
        <IconButton className="p-graph-reset" icon="oZoomOutMap" label="Reset view" onClick={() => setView({ x: 0, y: 0, k: 1 })} />
        {sel && (
          <div className="p-graphcard">
            <div className="t-title-medium">{sel.title || "Untitled"}</div>
            <div className="t-body-small muted">{typeLabel(sel)} · {graph.degree.get(sel.id) ?? 0} connection(s)</div>
            {pv && <div className="t-body-small clamp3">{pv}</div>}
            <div className="actions">
              <button className="p-text-btn icon" onClick={() => openItem(sel)}><MIcon name="oOpenInNew" size={18} />Open</button>
              <button className="p-text-btn icon" onClick={() => { setFocus(sel.id); setView((v) => ({ ...v, x: 0, y: 0 })); }}><MIcon name="oCenterFocusStrong" size={18} />Focus</button>
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

export function PhoneSearch({ initialKind }: { initialKind: string }) {
  const s = useSnapshot();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState(KINDS.find((k) => k[0] === initialKind)?.[0] ?? "ALL");
  const [cat, setCat] = useState<number | null>(null);
  const [tag, setTag] = useState<number | null>(null);
  const [sort, setSort] = useState("updated");
  const [menu, setMenu] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // As BrowseScreen.kt: the field takes the focus unless the page was opened on a kind.
  useEffect(() => { if (!initialKind) { const t = window.setTimeout(() => input.current?.focus(), 250); return () => clearTimeout(t); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => new Map(KINDS.map(([k, , t]) => [k, s.items.filter(t).length])), [s]);
  const results = useMemo(() => {
    const test = KINDS.find((k) => k[0] === kind)![2];
    const ql = q.toLowerCase();
    const qt = ql.replace(/^#/, "");
    return s.items
      .filter(test)
      .filter((i) => cat === null || i.categoryId === cat)
      .filter((i) => tag === null || (s.tagsByItem.get(i.id) ?? []).some((t) => t.id === tag))
      .filter((i) => !ql.trim() || i.title.toLowerCase().includes(ql) || preview(i.content, 10000).toLowerCase().includes(ql) || (s.tagsByItem.get(i.id) ?? []).some((t) => t.name.toLowerCase().includes(qt)))
      .sort((a, b) => sort === "title" ? a.title.toLowerCase().localeCompare(b.title.toLowerCase()) : sort === "date" ? (a.startDay ?? a.noteDay ?? 1e9) - (b.startDay ?? b.noteDay ?? 1e9)
        : sort === "links" ? s.neighbours(b.id).size - s.neighbours(a.id).size : b.updatedAt - a.updatedAt);
  }, [s, q, kind, cat, tag, sort]);

  return (
    <div className="p-scaffold">
      <TopAppBar back className="search" title={
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
      } />
      <div className="p-content flush">
        <ChipRow className="search">
          {KINDS.map(([k, l]) => <FilterChip key={k} selected={kind === k} onClick={() => setKind(k)}>{l} {counts.get(k) ?? 0}</FilterChip>)}
        </ChipRow>
        {(s.categories.length > 0 || s.tags.length > 0) && (
          <ChipRow className="search">
            {s.categories.map((c) => <FilterChip key={c.id} selected={cat === c.id} onClick={() => setCat(cat === c.id ? null : c.id)}>{c.name}</FilterChip>)}
            {s.tags.map((t) => <FilterChip key={t.id} selected={tag === t.id} onClick={() => setTag(tag === t.id ? null : t.id)}>#{t.name}</FilterChip>)}
          </ChipRow>
        )}
        <div className="p-count">{results.length} result(s)</div>
        <div className="p-list">
          {results.map((i) => {
            const pv = preview(i.content, 80);
            return (
              <div key={i.id} className="p-itemrow" role="button" onClick={() => openItem(i)}>
                <MIcon name={TYPE_ICON[i.type]} size={20} color={s.colorOf(i)} />
                <div className="grow">
                  <div className="title">{displayTitle(i)}</div>
                  <div className="sub">{subtitle(i, s)}{pv && <><br />{pv}</>}</div>
                </div>
              </div>
            );
          })}
          <div className="p-endspace" />
        </div>
      </div>
    </div>
  );
}
