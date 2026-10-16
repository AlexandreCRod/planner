// Obsidian-style graph: force layout of linked items, drawn in SVG (same rules as the phone).
import { useEffect, useMemo, useRef, useState } from "react";
import { preview } from "../domain/text.ts";
import type { ItemType } from "../domain/types.ts";
import { type Snapshot, useSnapshot } from "../store/store.ts";
import { Icon, openItem } from "./common.tsx";
import { typeLabel } from "./LinksSection.tsx";
import { count } from "../domain/plural.ts";
import { type P, seedPosition, simStep } from "../domain/graphSim.ts";

export type { P };

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

  const graph = useMemo(() => buildGraph(s, types, orphans, focus, depth), [s, types, orphans, focus, depth]);

  useGraphSim(graph, pos, () => setFrame((n) => n + 1));

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
        {graph.nodes.length === 0 && <div className="hint" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>No connections yet.<br />Connect items with Link in their editor.</div>}
        <svg ref={svg} width="100%" height="100%" onWheel={onWheel} onPointerDown={onPan} onClick={(e) => { if (!(e.target as Element).closest("[data-node]")) setSelected(0); }} style={{ cursor: "grab", display: "block" }}>
          {graph.edges.map(([a, b]) => {
            const pa = P(a), pb = P(b);
            if (!pa || !pb) return null;
            const hot = a === selected || b === selected;
            return <line key={`${a}-${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={hot ? "var(--acc)" : "var(--line)"} strokeWidth={hot ? 2.5 : 1.5} />;
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
                {(n.id === selected || n.id === focus) && <circle cx={p.x} cy={p.y} r={r + 4} fill="none" stroke="var(--strong)" strokeWidth={2.5} />}
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
            <div className="hint">{typeLabel(sel)} · {count(graph.degree.get(sel.id) ?? 0, "connection")}</div>
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

/** The nodes and links to draw: the chosen types, around the focused item when there is one (shared with the phone). */
export function buildGraph(s: Snapshot, types: Set<ItemType>, orphans: boolean, focus: number, depth: number) {
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
}

export type Graph = ReturnType<typeof buildGraph>;

export interface GraphSim {
  /** Warms the layout up again (something moved): it runs until it cools. */
  reheat(alpha?: number): void;
  /** Holds node [id] at world point (x, y) (a finger on it): it doesn't move by itself meanwhile. */
  pin(id: number, x: number, y: number): void;
  /** Lets it go at velocity (vx, vy) in world units per step. */
  unpin(id: number, vx: number, vy: number): void;
}

/** Runs the layout physics (domain/graphSim.ts) on [pos] for [graph], calling [onFrame] after each step. */
export function useGraphSim(graph: Graph, pos: React.MutableRefObject<Map<number, P>>, onFrame: () => void): GraphSim {
  const frame = useRef(onFrame);
  frame.current = onFrame;
  const ctl = useRef<{ alpha: number; raf: number; pinned: Map<number, { x: number; y: number }>; run: () => void }>({ alpha: 0, raf: 0, pinned: new Map(), run: () => {} });
  useEffect(() => {
    const c = ctl.current;
    const ids = graph.nodes.map((n) => n.id);
    for (const id of ids) if (!pos.current.has(id)) pos.current.set(id, seedPosition(id, ids.length));
    const index = new Map(ids.map((id, i) => [id, i]));
    const nodes = ids.map((id) => pos.current.get(id)!);
    const edges = graph.edges.map(([a, b]) => [index.get(a)!, index.get(b)!] as [number, number]).filter(([a, b]) => a !== undefined && b !== undefined);
    const tick = () => {
      c.raf = 0;
      const pinned = new Set<number>();
      for (const [id, at] of c.pinned) {
        const i = index.get(id);
        if (i === undefined) continue;
        pinned.add(i);
        Object.assign(nodes[i], { x: at.x, y: at.y, vx: 0, vy: 0 });
      }
      // A held node keeps the layout warm, so what's linked to it follows.
      if (pinned.size) c.alpha = Math.max(c.alpha, 0.35);
      simStep(nodes, edges, c.alpha, pinned);
      c.alpha *= 0.985;
      frame.current();
      if (c.alpha > 0.02 || pinned.size) c.raf = requestAnimationFrame(tick);
    };
    c.run = () => { if (!c.raf) c.raf = requestAnimationFrame(tick); };
    c.alpha = 1;
    c.run();
    return () => { cancelAnimationFrame(c.raf); c.raf = 0; };
  }, [graph]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo<GraphSim>(() => ({
    reheat(alpha = 0.5) { const c = ctl.current; c.alpha = Math.max(c.alpha, alpha); c.run(); },
    pin(id, x, y) { const c = ctl.current; c.pinned.set(id, { x, y }); c.run(); },
    unpin(id, vx, vy) {
      const c = ctl.current;
      c.pinned.delete(id);
      const p = pos.current.get(id);
      if (p) { p.vx = vx; p.vy = vy; }
      c.alpha = Math.max(c.alpha, 0.3);
      c.run();
    },
  }), [pos]);
}
