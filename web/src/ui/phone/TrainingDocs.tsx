// The plan's documents read in the app (in place of Markor) and an exercise's history (its Progress cards,
// then each time it was done).
// Documents are drawn from parsed blocks (domain/markdown.ts) as React elements, never as HTML. Links
// between them open the other document at its place; web links open in the browser.
import { type ReactNode, useLayoutEffect, useMemo, useRef } from "react";
import { formatDate } from "../../domain/dates.ts";
import { type Block, type Inline, parseDocLink, parseMarkdown } from "../../domain/markdown.ts";
import { type Lift, entryId } from "../../domain/training.ts";
import type { LoadedPlan, Training } from "../../store/training.ts";
import { go, replaceRoute } from "../shared/common.tsx";
import { ChipRow, EmptyHint, FilterChip, Scaffold, SectionHeader } from "./chrome.tsx";
import { ListItem } from "./m3.tsx";
import { openExternal } from "./native.ts";
import { allExercises, fmtKg, planQ } from "./trainingParts.tsx";
import { LiftCards } from "./TrainingProgress.tsx";

type OnLink = (href: string) => void;

function inlineNodes(xs: Inline[], onLink: OnLink): ReactNode[] {
  return xs.map((x, i) => {
    switch (x.t) {
      case "text": return x.text;
      case "strong": return <strong key={i}>{inlineNodes(x.children, onLink)}</strong>;
      case "em": return <em key={i}>{inlineNodes(x.children, onLink)}</em>;
      case "code": return <code key={i}>{x.text}</code>;
      case "br": return <br key={i} />;
      case "link": return (
        <a key={i} href={x.href} className={/^https?:/i.test(x.href) ? "web" : ""} onClick={(e) => { e.preventDefault(); onLink(x.href); }}>
          {inlineNodes(x.children, onLink)}
        </a>
      );
    }
  });
}

function blockNodes(bs: Block[], onLink: OnLink): ReactNode[] {
  return bs.map((b, i) => {
    switch (b.t) {
      case "heading": {
        const H = `h${Math.min(6, Math.max(1, b.level))}` as "h1";
        return <H key={i} data-anchor={b.id}>{inlineNodes(b.children, onLink)}</H>;
      }
      case "para": return <p key={i}>{inlineNodes(b.children, onLink)}</p>;
      case "list": {
        // A list item's first paragraph runs straight on from its marker.
        const items = b.items.map((it, k) => (
          <li key={k}>{it[0]?.t === "para" ? <>{inlineNodes(it[0].children, onLink)}{blockNodes(it.slice(1), onLink)}</> : blockNodes(it, onLink)}</li>
        ));
        return b.ordered ? <ol key={i} start={b.start}>{items}</ol> : <ul key={i}>{items}</ul>;
      }
      case "quote": return <blockquote key={i}>{blockNodes(b.blocks, onLink)}</blockquote>;
      case "code": return <pre key={i}><code>{b.text}</code></pre>;
      case "hr": return <hr key={i} />;
      case "table": return (
        <div key={i} className="tr-md-table"><table>
          <thead><tr>{b.head.map((c, k) => <th key={k}>{inlineNodes(c, onLink)}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inlineNodes(c, onLink)}</td>)}</tr>)}</tbody>
        </table></div>
      );
      case "details": return <details key={i}><summary>{inlineNodes(b.summary, onLink)}</summary>{blockNodes(b.blocks, onLink)}</details>;
      case "anchor": return <span key={i} className="tr-md-anchor" data-anchor={b.id} />;
    }
  });
}

/** A document (or a card cut from one), drawn. [onDocLink] gets links into the plan's documents. */
export function MarkdownView({ md, onDocLink }: { md: string; onDocLink: (file: string | null, anchor: string | null) => void }) {
  const blocks = useMemo(() => parseMarkdown(md), [md]);
  const onLink = (href: string) => {
    const d = parseDocLink(href);
    if (d) onDocLink(d.file, d.anchor);
    else if (/^(https?|mailto|tel):/i.test(href)) openExternal(href);
  };
  return <div className="tr-md">{blockNodes(blocks, onLink)}</div>;
}

/** The route to a document of the plan, at an anchor. */
export const docRoute = (file: string, anchor: string | null, planId: string | null) =>
  `training?view=docs&doc=${encodeURIComponent(file)}${anchor ? `&a=${encodeURIComponent(anchor)}` : ""}${planQ(planId)}`;

/** Where each place read was scrolled to, so back from a followed link finds it where it was. */
const scrolled = new Map<string, number>();

