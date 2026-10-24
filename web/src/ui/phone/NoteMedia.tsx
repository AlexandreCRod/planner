// A note's pictures and videos on the phone: a row of previews that a sideways swipe glides through,
// one to the next; a tap opens one full screen; a long press opens the lens, a carousel: the one pressed
// shown big with the others as miniatures at its sides, and the finger, still down, runs along them
// (moving right brings the ones on the right to the middle). Everything in the
// lens moves by transforms written straight to the elements each frame (no React render while it moves).
// Any of them can be saved to the phone. Videos stay on the phone that added them (domain/media.ts).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { downloadName, isVideo, lensPlace, lensPosFor, lensStep, miniScale, previewHash } from "../../domain/media.ts";
import type { NoteImage } from "../../domain/types.ts";
import { getBlob, useImageUrl } from "../../store/images.ts";
import { Dialog, IconButton, MIcon } from "./chrome.tsx";
import { saveToPhone } from "./device.ts";
import { feel } from "./haptics.ts";
import { TextButton, showSnackbar } from "./m3.tsx";
import { GLIDE_SPRING, type Animation, VelocityTracker, animateSpring } from "./motion.ts";
import { pushBack } from "./native.ts";
import { TOUCH_SLOP, swallowClick } from "./press.ts";
import { deskPager, mouseMenu } from "./desk.ts";

const LONG_PRESS = 450;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const aspect = (m: NoteImage) => (m.width > 0 && m.height > 0 ? m.width / m.height : 1);

/** A video's own file when it's on this device (an object URL), else null. */
function useVideoUrl(m: NoteImage, want: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!want || !isVideo(m)) return;
    let alive = true, made: string | null = null;
    void getBlob(m.hash).then((b) => { if (b && alive) { made = URL.createObjectURL(b); setUrl(made); } });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); setUrl(null); };
  }, [m.hash, want]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

/** Saves one to the phone (the gallery in the app, a download in a browser). */
export async function downloadMedia(m: NoteImage) {
  const blob = await getBlob(m.hash);
  if (!blob) {
    showSnackbar(isVideo(m) ? "This video is only on the phone that added it" : "This picture hasn't arrived on this device yet");
    return;
  }
  try {
    await saveToPhone(blob, downloadName(m), blob.type || m.mime);
    feel("confirm");
    showSnackbar(isVideo(m) ? "Saved to Movies › Planner" : "Saved to Pictures › Planner");
  } catch (e) {
    showSnackbar(e instanceof Error && e.message ? e.message : "Couldn't save it to the phone");
  }
}

function Still({ m }: { m: NoteImage }) {
  const url = useImageUrl(previewHash(m));
  return url ? <img src={url} alt="" draggable={false} /> : <span className="pn-media-none"><MIcon name={isVideo(m) ? "oVideoLibrary" : "oImage"} /></span>;
}
function VideoMark({ m }: { m: NoteImage }) {
  if (!isVideo(m)) return null;
  const d = m.duration ? `${Math.floor(m.duration / 60)}:${String(Math.round(m.duration % 60)).padStart(2, "0")}` : "";
  return <span className="pn-media-video"><MIcon name="fPlayArrow" size={16} />{d}</span>;
}

/** The row of previews. A tap opens one ([onOpen]); a long press (or a right-click) opens the lens on it ([onLens]). */
export function MediaStrip({ media, onOpen, onLens }: {
  media: NoteImage[]; onOpen: (i: number) => void; onLens: (i: number, pointer: { id: number; x: number } | null) => void;
}) {
  const press = useRef<{ id: number; x: number; y: number; i: number; timer: number } | null>(null);
  const cancel = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };
  useEffect(() => cancel, []);
  return (
    <div className="pn-media" onPointerMove={(e) => {
      const p = press.current;
      if (p && e.pointerId === p.id && Math.hypot(e.clientX - p.x, e.clientY - p.y) > TOUCH_SLOP) cancel();
    }} onPointerUp={cancel} onPointerCancel={cancel}>
      {media.map((m, i) => (
        <button key={m.id} className="pn-media-item" style={{ aspectRatio: String(clamp(aspect(m), 0.6, 1.8)) }} aria-label={isVideo(m) ? "Open video" : "Open picture"}
          onContextMenu={(e) => { e.preventDefault(); if (mouseMenu(e)) { cancel(); onLens(i, null); } }}
          onPointerDown={(e) => {
            if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
            cancel();
            const p = { id: e.pointerId, x: e.clientX, y: e.clientY, i, timer: 0 };
            p.timer = window.setTimeout(() => {
              if (press.current !== p) return;
              press.current = null;
              swallowClick(600);
              onLens(p.i, { id: p.id, x: p.x });
            }, LONG_PRESS);
            press.current = p;
          }}
          onClick={() => onOpen(i)}>
          <Still m={m} />
          <VideoMark m={m} />
        </button>
      ))}
    </div>
  );
}

