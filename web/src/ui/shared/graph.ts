// The links graph's data and physics, for the Links page (PhoneLists.tsx's PhoneGraph): which nodes and
// links to draw, and the force layout (domain/graphSim.ts) run frame by frame.
import { useEffect, useMemo, useRef } from "react";
import type { ItemType } from "../../domain/types.ts";
import type { Snapshot } from "../../store/store.ts";
import { type P, seedPosition, simStep } from "../../domain/graphSim.ts";

export type { P };

/** The nodes and links to draw: the chosen types, around the focused item when there is one. */
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

/**
 * Runs the layout physics (domain/graphSim.ts) on [pos] for [graph], calling [onFrame] after each step.
 * [settled]: the positions are kept from before (a page come back to), so its first graph starts at rest.
 */
export function useGraphSim(graph: Graph, pos: React.MutableRefObject<Map<number, P>>, onFrame: () => void, settled = false): GraphSim {
  const calm = useRef(settled ? graph : null);
  const frame = useRef(onFrame);
  frame.current = onFrame;
  const ctl = useRef<{ alpha: number; raf: number; pinned: Map<number, { x: number; y: number }>; run: () => void }>({ alpha: 0, raf: 0, pinned: new Map(), run: () => {} });
  useEffect(() => {
    const c = ctl.current;
    const ids = graph.nodes.map((n) => n.id);
    const unplaced = ids.some((id) => !pos.current.has(id));
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
    // Come back to, the first layout is only drawn where it was (a node not placed yet still settles).
    const fresh = calm.current !== graph || unplaced;
    c.alpha = fresh ? 1 : 0;
    if (fresh) c.run(); else frame.current();
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
