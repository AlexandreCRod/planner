// A list row that can be swiped away to the trash, leftwards on every list (M3's swipe-to-dismiss): past
// the touch slop the row follows the finger over a red strip with a bin; let go past 40% of the width (or
// flung) it slides out and the gap closes, with an Undo snackbar. The item only goes to the trash once
// that snackbar has gone (or the app is put away); Undo opens the gap again and slides the row back.
// Less than that, and it springs back. Vertical scrolling and taps are untouched (see gesture.ts).
import { type ReactNode, useRef } from "react";
import type { Item } from "../../domain/types.ts";
import { MIcon } from "./chrome.tsx";
import { useHorizontalSwipe } from "./gesture.ts";
import { onFlush, restore, trash } from "../../store/store.ts";
import { showSnackbar } from "./m3.tsx";
import { feel } from "./haptics.ts";
import { rowDragging } from "./rowDrag.ts";

const EASE = "cubic-bezier(.2, 0, 0, 1)";

export function SwipeToTrash({ item, children }: { item: Item; children: ReactNode }) {
  const front = useRef<HTMLDivElement>(null);
  const gone = useRef(false);
  const ref = useHorizontalSwipe<HTMLDivElement>({
    // Leftwards only, on every list (241: the same way everywhere, as on Android); not while the row is dragged.
    accept: (dx) => dx < 0 && !rowDragging(),
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
      // Reaching the point where letting go removes it (or going back from it) ticks once.
      const armed = Math.abs(dx) > box.offsetWidth * 0.4;
      if (armed !== box.classList.contains("armed")) { box.classList.toggle("armed", armed); feel("tick"); }
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
          window.setTimeout(() => holdBack(Math.sign(dx)), 150);
        }, 170);
      } else {
        f.style.transition = `transform .2s ${EASE}`;
        f.style.transform = "translate3d(0,0,0)";
        box.classList.remove("swiping", "armed");
      }
    },
  });
  /** The row is gone from sight; the item goes to the trash when the Undo has gone unused. */
  const holdBack = (dir: number) => {
    let done = false;
    const commit = () => { if (done) return; done = true; offFlush(); trash(item.id); };
    const offFlush = onFlush(commit);
    showSnackbar(`“${item.title.trim() || "Untitled"}” moved to trash`, "Undo", () => {
      offFlush();
      if (done) { restore(item.id); return; } // already trashed (the app was put away): it comes back as a fresh row
      done = true;
      bringBack(dir);
    }, { ms: 5000, onGone: commit });
  };
  /** Undo: the gap opens again and the row slides back in from the side it left by. */
  const bringBack = (dir: number) => {
    const f = front.current, box = ref.current;
    if (!f || !box) return;
    const h = f.offsetHeight;
    f.style.transition = "none";
    f.style.transform = `translate3d(${dir * box.offsetWidth}px,0,0)`;
    box.style.transition = `height .2s ${EASE}`;
    box.style.height = `${h}px`;
    window.setTimeout(() => {
      f.style.transition = `transform .26s ${EASE}`;
      f.style.transform = "translate3d(0,0,0)";
      window.setTimeout(() => {
        box.style.transition = ""; box.style.height = "";
        f.style.transition = ""; f.style.transform = "";
        box.classList.remove("swiping", "armed", "left");
        gone.current = false;
      }, 280);
    }, 120);
  };
  return (
    <div ref={ref} className="p-swipe">
      <div className="p-swipe-bg" aria-hidden="true"><MIcon name="oDelete" /></div>
      <div ref={front} className="p-swipe-front">{children}</div>
    </div>
  );
}