/**
 * The lens. [pointer]: the finger that opened it, still down, which runs along the row; after that,
 * swipes do. Either way the finger moving right brings the ones on the right to the middle, one per
 * miniature's width; a tap on the big one opens it full screen, a tap on a miniature brings it to the
 * middle, and a tap beside them closes the lens.
 */
export function MediaLens({ media, start, pointer, onClose, onOpen }: {
  media: NoteImage[]; start: number; pointer: { id: number; x: number } | null; onClose: () => void; onOpen: (i: number) => void;
}) {
  const n = media.length;
  const root = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const pos = useRef(start);
  const [cur, setCur] = useState(start);
  const curRef = useRef(start);
  const anim = useRef<Animation | null>(null);
  const raf = useRef(0);
  const closing = useRef(false);
  // The big one leaves room at the sides for the previous and next ones, small but in sight.
  const W = Math.min(window.innerWidth * 0.6, 420);
  const H = window.innerHeight * 0.5;
  const sizeOf = (m: NoteImage) => { const a = aspect(m); return a >= W / H ? { w: W, h: W / a } : { w: H * a, h: H }; };

  const draw = (p: number) => {
    pos.current = p;
    els.current.forEach((el, i) => {
      if (!el) return;
      const { w, h } = sizeOf(media[i]);
      const { x, scale, opacity } = lensPlace(i - p, W, miniScale(w, h));
      el.style.transform = `translate3d(${x}px,0,0) scale(${scale})`;
      el.style.opacity = String(opacity);
      el.style.zIndex = String(100 - Math.round(Math.abs(i - p) * 10));
    });
    const r = clamp(Math.round(p), 0, n - 1);
    if (r !== curRef.current) { curRef.current = r; setCur(r); feel("tick"); }
  };
  const settle = (to: number, v = 0) => {
    anim.current?.stop();
    anim.current = animateSpring(pos.current, to, v, draw, () => { anim.current = null; draw(to); }, GLIDE_SPRING);
  };
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    anim.current?.stop();
    root.current?.classList.add("out");
    window.setTimeout(onClose, 160);
  };

  useLayoutEffect(() => { draw(start); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => pushBack(close), []); // eslint-disable-line react-hooks/exhaustive-deps

  // One finger at a time moves the row: the finger to the right brings the next one in.
  useEffect(() => {
    const step = lensStep();
    let g: { id: number; x0: number; y0: number; p0: number; moved: boolean; vt: VelocityTracker; x: number } | null = null;
    const begin = (id: number, x: number, y: number, moved: boolean) => {
      anim.current?.stop(); anim.current = null;
      g = { id, x0: x, y0: y, p0: pos.current, moved, vt: new VelocityTracker(), x };
      g.vt.add(performance.now(), x);
    };
    if (pointer) begin(pointer.id, pointer.x, 0, true);
    /** Where the row is for the finger now. Past either end it gives a little, then stops. */
    const placeFor = (d: NonNullable<typeof g>) => {
      const raw = lensPosFor(d.p0, d.x - d.x0);
      return raw < 0 ? -0.3 * (1 - Math.exp(raw / 0.6)) : raw > n - 1 ? n - 1 + 0.3 * (1 - Math.exp(-(raw - n + 1) / 0.6)) : raw;
    };
    const frame = () => {
      raf.current = 0;
      if (g) draw(placeFor(g));
    };
    const onDown = (e: PointerEvent) => {
      if (g || closing.current || !e.isPrimary || (e.target as HTMLElement).closest("button")) return;
      begin(e.pointerId, e.clientX, e.clientY, false);
    };
    const onMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      g.vt.addEvent(e, "x");
      g.x = e.clientX;
      if (!g.moved && Math.abs(e.clientX - g.x0) > TOUCH_SLOP) { g.moved = true; g.x0 += Math.sign(e.clientX - g.x0) * TOUCH_SLOP; }
      if (g.moved && !raf.current) raf.current = requestAnimationFrame(frame);
    };
    const onUp = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const d = g;
      g = null;
      cancelAnimationFrame(raf.current); raf.current = 0;
      if (d.moved) {
        draw(placeFor(d));
        const v = d.vt.velocity(e.timeStamp) / step; // items per ms: the finger to the right goes on
        const to = clamp(Math.round(pos.current + v * 140), 0, n - 1);
        settle(to, v);
        return;
      }
      if (e.type !== "pointerup") { settle(clamp(Math.round(pos.current), 0, n - 1)); return; }
      // A tap: on the big one opens it, on a small one brings it to the middle, beside them closes.
      const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-lens]");
      const i = hit ? Number(hit.dataset.lens) : -1;
      if (i < 0) close();
      else if (i === curRef.current) onOpen(i);
      else settle(i);
    };
    const noScroll = (e: TouchEvent) => { if (g && e.cancelable) e.preventDefault(); };
    const el = root.current!;
    // ← → and a sideways trackpad swipe bring the next or previous one to the middle.
    const undoDesk = deskPager(el, (dir) => { if (!g && !closing.current) settle(clamp(curRef.current + dir, 0, n - 1)); });
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.addEventListener("touchmove", noScroll, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.removeEventListener("touchmove", noScroll);
      cancelAnimationFrame(raf.current);
      anim.current?.stop();
      undoDesk();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const m = media[cur];
  return (
    <div ref={root} className="pn-lens" onContextMenu={(e) => e.preventDefault()}>
      <div className="pn-lens-row">
        {media.map((x, i) => {
          const { w, h } = sizeOf(x);
          return (
            <div key={x.id} ref={(el) => { els.current[i] = el; }} data-lens={i} className="pn-lens-item"
              style={{ width: w, height: h, marginLeft: -w / 2, marginTop: -h / 2 }}>
              <Still m={x} />
              {isVideo(x) && <LensVideo m={x} active={i === cur} />}
              {isVideo(x) && i !== cur && <VideoMark m={x} />}
            </div>
          );
        })}
      </div>
      <div className="pn-lens-bar">
        <span className="pn-lens-count">{cur + 1} / {n}{m && isVideo(m) ? " · video" : ""}{m && isVideo(m) && m.phoneOnly ? " on the phone" : ""}</span>
        <IconButton icon="fDownload" label="Save to the phone" onClick={() => m && void downloadMedia(m)} />
        <IconButton icon="fClose" label="Close" onClick={close} />
      </div>
    </div>
  );
}

