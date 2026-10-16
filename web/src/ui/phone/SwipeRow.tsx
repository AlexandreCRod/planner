// A list row that can be swiped away to the trash, either way (M3's swipe-to-dismiss): past the
// touch slop the row follows the finger over a red strip with a bin; let go past 40% of the width (or
// flung) it slides out, the gap closes and the item goes to the trash with an Undo snackbar. Less, and
// it springs back. Vertical scrolling and taps are untouched (see gesture.ts).
import { type ReactNode, createContext, useContext, useRef } from "react";
import type { Item } from "../../domain/types.ts";
import { MIcon } from "./chrome.tsx";
import { useHorizontalSwipe } from "./gesture.ts";
import { trashWithUndo } from "./PhoneItem.tsx";

const EASE = "cubic-bezier(.2, 0, 0, 1)";

/**
 * Which way rows may be swiped away ([dx] < 0: leftwards). On the Tasks page the other way turns the
 * page (Scheduled ⇄ To-do), so each list leaves its rows only the way that has no page.
 */
export const TrashSwipeWay = createContext<(dx: number) => boolean>(() => true);

export function SwipeToTrash({ item, children }: { item: Item; children: ReactNode }) {
  const front = useRef<HTMLDivElement>(null);
  const gone = useRef(false);
  const way = useContext(TrashSwipeWay);
  const ref = useHorizontalSwipe<HTMLDivElement>({
    accept: way,
    onStart: () => {
      const f = front.current;
      if (!f || gone.current) return;
      f.style.transition = "none";
      ref.current?.classList.add("swiping");
    },
    onMove: (dx) => {
      const f = front.current, box = ref.current;
      if (!f || !box || gone.current) return;
      f.style.transform = `translate3d(${dx}px,0,0)`;
      box.classList.toggle("left", dx < 0);
      box.classList.toggle("armed", Math.abs(dx) > box.offsetWidth * 0.4);
    },
    onEnd: (dx, vx) => {
      const f = front.current, box = ref.current;
      if (!f || !box || gone.current) return;
      const w = box.offsetWidth;
      const flung = Math.abs(vx) > 0.8 && Math.sign(vx) === Math.sign(dx) && Math.abs(dx) > 48;
      if (Math.abs(dx) > w * 0.4 || flung) {
        gone.current = true;
        f.style.transition = `transform .18s ${EASE}`;
        f.style.transform = `translate3d(${Math.sign(dx) * w}px,0,0)`;
        window.setTimeout(() => {
          // The gap closes, then the item leaves (an Undo brings it back as a fresh row).
          box.style.height = `${box.offsetHeight}px`;
          void box.offsetHeight;
          box.style.transition = `height .15s ${EASE}`;
          box.style.height = "0px";
          window.setTimeout(() => trashWithUndo(item), 150);
        }, 170);
      } else {
        f.style.transition = `transform .2s ${EASE}`;
        f.style.transform = "translate3d(0,0,0)";
        box.classList.remove("swiping", "armed");
      }
    },
  });
  return (
    <div ref={ref} className="p-swipe">
      <div className="p-swipe-bg" aria-hidden="true"><MIcon name="oDelete" /></div>
      <div ref={front} className="p-swipe-front">{children}</div>
    </div>
  );
}
