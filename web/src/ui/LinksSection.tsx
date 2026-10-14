import { useState } from "react";
import { preview } from "../domain/text.ts";
import type { Item } from "../domain/types.ts";
import { addLink, removeLink, type Snapshot } from "../store/store.ts";
import { Icon, go, openItem } from "./common.tsx";

export const typeLabel = (i: Item) =>
  i.type === "TASK" ? (i.freq !== "NONE" ? "Recurring task" : "Task") : i.type === "EVENT" ? (i.freq !== "NONE" ? "Recurring event" : "Event") : i.noteDay !== null ? "Daily note" : "Note";

/** Linked items in both directions, with add / remove and a shortcut to the graph. */
export function LinksSection({ id, s, ensureSaved }: { id: number; s: Snapshot; ensureSaved: () => number }) {
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const rows: { item: Item; label: string; removable: boolean }[] = [];
  const seen = new Set<number>();
  for (const l of s.links) {
    if (l.sourceId === id && s.byId.has(l.targetId)) { seen.add(l.targetId); rows.push({ item: s.byId.get(l.targetId)!, label: l.auto ? "Mentioned with [[ ]]" : "Linked", removable: !l.auto }); }
  }
  for (const l of s.links) {
    if (l.targetId === id && s.byId.has(l.sourceId) && !seen.has(l.sourceId)) rows.push({ item: s.byId.get(l.sourceId)!, label: l.auto ? "Mentions this" : "Links here", removable: !l.auto });
  }
  const exclude = new Set([id, ...s.neighbours(id)]);
  const options = s.items
    .filter((i) => !exclude.has(i.id) && (!q || i.title.toLowerCase().includes(q.toLowerCase()) || preview(i.content, 400).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);

  return (
    <div>
      <div className="section">
        Links <span className="grow" />
        {id !== 0 && <button className="btn small" onClick={() => go(`graph?focus=${id}`)}><Icon name="graph" size={14} /> Graph</button>}
        <button className="btn small" onClick={() => setPicking(!picking)}><Icon name="link" size={14} /> Link</button>
      </div>
      {rows.length === 0 && !picking && <div className="hint">Connect this to other notes, tasks or events. You can also type [[Title]] in the text.</div>}
      {rows.map(({ item, label, removable }) => (
        <div key={item.id} className="task" onClick={() => openItem(item)}>
          <span className="bar" style={{ background: s.colorOf(item) }} />
          <div className="grow"><div className="ellipsis">{item.title || "Untitled"}</div><div className="sub">{typeLabel(item)} · {label}</div></div>
          {removable && <button className="icon-btn" title="Remove link" onClick={(e) => { e.stopPropagation(); removeLink(id, item.id); }}><Icon name="close" size={16} /></button>}
        </div>
      ))}
      {picking && (
        <div className="card" style={{ padding: 10, marginTop: 6 }}>
          <input className="input" style={{ width: "100%" }} autoFocus placeholder="Search to link…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div style={{ maxHeight: 260, overflow: "auto", marginTop: 6 }}>
            {options.map((i) => (
              <div key={i.id} className="task" onClick={() => { const me = ensureSaved(); if (me) addLink(me, i.id); setPicking(false); setQ(""); }}>
                <span className="bar" style={{ background: s.colorOf(i) }} />
                <div className="grow"><div className="ellipsis">{i.title || "Untitled"}</div><div className="sub">{typeLabel(i)}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