/** The video in the middle of the lens plays (silently, over and over) when it's on this device. */
function LensVideo({ m, active }: { m: NoteImage; active: boolean }) {
  const url = useVideoUrl(m, active);
  return url && active ? <video className="pn-lens-video" src={url} autoPlay muted loop playsInline /> : null;
}

/** One full screen: a picture, or a video with its controls; save to the phone, and remove (asked first). */
export function MediaViewer({ m, onClose, onRemove }: { m: NoteImage; onClose: () => void; onRemove: () => void }) {
  const still = useImageUrl(previewHash(m));
  const video = useVideoUrl(m, true);
  const [ask, setAsk] = useState(false);
  useEffect(() => pushBack(onClose), []); // eslint-disable-line react-hooks/exhaustive-deps
  const what = isVideo(m) ? "video" : "picture";
  return (
    <div className="pn-picture" onClick={onClose}>
      <div className="pn-picture-bar" onClick={(e) => e.stopPropagation()}>
        <IconButton icon="fClose" label="Close" onClick={onClose} />
        <span className="grow" />
        <IconButton icon="fDownload" label={`Save ${what} to the phone`} onClick={() => void downloadMedia(m)} />
        <IconButton icon="oDelete" label={`Remove ${what}`} onClick={() => setAsk(true)} />
      </div>
      {video
        ? <video src={video} poster={still ?? undefined} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
        : still && <img src={still} alt="" onClick={(e) => e.stopPropagation()} />}
      {isVideo(m) && !video && <div className="pn-picture-note">This video is on the phone that added it.</div>}
      {ask && (
        <Dialog title={`Remove ${what}?`} onClose={() => setAsk(false)} actions={<>
          <TextButton onClick={() => setAsk(false)}>Cancel</TextButton>
          <TextButton onClick={onRemove}>Remove</TextButton>
        </>}>It's removed from this note on all your devices.</Dialog>
      )}
    </div>
  );
}
