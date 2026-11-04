// The training plan's hits in the main search (343, one search button; Training's own search page went): sessions,
// exercises and the words in the plan's documents. The main search's Training chip narrows to them, and it starts
// on that chip when opened from Training.
import { type ReactNode, useMemo, useState } from "react";
import { formatDate } from "../../domain/dates.ts";
import { findMatches } from "../../domain/find.ts";
import { dayOfSession, entryId, lastLift, sessionsOf } from "../../domain/training.ts";
import { type TrainingHits, findInTraining } from "../../domain/trainingFind.ts";
import type { LoadedPlan, Training } from "../../store/training.ts";
import { go } from "../shared/common.tsx";
import { MIcon, SectionHeader } from "./chrome.tsx";
import { ListItem } from "./m3.tsx";
import { docRoute } from "./TrainingDocs.tsx";
import { GuideSheet } from "./TrainingGuide.tsx";
import { fmtKg, kindIcon, planQ, sessionIcon } from "./trainingParts.tsx";

/** [text] with what [q] finds in it marked. */
export function Marked({ text, q }: { text: string; q: string }) {
  const ms = findMatches(text, q);
  if (!ms.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  ms.forEach(([a, b], i) => { out.push(text.slice(at, a), <mark key={i} className="tr-hit">{text.slice(a, b)}</mark>); at = b; });
  out.push(text.slice(at));
  return <>{out}</>;
}

/** How many hits the training plan has for [q] (Search's Training chip). */
export function useTrainingHits(lp: LoadedPlan | null, q: string) {
  return useMemo(() => (lp && q.trim() ? findInTraining(lp.plan, lp.docs, q) : null), [lp, q]);
}
export const hitCount = (h: TrainingHits | null) => (h ? h.sessions.length + h.exercises.length + h.guides.length : 0);

/**
 * The training plan's hits in the main search (343: Training's own search folded into it): sessions,
 * exercises and lines of the documents, each group under its heading. A session opens its page, an exercise
 * its guide, a line the document at that place.
 */
export function TrainingResults({ tr, lp, hits, q }: { tr: Training; lp: LoadedPlan; hits: TrainingHits; q: string }) {
  const { plan } = lp;
  const [guide, setGuide] = useState<{ id: string; name: string } | null>(null);
  const sessions = useMemo(() => new Map(sessionsOf(plan).map((s) => [s.id, s])), [plan]);
  const t = q.trim();
  const planId = null;

  const lastText = (id: string) => {
    const l = lastLift(tr.lifts, id, { day: Number.MAX_SAFE_INTEGER, id: "" });
    if (!l) return "Not logged yet";
    const done = l.sets.filter((s) => s.done);
    const top = done.reduce((a, s) => ((s.kg ?? 0) > (a.kg ?? 0) ? s : a), done[0]);
    return `Last: ${top.kg !== null ? `${fmtKg(top.kg)} kg × ` : "× "}${top.reps ?? "?"} · ${formatDate(l.day)}`;
  };

  return <>
    {hits.sessions.length > 0 && <>
      <SectionHeader>Training sessions</SectionHeader>
      {hits.sessions.map((h) => {
        const s = sessions.get(h.id);
        const day = s ? dayOfSession(s, tr.entries.get(entryId(plan.id, s.id))) : null;
        const what = h.matched.length ? h.matched.join(", ") : s?.detail ?? "";
        return (
          <ListItem key={h.id} className="tr-findrow" leading={<span className="tr-findic"><MIcon name={s ? sessionIcon(s) : kindIcon("other")} size={20} /></span>}
            headline={<Marked text={h.title} q={t} />}
            supporting={<>{day !== null ? formatDate(day) : plan.phases[h.phase]?.name ?? ""}{what ? " · " : ""}<Marked text={what} q={t} /></>}
            onClick={() => go(`training?s=${encodeURIComponent(h.id)}${planQ(planId)}`)} />
        );
      })}
    </>}
    {hits.exercises.length > 0 && <>
      <SectionHeader>Exercises</SectionHeader>
      {hits.exercises.map((h) => (
        <ListItem key={h.id} className="tr-findrow" leading={<span className="tr-findic"><MIcon name={kindIcon("gym")} size={20} /></span>}
          headline={<Marked text={h.name} q={t} />} supporting={lastText(h.id)}
          onClick={() => setGuide({ id: h.id, name: h.name })} />
      ))}
    </>}
    {hits.guides.length > 0 && <>
      <SectionHeader>In the training guides</SectionHeader>
      {hits.guides.map((h, i) => (
        <ListItem key={`${h.file}#${h.anchor}#${i}`} className="tr-findrow" leading={<span className="tr-findic"><MIcon name="oDescription" size={20} /></span>}
          headline={<>{h.doc}{h.heading !== h.doc && <> · <Marked text={h.heading} q={t} /></>}</>}
          supporting={h.text ? <Marked text={h.text} q={t} /> : undefined}
          onClick={() => go(docRoute(h.file, h.anchor, planId))} />
      ))}
    </>}
    {guide && <GuideSheet tr={tr} lp={lp} id={guide.id} onClose={() => setGuide(null)} />}
  </>;
}
