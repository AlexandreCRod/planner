/** How long a ghost stays at most when the new page's slide-in never reports its end (no animation, a busy phone). */
export const GHOST_FALLBACK_MS = 400;

const isPage = (c: Element) => c.classList.contains("p-overlay") && !c.classList.contains("p-ghost") && !c.classList.contains("p-notelayer");
/** Every still copy left in [parent] goes. */
const clearGhosts = (parent: Element) => [...parent.children].filter((c) => c.classList.contains("p-ghost")).forEach((c) => c.remove());

/**
 * The page being replaced, as a still, inert copy just under the overlays, kept until the new page's slide-in
 * is over: taken down on that page's own animationend (review of 2.10.2, finding 7: a fixed 260 ms from the
 * commit could end before a slow page's first frame), with GHOST_FALLBACK_MS as a safety. Gone at once when no
 * page follows (closing to a tab stays instant), and so are any copies still waiting. Scroll positions are kept.
 */
export function leaveGhost(page: HTMLElement) {
  const parent = page.parentElement;
  if (!parent) return;
  const ghost = page.cloneNode(true) as HTMLElement;
  ghost.classList.add("p-ghost");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  const from = [page, ...page.querySelectorAll<HTMLElement>("*")];
  const to = [ghost, ...ghost.querySelectorAll<HTMLElement>("*")];
  const scrolled = from.map((n, i) => [i, n.scrollTop, n.scrollLeft] as const).filter(([, t, l]) => t || l);
  parent.appendChild(ghost);
  for (const [i, t, l] of scrolled) { to[i].scrollTop = t; to[i].scrollLeft = l; }
  queueMicrotask(() => {
    // Still in the page: not really leaving (React's dev-mode double mount).
    const next = page.isConnected ? undefined : [...parent.children].find((c) => c !== ghost && isPage(c));
    if (!next) { if (page.isConnected) ghost.remove(); else clearGhosts(parent); return; }
    let timer = 0;
    const done = (e?: Event) => {
      if (e && e.target !== next) return;   // a child's own animation
      next.removeEventListener("animationend", done);
      next.removeEventListener("animationcancel", done);
      clearTimeout(timer);
      ghost.remove();
    };
    next.addEventListener("animationend", done);
    next.addEventListener("animationcancel", done);
    timer = setTimeout(done, GHOST_FALLBACK_MS) as unknown as number;
  });
}