/** Scrolls [box] to [anchor] (opening the <details> it's in) and briefly marks the heading there. */
function scrollToAnchor(box: HTMLElement, anchor: string): boolean {
  const target = box.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(anchor)}"]`);
  if (!target) return false;
  for (let d = target.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
  box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
  const head = /^H\d$/.test(target.tagName) ? target : target.nextElementSibling;
  if (head) { head.classList.remove("tr-flash"); void (head as HTMLElement).offsetWidth; head.classList.add("tr-flash"); }
  return true;
}

/** The documents, one at a time, with a row of chips to switch between them. */
export function TrainingDocs({ lp, file, anchor, planId }: { lp: LoadedPlan; file: string | null; anchor: string | null; planId: string | null }) {
  const docs = lp.plan.documents.filter((d) => lp.docs.has(d.file));
  const cur = file && lp.docs.has(file) ? file : docs[0]?.file ?? null;
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const kept = scrolled.get(location.hash);
    if (kept !== undefined) el.scrollTop = kept;
    else if (!anchor || !scrollToAnchor(el, anchor)) el.scrollTop = 0;
  }, [cur, anchor]);
  const remember = () => { if (box.current) scrolled.set(location.hash, box.current.scrollTop); };
  const follow = (f: string | null, a: string | null) => {
    const target = f && lp.docs.has(f) ? f : cur;
    if (!target) return;
    // The same place again (a link to where it already is) just scrolls there.
    if (target === cur && a === anchor && a && box.current) { scrollToAnchor(box.current, a); return; }
    remember();
    scrolled.delete(`#/${docRoute(target, a, planId)}`);
    go(docRoute(target, a, planId));
  };
  const title = docs.find((d) => d.file === cur)?.title ?? "Documents";
  return (
    <Scaffold title={title} back flush>
      {docs.length > 1 && (
        <ChipRow className="tr-docchips">
          {docs.map((d) => (
            <FilterChip key={d.file} selected={d.file === cur} onClick={() => { remember(); replaceRoute(docRoute(d.file, null, planId)); }}>{d.title}</FilterChip>
          ))}
        </ChipRow>
      )}
      <div className="p-content tr-doc" ref={box}>
        {cur ? <MarkdownView md={lp.docs.get(cur)!} onDocLink={follow} /> : <EmptyHint>This plan has no documents yet.</EmptyHint>}
      </div>
    </Scaffold>
  );
}

export { allExercises };

/** "60 × 5 · 60 × 5 · 62.5 × 5": the sets done. */
export function setsLine(l: Lift): string {
  return l.sets.filter((s) => s.done).map((s) => `${s.kg !== null ? `${fmtKg(s.kg)} × ` : "× "}${s.reps ?? "?"}`).join(" · ");
}

/** One exercise across every plan: its Progress cards (the chart and rep bests), then each time it was done, newest first. */
export function ExerciseHistory({ tr, lp, id, planId }: { tr: Training; lp: LoadedPlan; id: string; planId: string | null }) {
  const exs = allExercises(tr);
  const ex = exs.get(id);
  const lifts = tr.lifts.filter((l) => l.exercise === id && l.sets.some((s) => s.done)).sort((a, b) => b.day - a.day || b.updatedAt - a.updatedAt);
  const name = ex?.name ?? lifts[0]?.name ?? id;
  const card = ex?.card;
  return (
    <Scaffold title={name} back flush>
      <div className="p-content ps tr-page">
        {card && lp.docs.has(card.doc) && (
          <ListItem headline="How to do it" supporting={lp.plan.documents.find((d) => d.file === card.doc)?.title ?? card.doc}
            onClick={() => go(docRoute(card.doc, card.anchor || null, planId))} />
        )}
        <div className="pg-embed"><LiftCards tr={tr} lp={lp} id={id} /></div>
        <SectionHeader>History</SectionHeader>
        {lifts.length === 0 && <div className="tr-hint">Not logged yet.</div>}
        {lifts.map((l) => {
          const title = tr.entries.get(entryId(l.planId, l.sessionId))?.title;
          const extra = [title, l.rpe !== null ? `RPE ${l.rpe}` : "", l.pain ? `pain ${l.pain}/10` : "", l.planned !== l.exercise ? `in place of ${exs.get(l.planned)?.name ?? l.planned}` : ""];
          return <ListItem key={l.id} headline={`${formatDate(l.day)} · ${setsLine(l)}`} supporting={extra.filter(Boolean).join(" · ")} />;
        })}
        <div className="p-endspace" />
      </div>
    </Scaffold>
  );
}
