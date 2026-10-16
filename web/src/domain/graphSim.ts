// The links graph's layout physics (the phone's and the PC's): nodes push each other apart, links pull
// like springs towards a resting length, and a gentle pull keeps everything near the centre. Repulsion
// only counts neighbours within CUTOFF, found through a grid of CUTOFF-sized cells, so a step costs
// about O(n) instead of O(n²) and hundreds of nodes stay smooth; further than that it's negligible
// next to the springs and the centre pull. Pure (tested in test/graphSim.test.ts).

export interface P { x: number; y: number; vx: number; vy: number }

/** How far repulsion reaches (world units). */
export const CUTOFF = 420;
const REPULSION = 5000;
const LINK_LENGTH = 110;
const LINK_STRENGTH = 0.04;
const CENTRE = 0.012;
const FRICTION = 0.82;

/** The repulsion on each node from its neighbours within [cutoff], through a grid. */
export function repulsion(nodes: P[], cutoff = CUTOFF): { fx: Float64Array; fy: Float64Array } {
  const n = nodes.length;
  const fx = new Float64Array(n), fy = new Float64Array(n);
  const cells = new Map<number, number[]>();
  const key = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768);
  const cx = new Int32Array(n), cy = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    cx[i] = Math.floor(nodes[i].x / cutoff);
    cy[i] = Math.floor(nodes[i].y / cutoff);
    const k = key(cx[i], cy[i]);
    const c = cells.get(k);
    if (c) c.push(i); else cells.set(k, [i]);
  }
  const c2 = cutoff * cutoff;
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    for (let gx = -1; gx <= 1; gx++) {
      for (let gy = -1; gy <= 1; gy++) {
        const list = cells.get(key(cx[i] + gx, cy[i] + gy));
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > c2) continue;
          // On top of each other: a small fixed push apart (deterministic, by index).
          if (d2 < 1) { dx = ((i * 7 + j * 13) % 11) / 11 - 0.5 || 0.3; dy = ((i * 5 + j * 3) % 13) / 13 - 0.5 || -0.2; d2 = 1; }
          const k = REPULSION / (d2 * Math.sqrt(d2));
          fx[i] += dx * k; fy[i] += dy * k;
          fx[j] -= dx * k; fy[j] -= dy * k;
        }
      }
    }
  }
  return { fx, fy };
}

/**
 * One step of the layout at temperature [alpha] (1 hot, cooling towards 0). [edges] are pairs of
 * indexes into [nodes]; [pinned] nodes (one held under a finger) feel no force and don't move here.
 */
export function simStep(nodes: P[], edges: [number, number][], alpha: number, pinned?: Set<number>) {
  const { fx, fy } = repulsion(nodes);
  for (const [a, b] of edges) {
    const pa = nodes[a], pb = nodes[b];
    const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.max(1, Math.hypot(dx, dy)), k = (LINK_STRENGTH * (d - LINK_LENGTH)) / d;
    fx[a] += dx * k; fy[a] += dy * k; fx[b] -= dx * k; fy[b] -= dy * k;
  }
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i];
    if (pinned?.has(i)) continue;
    p.vx = (p.vx + (fx[i] - p.x * CENTRE) * alpha) * FRICTION;
    p.vy = (p.vy + (fy[i] - p.y * CENTRE) * alpha) * FRICTION;
    p.x += p.vx;
    p.y += p.vy;
  }
}

/** The force-free start of a node: spread round the centre by its id (stable between visits). */
export function seedPosition(id: number, count: number): P {
  const r = 40 * Math.sqrt(count + 1);
  const a = ((id % 997) / 997) * Math.PI * 2, d = ((id % 389) / 389) * r;
  return { x: Math.cos(a) * d, y: Math.sin(a) * d, vx: 0, vy: 0 };
}
