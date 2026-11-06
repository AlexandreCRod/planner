// The Clock tab tells what's running (336, the user's pick: A's behaviour with C's look). Nothing is added
// to the pages: while a timer or stopwatch counts and the Clock page isn't the one shown, the tab's icon gets
// a ring (a timer's empties as it runs; a stopwatch's goes round once a minute) and its label shows the time
// of the soonest one, with a count on the icon when several run. A tap on the tab opens that one's section;
// a hold lists them all by name (the shared hold-and-slide menu, 361), and picking one opens its section.
// Phone only: the PC has no Clock tab.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { alarmState, useAlarmState } from "../../alarms/native.ts";
import { type Running, clockTab, runningClocks } from "../../domain/clockRunning.ts";
import { DropdownMenu } from "./chrome.tsx";

/** What runs now, read fresh (for a tap or a hold on the tab). */
export const runningNow = (): Running[] => runningClocks(alarmState().tools, Date.now());

/** The time, redrawn on each second while something runs (and not at all otherwise). */
function useNowWhile(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    let t = 0;
    const tick = () => { setNow(Date.now()); t = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5); };
    tick();
    return () => clearTimeout(t);
  }, [on]);
  return now;
}

const R = 14, C = 2 * Math.PI * R;

/** The ring and the count over the Clock tab's icon, and the time for its label; null shows the tab as usual. */
export function useClockTab(shown: boolean): { ring: React.ReactNode; label: string | null; aria: string | null } {
  const st = useAlarmState();
  const any = !shown && runningClocks(st.tools, Date.now()).length > 0;
  const now = useNowWhile(any);
  const tab = shown ? null : clockTab(runningClocks(st.tools, now));
  if (!tab) return { ring: null, label: null, aria: null };
  const ring = (
    <span className="p-clockring" aria-hidden="true">
      <svg width="32" height="32" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r={R} className="track" />
        <circle cx="16" cy="16" r={R} className="arc" strokeDasharray={`${C * tab.ring} ${C}`} transform="rotate(-90 16 16)" />
      </svg>
      {tab.count > 1 && <span className="p-clockcount">{tab.count}</span>}
    </span>
  );
  const aria = `Clock, ${tab.first.name} ${tab.first.kind === "timer" ? `${tab.time} left` : tab.time}${tab.count > 1 ? `, ${tab.count} running` : ""}`;
  return { ring, label: tab.time, aria };
}

/** The list of running ones, above the Clock tab (it's the last tab, at the bar's right end). */
export function ClockTabMenu({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (r: Running) => void }) {
  const st = useAlarmState();
  const now = useNowWhile(open);
  const list = open ? runningClocks(st.tools, now) : [];
  return createPortal(
    <div className="p-menu-anchor p-clockmenu">
      <DropdownMenu open={open && list.length > 0} onClose={onClose} items={list.map((r) => ({
        label: `${r.name} · ${r.time}`, icon: r.kind === "timer" ? "oTimer" : "oAvTimer", onClick: () => onPick(r),
      }))} />
    </div>,
    document.body,
  );
}
