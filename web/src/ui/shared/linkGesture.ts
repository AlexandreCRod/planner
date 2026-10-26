// What touch, mouse and keyboard do on a web link inside text you can edit: a tap opens it (the text
// around it stays editable), a long press (or a right-click) shows its card, Ctrl+Enter opens it from
// the keyboard and Alt+Enter shows the card. [hit] finds the link under a point, [caret] the one at the
// caret. Returns the handlers to spread onto the editable element.
import type React from "react";
import { useRef } from "react";
import type { WebLink } from "../../domain/links.ts";
import { LONG_PRESS, TOUCH_SLOP } from "../phone/press.ts";

export interface LinkActions { open: (url: string) => void; card: (url: string) => void }

const no = () => false;
const NONE = {
  onPointerDown: undefined, onPointerMove: undefined, onPointerUp: undefined, onPointerCancel: undefined, onContextMenu: undefined,
  onLinkClick: no as (e: React.MouseEvent) => boolean, onLinkKey: no as (e: React.KeyboardEvent) => boolean,
};

export function useLinkGesture(
  hit: (x: number, y: number) => WebLink | null, caret: () => WebLink | null, act: LinkActions | undefined,
) {
  const st = useRef<{ timer: number; x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => { if (st.current) clearTimeout(st.current.timer); st.current = null; };
  if (!act) return NONE;
  return {
    onPointerDown: (e: React.PointerEvent) => {
      clear();
      fired.current = false;
      if (e.button !== 0 || !hit(e.clientX, e.clientY)) return;
      const h = { timer: 0, x: e.clientX, y: e.clientY };
      h.timer = window.setTimeout(() => {
        st.current = null;
        const l = hit(h.x, h.y);
        if (l) { fired.current = true; act.card(l.url); }
      }, LONG_PRESS);
      st.current = h;
    },
    onPointerMove: (e: React.PointerEvent) => { const h = st.current; if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > TOUCH_SLOP) clear(); },
    onPointerUp: clear,
    onPointerCancel: clear,
    /** True when the click was a link's (opened, or the end of a long press): the caller then does nothing else. */
    onLinkClick: (e: React.MouseEvent): boolean => {
      if (fired.current) { fired.current = false; e.preventDefault(); return true; }
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return false;
      const sel = getSelection();
      if (sel && !sel.isCollapsed) return false;
      const l = hit(e.clientX, e.clientY);
      if (!l) return false;
      e.preventDefault();
      act.open(l.url);
      return true;
    },
    onContextMenu: (e: React.MouseEvent) => {
      const l = e.clientX || e.clientY ? hit(e.clientX, e.clientY) : caret();
      if (!l) return;
      e.preventDefault();
      clear();
      fired.current = false;
      act.card(l.url);
    },
    /** Returns true when the key was a link's. */
    onLinkKey: (e: React.KeyboardEvent): boolean => {
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey || e.altKey)) return false;
      const l = caret();
      if (!l) return false;
      e.preventDefault();
      if (e.altKey) act.card(l.url); else act.open(l.url);
      return true;
    },
  };
}
