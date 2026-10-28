// An exercise's guide in a sheet that stops halfway (picked 2026-10-28, "Guides B"): its name, History,
// Watch (the guide's video link, a YouTube search), then the key cues, with the session still in view
// above. Swiped up (or "Swipe up" tapped) it shows the whole card, the plan's swaps for it and a way into
// the guide itself; swiped down from there it goes back to half. In a wide window it's the whole card at once.
import { useEffect, useMemo, useRef, useState } from "react";
import { sectionAt } from "../../domain/markdown.ts";
import type { Swap } from "../../domain/training.ts";
import { guideParts } from "../../domain/trainingFind.ts";
import { isWide } from "../../platform.ts";
import type { LoadedPlan, Training } from "../../store/training.ts";
import { go } from "../shared/common.tsx";
import { MIcon } from "./chrome.tsx";
import { BottomSheet, TextButton } from "./m3.tsx";
import { openExternal } from "./native.ts";
import { MarkdownView, docRoute } from "./TrainingDocs.tsx";
import { allExercises, planQ } from "./trainingParts.tsx";

export function GuideSheet({ tr, lp, id, planned, swaps = [], onSwap, onClose }: {
  tr: Training; lp: LoadedPlan;
  /** The exercise being done (after a swap, the swapped one). */
  id: string;
  /** In a session: the exercise the plan has there, and its swaps; [onSwap] swaps to one. */
  planned?: string; swaps?: Swap[]; onSwap?: (to: string) => void;
  onClose: () => void;
}) {
  const exs = useMemo(() => allExercises(tr), [tr]);
  const ex = exs.get(id);
  const name = ex?.name ?? id;
  const card = ex?.card && lp.docs.has(ex.card.doc) ? ex.card : null;
  const parts = useMemo(() => {
    const md = card ? lp.docs.get(card.doc)! : null;
    const section = md && card ? (card.anchor ? sectionAt(md, card.anchor) : md) : null;
    return section ? guideParts(section) : null;
  }, [card, lp.docs]);
  const docTitle = card ? lp.plan.documents.find((d) => d.file === card.doc)?.title ?? card.doc : null;
  const [full, setFull] = useState(isWide);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { body.current?.scrollTo?.({ top: 0 }); }, [id]);
  /** The other ways to do this one: back to the plan's after a swap, else the plan's swaps. */
  const options = planned === undefined ? [] : [
    ...(planned !== id ? [{ exercise: planned, when: "As planned" }] : []),
    ...swaps.filter((w) => w.exercise !== id),
  ];
  const later = (close: () => void, route: string) => { close(); window.setTimeout(() => go(route), 210); };

  return (
    <BottomSheet className={`tr-guide ${full ? "full" : "half"}`} onClose={onClose}
      onPullUp={full ? undefined : () => setFull(true)}
      onPullDown={() => { if (!full || isWide()) return false; setFull(false); return true; }}>{(close) => (
      <>
        <div className={`tr-guide-body ${full ? "" : "p-sheet-drag"}`} ref={body}>
          <div className="tr-guide-head p-sheet-drag">
            <div className="grow">
              <div className="t">{name}</div>
              <div className="s">{docTitle ?? "No guide for this one yet"}</div>
            </div>
            <TextButton onClick={() => later(close, `training?view=ex&x=${encodeURIComponent(id)}${planQ(lp.plan.id)}`)}><MIcon name="oHistory" size={18} />History</TextButton>
          </div>
          {parts?.video && (
            <button className="tr-watch" onClick={() => openExternal(parts.video!.url)}>
              <span className="tile"><MIcon name="fPlayArrow" size={24} /></span>
              <span className="wt"><b>Watch</b><span>{parts.video.query ? `YouTube search: “${parts.video.query}”` : "Opens the video"}</span></span>
              <MIcon name="oOpenInNew" size={20} />
            </button>
          )}
          {parts?.body && <>
            <div className="tr-guide-label">Key cues</div>
            <div className="tr-guide-md">
              <MarkdownView md={parts.body} onDocLink={(f, a) => later(close, docRoute(f ?? card!.doc, a, lp.plan.id))} />
            </div>
          </>}
          {options.length > 0 && <>
            <div className="tr-guide-label">{planned !== id ? "Swapped" : "Swap if needed"}</div>
            {options.map((w) => (
              <button key={w.exercise} className="tr-guide-swap" disabled={!onSwap} onClick={() => onSwap?.(w.exercise)}>
                <MIcon name="fSwapHoriz" size={18} />
                <span><b>{exs.get(w.exercise)?.name ?? w.exercise}</b>{w.when ? ` ${w.when.replace(/^./, (c) => c.toLowerCase())}` : ""}</span>
              </button>
            ))}
          </>}
          {card && (
            <button className="tr-guide-open" onClick={() => later(close, docRoute(card.doc, card.anchor || null, lp.plan.id))}>
              <MIcon name="oMenuBook" size={20} /><span>Open in {/guide$/i.test(docTitle ?? "") ? "the " : ""}{docTitle}</span><MIcon name="fKeyboardArrowRight" size={20} />
            </button>
          )}
        </div>
        {!full && (
          <button className="tr-guide-more p-sheet-drag" onClick={() => setFull(true)}>
            <MIcon name="fExpandLess" size={18} />Swipe up for the whole guide
          </button>
        )}
      </>
    )}</BottomSheet>
  );
}
