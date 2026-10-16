import assert from "node:assert/strict";
import { test } from "node:test";
import { CUTOFF, type P, repulsion, seedPosition, simStep } from "../src/domain/graphSim.ts";

const brute = (nodes: P[], cutoff: number) => {
  const fx = new Array(nodes.length).fill(0), fy = new Array(nodes.length).fill(0);
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d2 = dx * dx + dy * dy;
    if (d2 > cutoff * cutoff) continue;
    const k = 5000 / (d2 * Math.sqrt(d2));
    fx[i] += dx * k; fy[i] += dy * k; fx[j] -= dx * k; fy[j] -= dy * k;
  }
  return { fx, fy };
};

const scatter = (n: number) => Array.from({ length: n }, (_, i) => seedPosition(i * 7919 + 13, n * 4));

test("the grid finds exactly the pairs within reach (same forces as checking every pair)", () => {
  const nodes = scatter(300);
  const a = repulsion(nodes), b = brute(nodes, CUTOFF);
  for (let i = 0; i < nodes.length; i++) {
    assert.ok(Math.abs(a.fx[i] - b.fx[i]) < 1e-9 && Math.abs(a.fy[i] - b.fy[i]) < 1e-9, `node ${i}`);
  }
});

test("repulsion pushes apart and adds up to nothing overall", () => {
  const nodes: P[] = [{ x: 0, y: 0, vx: 0, vy: 0 }, { x: 10, y: 0, vx: 0, vy: 0 }, { x: 0, y: 0, vx: 0, vy: 0 }];
  const { fx, fy } = repulsion(nodes);
  assert.ok(fx[1] > 0); // pushed away from the others
  assert.ok(Math.abs(fx[0] + fx[1] + fx[2]) < 1e-9 && Math.abs(fy[0] + fy[1] + fy[2]) < 1e-9);
  assert.ok(Number.isFinite(fx[0]) && Number.isFinite(fx[2])); // two on the same spot still separate
});

test("a held node stays put while a linked one is pulled towards it", () => {
  const nodes: P[] = [{ x: 0, y: 0, vx: 0, vy: 0 }, { x: 600, y: 0, vx: 0, vy: 0 }];
  for (let t = 0; t < 60; t++) simStep(nodes, [[0, 1]], 0.5, new Set([0]));
  assert.deepEqual([nodes[0].x, nodes[0].y], [0, 0]);
  assert.ok(nodes[1].x < 300, `${nodes[1].x}`);
});

test("hundreds of nodes settle without blowing up", () => {
  const nodes = scatter(400);
  const edges: [number, number][] = nodes.slice(1).map((_, i) => [i, i + 1]);
  for (let t = 0, a = 1; t < 200; t++, a *= 0.985) simStep(nodes, edges, a);
  assert.ok(nodes.every((p) => Number.isFinite(p.x) && Math.abs(p.x) < 1e5));
});
