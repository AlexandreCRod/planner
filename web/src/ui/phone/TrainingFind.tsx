// Training's search: sessions, exercises and the words in the plan's documents, in one list, with chips
// to narrow it. A session opens its page, an exercise its guide, a line of a document the document at
// that place. The query and the chip come back with Back from a hit.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "../../domain/dates.ts";
import { findMatches } from "../../domain/find.ts";
import { dayOfSession, entryId, lastLift, sessionsOf } from "../../domain/training.ts";
import { findInTraining } from "../../domain/trainingFind.ts";
import type { LoadedPlan, Training } from "../../store/training.ts";
import { go } from "../shared/common.tsx";
import { ChipRow, EmptyHint, FilterChip, IconButton, MIcon, SectionHeader, TopAppBar } from "./chrome.tsx";
import { useKeep, useKeptScroll, useKeptState } from "./keep.ts";
import { ListItem } from "./m3.tsx";
import { docRoute } from "./TrainingDocs.tsx";
import { GuideSheet } from "./TrainingGuide.tsx";
import { fmtKg, kindIcon, planQ, sessionIcon } from "./trainingParts.tsx";

type Only = "all" | "sessions" | "exercises" | "guides";
const CHIPS: [Only, string][] = [["all", "All"], ["sessions", "Sessions"], ["exercises", "Exercises"], ["guides", "Guides"]];

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

export function TrainingFind({ tr, lp, planId }: { tr: Training; lp: LoadedPlan; planId: string | null }) {
  const { plan } = lp;
  const k = useKeep();
  const [q, setQ] = useKeptState(k, "q", "");
  const [only, setOnly] = useKeptState<Only>(k, "only", "all");
  const [guide, setGuide] = useState<{ id: string; name: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useKeptScroll(k, "scroll", () => list.current);
  useEffect(() => { if (!k.back) input.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const hits = useMemo(() => findInTraining(plan, lp.docs, q), [plan, lp.docs, q]);
  const sessions = useMemo(() => new Map(sessionsOf(plan).map((s) => [s.id, s])), [plan]);
  const shown = (o: Only) => only === "all" || only === o;
  const count = hits.sessions.length + hits.exercises.length + hits.guides.length;
  const t = q.trim();

  const lastText = (id: string) => {
    const l = lastLift(tr.lifts, id, { day: Number.MAX_SAFE_INTEGER, id: "" });
    if (!l) return "Not logged yet";
    const done = l.sets.filter((s) => s.done);
    const top = done.reduce((a, s) => ((s.kg ?? 0) > (a.kg ?? 0) ? s : a), done[0]);
    return `Last: ${top.kg !== null ? `${fmtKg(top.kg)} kg × ` : "× "}${top.reps ?? "?"} · ${formatDate(l.day)}`;
  };

  return (
    <div className="p-scaffold tr-find">
      <TopAppBar back className="search" title={
        <div className="p-searchfield">
          <MIcon name="oSearch" />
          <input ref={input} placeholder="Search training" value={q} enterKeyHint="search" onChange={(e) => setQ(e.target.value)} />
          {q && <IconButton icon="fClose" label="Clear" onClick={() => { setQ(""); input.current?.focus(); }} />}
        </div>
      } />
      <div className="p-content flush" ref={list}>
        {t && (
          <ChipRow className="search">
            {CHIPS.map(([o, l]) => <FilterChip key={o} selected={only === o} onClick={() => setOnly(o)}>{l}</FilterChip>)}
          </ChipRow>
        )}
        {!t && <EmptyHint>Find a session, an exercise or words in the guides.</EmptyHint>}
        {t && count === 0 && <EmptyHint>Nothing for “{t}”.</EmptyHint>}
        {shown("sessions") && hits.sessions.length > 0 && <>
          <SectionHeader>Sessions</SectionHeader>
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
        {shown("exercises") && hits.exercises.length > 0 && <>
          <SectionHeader>Exercises</SectionHeader>
          {hits.exercises.map((h) => (
            <ListItem key={h.id} className="tr-findrow" leading={<span className="tr-findic"><MIcon name={kindIcon("gym")} size={20} /></span>}
              headline={<Marked text={h.name} q={t} />} supporting={lastText(h.id)}
              onClick={() => setGuide({ id: h.id, name: h.name })} />
          ))}
        </>}
        {shown("guides") && hits.guides.length > 0 && <>
          <SectionHeader>In the guides</SectionHeader>
          {hits.guides.map((h, i) => (
            <ListItem key={`${h.file}#${h.anchor}#${i}`} className="tr-findrow" leading={<span className="tr-findic"><MIcon name="oDescription" size={20} /></span>}
              headline={<>{h.doc}{h.heading !== h.doc && <> · <Marked text={h.heading} q={t} /></>}</>}
              supporting={h.text ? <Marked text={h.text} q={t} /> : undefined}
              onClick={() => go(docRoute(h.file, h.anchor, planId))} />
          ))}
        </>}
        <div className="p-endspace" />
      </div>
      {guide && <GuideSheet tr={tr} lp={lp} id={guide.id} onClose={() => setGuide(null)} />}
    </div>
  );
}
