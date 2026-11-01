// A long press on one element, for those that do something of their own with it.
import { useEffect, useRef } from "react";
import { mouseMenu } from "./desk.ts";
import { feel } from "./haptics.ts";
import { LONG_PRESS, TOUCH_SLOP } from "./press.ts";

/** A long press (the finger kept within the touch slop): a pick-up pulse, then [onLong]; the tap after it is dropped. */
export function useHold(onLong?: () => void) {
  const st = useRef<{ timer: number; x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  const clear = () => { if (st.current) clearTimeout(st.current.timer); st.current = null; };
  useEffect(() => clear, []);
  const fired = () => { const f = firedRef.current; firedRef.current = false; return f; };
  if (!onLong) return { fired };
  return {
    fired,
    onPointerDown: (e: React.PointerEvent) => {
      clear();
      firedRef.current = false;
      const h = { timer: 0, x: e.clientX, y: e.clientY };
      h.timer = window.setTimeout(() => { firedRef.current = true; st.current = null; feel("pickup"); onLong(); }, LONG_PRESS);
      st.current = h;
    },
    onPointerMove: (e: React.PointerEvent) => { const h = st.current; if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > TOUCH_SLOP) clear(); },
    onPointerUp: clear,
    onPointerCancel: clear,
    // A right-click is the mouse's long press.
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); if (mouseMenu(e)) { clear(); onLong(); } },
  };
}
