import { useState } from "react";
import { formatDate, formatTime } from "../domain/dates.ts";
import { describe } from "../domain/recurrence.ts";
import { preview } from "../domain/text.ts";
import { type Item, isRecurring } from "../domain/types.ts";
import { type Snapshot, useSnapshot } from "../store/store.ts";
import { RepeatBadge, openItem } from "./common.tsx";
import { typeLabel } from "./LinksSection.tsx";
import { count } from "../domain/plural.ts";

export const KINDS: [string, string, (i: Item) => boolean][] = [
  ["ALL", "All", () => true],
  ["EVENTS", "Events", (i) => i.type === "EVENT" && !isRecurring(i)],
  ["RECURRING_EVENTS", "Recurring events", (i) => i.type === "EVENT" && isRecurring(i)],
  ["TASKS", "Tasks", (i) => i.type === "TASK" && !isRecurring(i)],
  ["RECURRING_TASKS", "Recurring tasks", (i) => i.type === "TASK" && isRecurring(i)],
  ["NOTES", "Notes", (i) => i.type === "NOTE" && i.noteDay === null],
  ["DAILY_NOTES", "Daily notes", (i) => i.type === "NOTE" && i.noteDay !== null],
];

export function subtitle(i: Item, s: Snapshot) {
  const parts = [typeLabel(i)];
  if (i.noteDay !== null) parts.push(formatDate(i.noteDay));
  else if (isRecurring(i)) parts.push(describe(i));
  else if (i.startDay !== null) parts.push(formatDate(i.startDay) + (i.startMin !== null ? " " + formatTime(i.startMin) : ""));
  const c = i.categoryId !== null ? s.categoryById.get(i.categoryId) : undefined;
  if (c) parts.push(c.name);
  const n = s.neighbours(i.id).size;
  if (n) parts.push(count(n, "link"));
  return parts.join(" · ");
}

export function BrowseView({ initialKind }: { initialKind: string }) {
  const s = useSnapshot();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState(KINDS.find((k) => k[0] === initialKind)?.[0] ?? "ALL");
  const [cat, setCat] = useState<number | null>(null);
  const [tag, setTag] = useState<number | null>(null);
  const [sort, setSort] = useState("updated");
  const test = KINDS.find((k) => k[0] === kind)![2];
  const ql = q.toLowerCase().replace(/^#/, "");
  const results = s.items
    .filter(test)
    .filter((i) => cat === null || i.categoryId === cat)
    .filter((i) => tag === null || (s.tagsByItem.get(i.id) ?? []).some((t) => t.id === tag))
    .filter((i) => !ql || i.title.toLowerCase().includes(ql) || preview(i.content, 10000).toLowerCase().includes(ql) || (s.tagsByItem.get(i.id) ?? []).some((t) => t.name.toLowerCase().includes(ql)))
    .sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : sort === "date" ? (a.startDay ?? a.noteDay ?? 1e9) - (b.startDay ?? b.noteDay ?? 1e9)
      : sort === "links" ? s.neighbours(b.id).size - s.neighbours(a.id).size : b.updatedAt - a.updatedAt);
  return (
    <div style={{ maxWidth: 900 }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input grow" autoFocus placeholder="Search everything" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="updated">Recently edited</option><option value="date">Date</option><option value="title">Title</option><option value="links">Most connected</option>
        </select>
      </div>
      <div className="chips-row">
        {KINDS.map(([k, l, t]) => <button key={k} className={`chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>{l} {s.items.filter(t).length}</button>)}
      </div>
      <div className="chips-row">
        {s.categories.map((c) => <button key={c.id} className={`chip ${cat === c.id ? "on" : ""}`} onClick={() => setCat(cat === c.id ? null : c.id)}>{c.name}</button>)}
        {s.tags.map((t) => <button key={t.id} className={`chip ${tag === t.id ? "on" : ""}`} onClick={() => setTag(tag === t.id ? null : t.id)}>#{t.name}</button>)}
      </div>
      <div className="hint" style={{ margin: "4px 0 8px" }}>{count(results.length, "result")}</div>
      {results.map((i) => (
        <div key={i.id} className="task" onClick={() => openItem(i)}>
          <span className="bar" style={{ background: s.colorOf(i) }} />
          <div className="grow">
            <div className="ellipsis">{isRecurring(i) && <RepeatBadge color={s.colorOf(i)} />}{i.title || (i.noteDay !== null ? formatDate(i.noteDay) : "Untitled")}</div>
            <div className="sub ellipsis">{subtitle(i, s)}</div>
            {preview(i.content, 100) && <div className="sub ellipsis">{preview(i.content, 100)}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
