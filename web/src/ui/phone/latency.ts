// TEMPORARY: press latency logging (pointerdown -> next paint, click -> next paint). Remove before commit.
const after = (t0: number, label: string) => requestAnimationFrame(() => setTimeout(() => console.log(`[LAT] ${label} ${(performance.now() - t0).toFixed(1)}`), 0));
let upAt = 0;
export function startLatencyLog() {
  document.addEventListener("pointerdown", (e) => after(e.timeStamp, "down"), { capture: true, passive: true });
  document.addEventListener("pointerup", (e) => { upAt = e.timeStamp; }, { capture: true, passive: true });
  window.addEventListener("click", (e) => { console.log(`[LAT] up->click ${(e.timeStamp - upAt).toFixed(1)}`); after(e.timeStamp, "click"); }, { capture: true, passive: true });
}
