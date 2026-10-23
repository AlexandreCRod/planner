// Find in a note: a bar under the note's top bar with the words to find, how many there are, previous
// and next. Every match is highlighted (the browser's highlight API: the note's text itself is never
// touched), the current one more strongly, and it's scrolled into view. A note opened from Search
// opens with the bar already showing the search's words, on the first match.
import { useEffect, useRef, useState } from "react";
import { findMatches, stepMatch } from "../../domain/find.ts";
import { IconButton, MIcon } from "./chrome.tsx";
import { pushBack } from "./native.ts";

let pending: string | null = null;
/** The next note opened shows these words found (Search, opening a note it found). */
export function findInNextNote(q: string) { pending = q.trim() || null; }
/** Taken once, by the note being opened. */
export function takePendingFind(): string | null {
  const q = pending;
  if (q !== null) window.setTimeout(() => { pending = null; }, 0);
  return q;
}

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
const registry = (): HighlightRegistry | null => (globalThis.CSS as unknown as { highlights?: HighlightRegistry })?.highlights ?? null;
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

/** The ranges of [q] in [root]'s text (lines kept apart, so a match never runs from one into the next). */
function rangesIn(root: HTMLElement, q: string): Range[] {
  const nodes: { node: Text; at: number }[] = [];
  let text = "", lastBlock: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const block = n.parentElement?.closest("p,li,h1,h2,h3,h4,h5,h6,div") ?? null;
    if (text && block !== lastBlock) text += "\n";
    lastBlock = block;
    nodes.push({ node: n, at: text.length });
    text += n.data;
  }
  // A start falls in the node it begins; an end in the node it closes.
  const place = (i: number, end: boolean): [Text, number] | null => {
    for (const { node, at } of nodes) {
      if (end ? i > at && i <= at + node.length : i >= at && i < at + node.length) return [node, i - at];
    }
    return null;
  };
  const out: Range[] = [];
  for (const [s, e] of findMatches(text, q)) {
    const a = place(s, false), b = place(e, true);
    if (!a || !b) continue;
    const r = document.createRange();
    r.setStart(a[0], a[1]);
    r.setEnd(b[0], b[1]);
    out.push(r);
  }
  return out;
}

export function NoteFind({ editor, scroller, initial, focus, onClose }: {
  editor: () => HTMLElement | null; scroller: () => HTMLElement | null; initial: string; focus: boolean; onClose: () => void;
}) {
  const [q, setQ] = useState(initial);
  const [ranges, setRanges] = useState<Range[]>([]);
  const [cur, setCur] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const first = useRef(true);

  useEffect(() => pushBack(onClose), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focus) input.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Found again as the words or the text change.
  useEffect(() => {
    const root = editor();
    if (!root) return;
    let t = 0;
    const run = () => {
      const rs = rangesIn(root, q);
      setRanges(rs);
      setCur((c) => (rs.length ? (first.current ? 0 : Math.min(Math.max(c, 0), rs.length - 1)) : -1));
    };
    run();
    const mo = new MutationObserver(() => { clearTimeout(t); t = window.setTimeout(run, 150); });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); clearTimeout(t); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drawn as highlights; the current one brought into view.
  useEffect(() => {
    const reg = registry();
    if (reg && HighlightCtor) {
      reg.set("pn-find", new HighlightCtor(...ranges.filter((_, i) => i !== cur)));
      reg.set("pn-find-cur", new HighlightCtor(...(cur >= 0 && ranges[cur] ? [ranges[cur]] : [])));
    }
    const r = cur >= 0 ? ranges[cur] : null;
    const sc = scroller();
    const box = r?.getBoundingClientRect();
    if (r && sc && box && box.height > 0) {
      const view = sc.getBoundingClientRect();
      const smooth = !first.current;
      first.current = false;
      if (box.top < view.top + 72 || box.bottom > view.bottom - 72) {
        sc.scrollTo({ top: sc.scrollTop + box.top - view.top - view.height / 3, behavior: smooth ? "smooth" : "auto" });
      }
    }
  }, [ranges, cur]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { registry()?.delete("pn-find"); registry()?.delete("pn-find-cur"); }, []);

  const go = (step: 1 | -1) => setCur((c) => stepMatch(ranges.length, c, step));
  return (
    <div className="pn-find" role="search">
      <MIcon name="oSearch" size={20} />
      <input ref={input} value={q} placeholder="Find in note" enterKeyHint="search" autoCapitalize="none"
        onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? -1 : 1); } }} />
      <span className="pn-find-count">{q.trim() ? (ranges.length ? `${cur + 1}/${ranges.length}` : "0") : ""}</span>
      <IconButton icon="fExpandLess" label="Previous" disabled={!ranges.length} onClick={() => go(-1)} />
      <IconButton icon="fExpandMore" label="Next" disabled={!ranges.length} onClick={() => go(1)} />
      <IconButton icon="fClose" label="Close find" onClick={onClose} />
    </div>
  );
}
