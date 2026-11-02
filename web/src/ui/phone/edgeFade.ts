// One look for every row that scrolls sideways (232): instead of a chip cut mid-word at the screen's edge, the row
// fades over its last 24 px while there's more to the right, and over its first 24 px once it's been scrolled.
// The fade itself is CSS (.p-hfade in phone.css, a mask); this only says which ends have more, as classes.
import { useEffect, useRef } from "react";

/** Which ends of a sideways-scrolling row hide something (a pixel of slack for rounding). */
export function fadeEnds(scrollLeft: number, clientWidth: number, scrollWidth: number): { left: boolean; right: boolean } {
  return { left: scrollLeft > 1, right: scrollLeft + clientWidth < scrollWidth - 1 };
}

/** Keeps [el]'s fade-l / fade-r classes in step with its scroll, its size and its chips; returns the cleanup. */
export function watchEdgeFade(el: HTMLElement): () => void {
  el.classList.add("p-hfade");
  let raf = 0;
  const set = () => {
    raf = 0;
    const f = fadeEnds(el.scrollLeft, el.clientWidth, el.scrollWidth);
    el.classList.toggle("fade-l", f.left);
    el.classList.toggle("fade-r", f.right);
  };
  const later = () => { if (!raf) raf = requestAnimationFrame(set); };
  set();
  el.addEventListener("scroll", later, { passive: true });
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(later) : null;
  ro?.observe(el);
  // Chips come and go, and their counts change width.
  const mo = typeof MutationObserver === "function" ? new MutationObserver(later) : null;
  mo?.observe(el, { childList: true, subtree: true, characterData: true });
  return () => { cancelAnimationFrame(raf); el.removeEventListener("scroll", later); ro?.disconnect(); mo?.disconnect(); };
}

/** The ref for a row that scrolls sideways, faded at its ends. */
export function useEdgeFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => (ref.current ? watchEdgeFade(ref.current) : undefined), []);
  return ref;
}
