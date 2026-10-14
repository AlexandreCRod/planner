// Obsidian-style graph: force layout of linked items, drawn in SVG (same rules as the phone).
import { useEffect, useMemo, useRef, useState } from "react";
import { preview } from "../domain/text.ts";
import type { ItemType } from "../domain/types.ts";
import { useSnapshot } from "../store/store.ts";
import { Icon, openItem } from "./common.tsx";
import { typeLabel } from "./LinksSection.tsx";

interface P { x: number; y: number; vx: number; vy: number }

export function GraphView({ focusId }: { focusId: number }) {
  const s = useSnapshot();
  const [types, setTypes] = useState<Set<ItemType>>(new Set(["NOTE", "TASK", "EVENT"]));
  const [orphans, setOrphans] = useState(false);
  const [focus, setFocus] = useState(focusId);
  const [depth, setDepth] = useState(2);
  const [selected, setSelected] = useState(focusId);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const pos = useRef(new Map<number, P>());
  const [, setFrame] = useState(0);
  const svg = useRef<SVGSVGElement>(null);

  const graph = useMemo(() => {
    const ids = new Set(s.items.filter((i) => types.has(i.type)).map((i) => i.id));
    let edges = [...new Set(s.links.filter((l) => ids.has(l.sourceId) && ids.has(l.targetId) && l.sourceId !== l.targetId)
      .map((l) => (l.sourceId < l.targetId ? `${l.sourceId}:${l.targetId}` : `${l.targetId}:${l.sourceId}`)))]
      .map((k) => k.split(":").map(Number) as [number, number]);
    let keep: Set<number> = ids;
    if (focus && s.byId.has(focus)) {
      const adj = new Map<number, number[]>();
      for (const [a, b] of edges) { adj.set(a, [...(adj.get(a) ?? []), b]); adj.set(b, [...(adj.get(b) ?? []), a]); }
      keep = new Set([focus]);
      let frontier = [focus];
      for (let i = 0; i < depth; i++) {
        frontier = frontier.flatMap((n) => adj.get(n) ?? []).filter((n) => !keep.has(n));
        frontier.forEach((n) => keep.add(n));
      }
      edges = edges.filter(([a, b]) => keep.has(a) && keep.has(b));
    }
    const degree = new Map<number, number>();
    for (const [a, b] of edges) { degree.set(a, (degree.get(a) ?? 0) + 1); degree.set(b, (degree.get(b) ?? 0) + 1); }
    const nodes = s.items.filter((i) => keep.has(i.id) && (orphans || focus || (degree.get(i.id) ?? 0) > 0));
    return { nodes, edges, degree };
  }, [s, types, orphans, focus, depth]);

  // Physics: repulsion between all nodes, springs along links, a gentle pull to the centre.
  useEffect(() => {
    const ids = graph.nodes.map((n) => n.id);
    const r = 40 * Math.sqrt(ids.length + 1);
    for (const id of ids) {
      if (!pos.current.has(id)) {
        const a = (id % 997) / 997 * Math.PI * 2, d = ((id % 389) / 389) * r;
        pos.current.set(id, { x: Math.cos(a) * d, y: Math.sin(a) * d, vx: 0, vy: 0 });
      }
    }
    let alpha = 1, raf = 0;
    const tick = () => {
      const f = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
      for (let i = 0; i < ids.length; i++) {
        const a = pos.current.get(ids[i])!;
        for (let j = i + 1; j < ids.length; j++) {
          const b = pos.current.get(ids[j])!;
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
          const k = 5000 / (d2 * Math.sqrt(d2));
          f.get(ids[i])!.x += dx * k; f.get(ids[i])!.y += dy * k;
          f.get(ids[j])!.x -= dx * k; f.get(ids[j])!.y -= dy * k;
        }
      }
      for (const [a, b] of graph.edges) {
        const pa = pos.current.get(a), pb = pos.current.get(b);
        if (!pa || !pb) continue;
        const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.max(1, Math.hypot(dx, dy)), k = 0.04 * (d - 110) / d;
        f.get(a)!.x += dx * k; f.get(a)!.y += dy * k; f.get(b)!.x -= dx * k; f.get(b)!.y -= dy * k;
      }
      for (const id of ids) {
        const p = pos.current.get(id)!, fo = f.get(id)!;
        p.vx = (p.vx + (fo.x - p.x * 0.012) * alpha) * 0.82;
        p.vy = (p.vy + (fo.y - p.y * 0.012) * alpha) * 0.82;
        p.x += p.vx; p.y += p.vy;
      }
      alpha *= 0.985;
      setFrame((n) => n + 1);
      if (alpha > 0.02) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [graph]);

  const onWheel = (e: React.WheelEvent) => setView((v) => ({ ...v, k: Math.max(0.2, Math.min(4, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) }));
  const onPan = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("[data-node]")) return;
    const x0 = e.clientX, y0 = e.clientY, start = view;
    const move = (ev: PointerEvent) => setView({ ...start, x: start.x + ev.clientX - x0, y: start.y + ev.clientY - y0 });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const neighbours = new Set(selected ? graph.edges.flatMap(([a, b]) => (a === selected ? [b] : b === selected ? [a] : [])) : []);
  const sel = s.byId.get(selected);
  const w = svg.current?.clientWidth ?? 800, h = svg.current?.clientHeight ?? 600;
  const P = (id: number) => { const p = pos.current.get(id); return p ? { x: w / 2 + view.x + p.x * view.k, y: h / 2 + view.y + p.y * view.k } : null; };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="chips-row" style={{ padding: "10px 16px 0" }}>
        {([["NOTE", "Notes"], ["TASK", "Tasks"], ["EVENT", "Events"]] as [ItemType, string][]).map(([t, l]) => (
          <button key={t} className={`chip ${types.has(t) ? "on" : ""}`} onClick={() => { const n = new Set(types); if (n.has(t)) n.delete(t); else n.add(t); setTypes(n); }}>{l}</button>
        ))}
        <button className={`chip ${orphans ? "on" : ""}`} onClick={() => setOrphans(!orphans)}>Unlinked</button>
        {focus !== 0 && <><button className="chip on" onClick={() => setFocus(0)}>Focused · clear</button>
          <button className="chip" onClick={() => setDepth(depth === 1 ? 2 : 1)}>Depth {depth}</button></>}
        <span className="grow" />
        <button className="btn small" onClick={() => setView({ x: 0, y: 0, k: 1 })}>Reset view</button>
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {graph.nodes.length === 0 && <div className="hint" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>No connections yet.<br />Link items from their editor, or type [[Title]] inside a note.</div>}
        <svg ref={svg} width="100%" height="100%" onWheel={onWheel} onPointerDown={onPan} onClick={(e) => { if (!(e.target as Element).closest("[data-node]")) setSelected(0); }} style={{ cursor: "grab", display: "block" }}>
          {graph.edges.map(([a, b]) => {
            const pa = P(a), pb = P(b);
            if (!pa || !pb) return null;
            const hot = a === selected || b === selected;
            return <line key={`${a}-${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={hot ? "var(--accent)" : "var(--line)"} strokeWidth={hot ? 2.5 : 1.5} />;
          })}
          {graph.nodes.map((n) => {
            const p = P(n.id);
            if (!p) return null;
            const deg = graph.degree.get(n.id) ?? 0;
            const r = (7 + Math.sqrt(deg) * 4) * Math.min(1.6, Math.max(0.6, view.k));
            const dim = selected !== 0 && n.id !== selected && !neighbours.has(n.id);
            return (
              <g key={n.id} data-node onClick={(e) => { e.stopPropagation(); setSelected(n.id); }} onDoubleClick={() => openItem(n)} style={{ cursor: "pointer", opacity: dim ? 0.3 : 1 }}>
                <circle cx={p.x} cy={p.y} r={r} fill={s.colorOf(n)} stroke={n.type === "TASK" ? "var(--text)" : "none"} strokeOpacity={0.5} strokeWidth={1.5} />
                {n.type === "EVENT" && <circle cx={p.x} cy={p.y} r={r * 0.45} fill="var(--surface)" fillOpacity={0.5} />}
                {(n.id === selected || n.id === focus) && <circle cx={p.x} cy={p.y} r={r + 4} fill="none" stroke="var(--accent)" strokeWidth={2.5} />}
                {(view.k > 0.55 || deg >= 3 || n.id === selected) && (
                  <text x={p.x} y={p.y + r + 13} textAnchor="middle" fontSize={11.5} fill="var(--text)">{(n.title || "Untitled").slice(0, 28)}</text>
                )}
              </g>
            );
          })}
        </svg>
        {sel && (
          <div className="card" style={{ position: "absolute", left: 16, bottom: 16, padding: 14, width: 320, boxShadow: "var(--shadow)" }}>
            <b>{sel.title || "Untitled"}</b>
            <div className="hint">{typeLabel(sel)} · {graph.degree.get(sel.id) ?? 0} connection(s)</div>
            {preview(sel.content, 140) && <div style={{ fontSize: 13, marginTop: 4 }}>{preview(sel.content, 140)}</div>}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn small" onClick={() => openItem(sel)}>Open</button>
              <button className="btn small" onClick={() => { setFocus(sel.id); setView({ x: 0, y: 0, k: 1 }); }}><Icon name="graph" size={14} /> Focus</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
