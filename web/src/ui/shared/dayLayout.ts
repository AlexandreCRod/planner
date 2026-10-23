// Where the timed items of one day sit in the calendar's time grid.
import type { Occurrence } from "../../domain/schedule.ts";

export interface Placed { o: Occurrence; start: number; end: number; col: number; cols: number }

/** Side-by-side columns for overlapping items within one day. */
export function layoutDay(list: Occurrence[]): Placed[] {
  const spans = list.map((o) => {
    const start = o.startMin ?? 0;
    let end = o.item.type === "TASK" ? start + 30 : o.endMin ?? start + 60;
    if (end <= start) end = start + 30;
    return { o, start, end: Math.min(end, 1440) };
  }).sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: { sp: (typeof spans)[number]; col: number }[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => { const n = Math.max(1, colEnds.length); cluster.forEach(({ sp, col }) => out.push({ ...sp, col, cols: n })); cluster = []; colEnds = []; clusterEnd = -1; };
  for (const sp of spans) {
    if (sp.start >= clusterEnd && cluster.length) flush();
    let col = colEnds.findIndex((e) => e <= sp.start);
    if (col === -1) { colEnds.push(sp.end); col = colEnds.length - 1; } else colEnds[col] = sp.end;
    cluster.push({ sp, col });
    clusterEnd = Math.max(clusterEnd, sp.end);
  }
  flush();
  return out;
}
