// Small shared pieces: icons, task and event rows, the hash router.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { describe } from "../domain/recurrence.ts";
import { type Occurrence, type Streak, type TaskEntry, completionDay, dueAt } from "../domain/schedule.ts";
import { dueCountdown, formatTime, relativeDay } from "../domain/dates.ts";
import { type AlertType, PRIORITIES, isRecurring, type Item, priorityColor } from "../domain/types.ts";
import { reminderKind } from "../domain/reminders.ts";
import { type Snapshot, toggleCompletion } from "../store/store.ts";
import { feel } from "./phone/haptics.ts";

// Material Symbols paths (24 px viewBox).
const PATHS: Record<string, string> = {
  today: "M5 22q-.825 0-1.412-.587Q3 20.825 3 20V6q0-.825.588-1.412Q4.175 4 5 4h1V2h2v2h8V2h2v2h1q.825 0 1.413.588Q21 5.175 21 6v14q0 .825-.587 1.413Q19.825 22 19 22Zm0-2h14V10H5v10Zm2-6v-2h2v2Z",
  calendar: "M5 22q-.825 0-1.412-.587Q3 20.825 3 20V6q0-.825.588-1.412Q4.175 4 5 4h1V2h2v2h8V2h2v2h1q.825 0 1.413.588Q21 5.175 21 6v14q0 .825-.587 1.413Q19.825 22 19 22Zm0-2h14V10H5Zm7-6q-.425 0-.712-.288Q11 13.425 11 13t.288-.713Q11.575 12 12 12t.713.287Q13 12.575 13 13t-.287.712Q12.425 14 12 14Zm-4 0q-.425 0-.713-.288Q7 13.425 7 13t.287-.713Q7.575 12 8 12t.713.287Q9 12.575 9 13t-.287.712Q8.425 14 8 14Zm8 0q-.425 0-.712-.288Q15 13.425 15 13t.288-.713Q15.575 12 16 12t.712.287Q17 12.575 17 13t-.288.712Q16.425 14 16 14Zm-4 4q-.425 0-.712-.288Q11 17.425 11 17t.288-.712Q11.575 16 12 16t.713.288Q13 16.575 13 17t-.287.712Q12.425 18 12 18Zm-4 0q-.425 0-.713-.288Q7 17.425 7 17t.287-.712Q7.575 16 8 16t.713.288Q9 16.575 9 17t-.287.712Q8.425 18 8 18Zm8 0q-.425 0-.712-.288Q15 17.425 15 17t.288-.712Q15.575 16 16 16t.712.288Q17 16.575 17 17t-.288.712Q16.425 18 16 18Z",
  tasks: "m10.6 16.6 7.05-7.05-1.4-1.4-5.65 5.65-2.85-2.85-1.4 1.4ZM12 22q-2.075 0-3.9-.788-1.825-.787-3.175-2.137-1.35-1.35-2.137-3.175Q2 14.075 2 12t.788-3.9q.787-1.825 2.137-3.175 1.35-1.35 3.175-2.138Q9.925 2 12 2t3.9.787q1.825.788 3.175 2.138 1.35 1.35 2.137 3.175Q22 9.925 22 12t-.788 3.9q-.787 1.825-2.137 3.175-1.35 1.35-3.175 2.137Q14.075 22 12 22Z",
  notes: "M5 21q-.825 0-1.413-.587Q3 19.825 3 19V5q0-.825.587-1.413Q4.175 3 5 3h14q.825 0 1.413.587Q21 4.175 21 5v10l-6 6Zm2-8h5v-2H7Zm0-4h10V7H7Zm7 10.5 5.5-5.5H14Z",
  graph: "M5.47 6.29L11.47 10.29A0.85 0.85 0 0 1 10.53 11.71L4.53 7.71A0.85 0.85 0 0 1 5.47 6.29ZM10.51 10.31L17.51 5.31A0.85 0.85 0 0 1 18.49 6.69L11.49 11.69A0.85 0.85 0 0 1 10.51 10.31ZM11.82 11.23L9.82 18.23A0.85 0.85 0 0 1 8.18 17.77L10.18 10.77A0.85 0.85 0 0 1 11.82 11.23ZM11.55 10.35L18.55 16.35A0.85 0.85 0 0 1 17.45 17.65L10.45 11.65A0.85 0.85 0 0 1 11.55 10.35ZM2.8 7A2.2 2.2 0 1 1 7.2 7A2.2 2.2 0 1 1 2.8 7ZM8.4 11A2.6 2.6 0 1 1 13.6 11A2.6 2.6 0 1 1 8.4 11ZM16 6A2 2 0 1 1 20 6A2 2 0 1 1 16 6ZM7 18A2 2 0 1 1 11 18A2 2 0 1 1 7 18ZM15.8 17A2.2 2.2 0 1 1 20.2 17A2.2 2.2 0 1 1 15.8 17Z",
  search: "M19.6 21 13.3 14.7q-.75.6-1.725.95Q10.6 16 9.5 16q-2.725 0-4.612-1.887Q3 12.225 3 9.5q0-2.725 1.888-4.613Q6.775 3 9.5 3t4.613 1.887Q16 6.775 16 9.5q0 1.1-.35 2.075-.35.975-.95 1.725l6.3 6.3ZM9.5 14q1.875 0 3.188-1.312Q14 11.375 14 9.5q0-1.875-1.312-3.188Q11.375 5 9.5 5 7.625 5 6.312 6.312 5 7.625 5 9.5q0 1.875 1.312 3.188Q7.625 14 9.5 14Z",
  settings: "m9.25 22-.4-3.2q-.325-.125-.612-.3-.288-.175-.563-.375L4.7 19.375l-2.75-4.75 2.575-1.95Q4.5 12.5 4.5 12.338v-.675q0-.163.025-.338L1.95 9.375l2.75-4.75 2.975 1.25q.275-.2.575-.375.3-.175.6-.3l.4-3.2h5.5l.4 3.2q.325.125.613.3.287.175.562.375l2.975-1.25 2.75 4.75-2.575 1.95q.025.175.025.338v.674q0 .163-.05.338l2.575 1.95-2.75 4.75-2.95-1.25q-.275.2-.575.375-.3.175-.6.3l-.4 3.2Zm2.8-6.5q1.45 0 2.475-1.025Q15.55 13.45 15.55 12q0-1.45-1.025-2.475Q13.5 8.5 12.05 8.5q-1.475 0-2.488 1.025Q8.55 10.55 8.55 12q0 1.45 1.012 2.475Q10.575 15.5 12.05 15.5Z",
  add: "M11 19v-6H5v-2h6V5h2v6h6v2h-6v6Z",
  check: "M9.55 18 3.85 12.3 5.275 10.875 9.55 15.15 18.725 5.975 20.15 7.4Z",
  close: "M6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6Z",
  left: "m14 18-6-6 6-6 1.4 1.4-4.6 4.6 4.6 4.6Z",
  right: "M9.4 18 8 16.6l4.6-4.6L8 7.4 9.4 6l6 6Z",
  flag: "M5 21V4h9l.4 2H20v10h-7l-.4-2H7v7Z",
  alarm: "M12 22q-1.875 0-3.512-.712-1.638-.713-2.85-1.926-1.213-1.212-1.926-2.85Q3 14.875 3 13t.712-3.513q.713-1.637 1.926-2.85 1.212-1.212 2.85-1.925Q10.125 4 12 4t3.513.712q1.637.713 2.85 1.925 1.212 1.213 1.925 2.85Q21 11.125 21 13t-.712 3.512q-.713 1.638-1.925 2.85-1.213 1.213-2.85 1.926Q13.875 22 12 22Zm2.8-4.8 1.4-1.4-3.2-3.2V8h-2v5.4ZM5.6 2.35 7 3.75 2.75 8 1.35 6.6Zm12.8 0 4.25 4.25-1.4 1.4L17 3.75Z",
  link: "M11 17H7q-2.075 0-3.537-1.463Q2 14.075 2 12t1.463-3.538Q4.925 7 7 7h4v2H7q-1.25 0-2.125.875T4 12q0 1.25.875 2.125T7 15h4Zm-3-4v-2h8v2Zm5 4v-2h4q1.25 0 2.125-.875T20 12q0-1.25-.875-2.125T17 9h-4V7h4q2.075 0 3.538 1.462Q22 9.925 22 12q0 2.075-1.462 3.537Q19.075 17 17 17Z",
  repeat: "M7 22 3 18l4-4 1.4 1.45L6.85 17H17v-4h2v6H6.85l1.55 1.55Zm-2-11V5h12.15L15.6 3.45 17 2l4 4-4 4-1.4-1.45L17.15 7H7v4Z",
  fire: "M12 23q-3.75 0-6.375-2.625T3 14q0-3.4 2.112-6.638Q7.225 4.125 10.5 1.5v5.15q0 1.05.725 1.775.725.725 1.775.725.525 0 .963-.225.437-.225.787-.675L15 7.75q2.025 1.2 3.013 3.288Q19 13.125 19 14q0 3.75-2.625 6.375T12 23Z",
  trash: "M7 21q-.825 0-1.412-.587Q5 19.825 5 19V6H4V4h5V3h6v1h5v2h-1v13q0 .825-.587 1.413Q17.825 21 17 21Zm2-4h2V8H9Zm4 0h2V8h-2Z",
  pin: "m16 12 2 2v2h-5v6l-1 1-1-1v-6H6v-2l2-2V5H7V3h10v2h-1Z",
  undo: "M7 19v-2h7.1q1.575 0 2.738-1Q18 15 18 13.5T16.837 11q-1.162-1-2.737-1H7.8l2.6 2.6L9 14 4 9l5-5 1.4 1.4L7.8 8h6.3q2.425 0 4.163 1.575Q20 11.15 20 13.5q0 2.35-1.737 3.925Q16.525 19 14.1 19Z",
  redo: "M9.9 19q-2.425 0-4.163-1.575Q4 15.85 4 13.5q0-2.35 1.737-3.925Q7.475 8 9.9 8h6.3l-2.6-2.6L15 4l5 5-5 5-1.4-1.4 2.6-2.6H9.9q-1.575 0-2.737 1Q6 11 6 12.5T7.163 15q1.162 1 2.737 1H17v2Z",
  zoomIn: "M19.6 21 13.3 14.7q-.75.6-1.725.95Q10.6 16 9.5 16q-2.725 0-4.612-1.887Q3 12.225 3 9.5q0-2.725 1.888-4.613Q6.775 3 9.5 3t4.613 1.887Q16 6.775 16 9.5q0 1.1-.35 2.075-.35.975-.95 1.725l6.3 6.3ZM8.5 13v-2.5H6v-2h2.5V6h2v2.5H13v2h-2.5V13Z",
  image: "M5 21q-.825 0-1.412-.587Q3 19.825 3 19V5q0-.825.588-1.413Q4.175 3 5 3h14q.825 0 1.413.587Q21 4.175 21 5v14q0 .825-.587 1.413Q19.825 21 19 21Zm0-2h14V5H5Zm1-2h12l-3.75-5-3 4L9 13Z",
  place: "M12 12q.825 0 1.413-.588Q14 10.825 14 10t-.587-1.413Q12.825 8 12 8q-.825 0-1.412.587Q10 9.175 10 10q0 .825.588 1.412Q11.175 12 12 12Zm0 10q-4.025-3.425-6.012-6.362Q4 12.7 4 10.2q0-3.75 2.413-5.975Q8.825 2 12 2t5.587 2.225Q20 6.45 20 10.2q0 2.5-1.987 5.438Q16.025 18.575 12 22Z",
  myLocation: "M11 23v-2.05q-3.125-.35-5.363-2.587Q3.4 16.125 3.05 13H1v-2h2.05q.35-3.125 2.587-5.363Q7.875 3.4 11 3.05V1h2v2.05q3.125.35 5.363 2.587Q20.6 7.875 20.95 11H23v2h-2.05q-.35 3.125-2.587 5.363Q16.125 20.6 13 20.95V23Zm1-4q2.9 0 4.95-2.05Q19 14.9 19 12q0-2.9-2.05-4.95Q14.9 5 12 5 9.1 5 7.05 7.05 5 9.1 5 12q0 2.9 2.05 4.95Q9.1 19 12 19Zm0-3q-1.65 0-2.825-1.175Q8 13.65 8 12q0-1.65 1.175-2.825Q10.35 8 12 8q1.65 0 2.825 1.175Q16 10.35 16 12q0 1.65-1.175 2.825Q13.65 16 12 16Z",
  map: "m15 21-6-2.1-4.65 1.8q-.5.2-.925-.113Q3 20.275 3 19.75V5.75q0-.325.188-.575.187-.25.512-.375L9 3l6 2.1 4.65-1.8q.5-.2.925.112.425.313.425.838v14q0 .325-.187.575-.188.25-.513.375Zm-1-2.45V6.85l-4-1.4v11.7Z",
  schedule: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  bellOff: "M20 18.69L7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01c-.52.99-.8 2.16-.8 3.42v5l-2 2v1h13.73l2 2L21 19.72l-1-1.03zM12 22c1.11 0 2-.89 2-2h-4c0 1.11.89 2 2 2zm6-7.32V11c0-3.08-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68c-.15.03-.29.08-.42.12-.1.03-.2.07-.3.11h-.01c-.01 0-.01 0-.02.01-.23.09-.46.2-.68.31 0 0-.01 0-.01.01L18 14.68z",
  bell: "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z",
  palette: "M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67 0 1.38-1.12 2.5-2.5 2.5zm0-18c-4.41 0-8 3.59-8 8s3.59 8 8 8c.28 0 .5-.22.5-.5 0-.16-.08-.28-.14-.35-.41-.46-.63-1.05-.63-1.65 0-1.38 1.12-2.5 2.5-2.5H16c2.21 0 4-1.79 4-4 0-3.86-3.59-7-8-7zM5 11.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0zM8 7.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0zM13 7.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0zM16 11.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z",
  update: "M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1-2.73 2.71-2.73 7.08 0 9.79s7.15 2.71 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.53-9.11-.02-12.58s9.14-3.47 12.65 0L21 3v7.12zM12.5 8v4.25l3.5 2.08-.72 1.21L11 13V8h1.5z",
  subject: "M14 17H4v2h10v-2zm6-8H4v2h16V9zM4 15h16v-2H4v2zM4 5v2h16V5H4z",
  label: "M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16zM16 17H5V7h11l3.55 5L16 17z",
  lightbulb: "M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6C7.8 12.16 7 10.63 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z",
  copy: "M9 18q-.825 0-1.412-.587Q7 16.825 7 16V4q0-.825.588-1.413Q8.175 2 9 2h9q.825 0 1.413.587Q20 3.175 20 4v12q0 .825-.587 1.413Q18.825 18 18 18Zm0-2h9V4H9v12Zm-4 6q-.825 0-1.413-.587Q3 20.825 3 20V6h2v14h11v2Z",
  directions: "M8 15h2v-3h3.5v2.5L17 11l-3.5-3.5V10H9q-.425 0-.712.287Q8 10.575 8 11Zm4 7q-.375 0-.737-.137-.363-.138-.638-.413l-8.1-8.1q-.275-.275-.413-.638Q2 12.375 2 12t.137-.738q.138-.362.413-.637l8.1-8.1q.275-.275.638-.413Q11.625 2 12 2t.737.112q.363.113.638.388l8.1 8.125q.275.275.413.638.137.362.137.737t-.137.738q-.138.362-.413.637l-8.1 8.1q-.275.275-.638.413Q12.375 22 12 22Z",
  edit: "M5 19h1.425L16.2 9.225 14.775 7.8 5 17.575ZM3 21v-4.25L16.2 3.575q.3-.275.663-.425.362-.15.762-.15t.775.15q.375.15.65.45L20.425 5q.3.275.437.65T21 6.4q0 .4-.138.763-.137.362-.437.662L7.25 21ZM15.475 8.525l-.7-.725 1.425 1.425Z",
  fit: "M3 21v-6h2v2.6l3.1-3.1 1.4 1.4L6.4 19H9v2Zm12 0v-2h2.6l-3.05-3.05 1.4-1.4L19 17.6V15h2v6ZM8.05 9.5 5 6.4V9H3V3h6v2H6.4l3.05 3.05Zm7.9 0-1.4-1.4L17.6 5H15V3h6v6h-2V6.4Z",
};

export function Icon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={color ? { flex: "none", color } : { flex: "none" }}>
      <path d={PATHS[name] ?? ""} fill="currentColor" />
    </svg>
  );
}

/** Hash routes: #/today, #/note/123, #/item/45?occ=20374 ... */
export function useRoute(): [string[], URLSearchParams] {
  const read = () => {
    const h = location.hash.replace(/^#\/?/, "");
    const [path, query = ""] = h.split("?");
    return [path.split("/").filter(Boolean), new URLSearchParams(query)] as [string[], URLSearchParams];
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const go = (path: string) => { location.hash = "#/" + path; };
/** Goes to [path] in place of the page shown (no new step for back). */
export function replaceRoute(path: string) {
  history.replaceState(null, "", "#/" + path);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function openItem(item: Item, occurrenceDay?: number | null) {
  if (item.type === "NOTE") go(`note/${item.id}`);
  else go(`item/${item.id}${occurrenceDay != null ? `?occ=${occurrenceDay}` : ""}`);
}

/** Current time, refreshed every 30 s, for countdowns. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  return now;
}

export function Pill({ children, color, className = "", label }: { children: ReactNode; color: string; className?: string; label?: string }) {
  return <span className={`pill ${className}`} role={label ? "img" : undefined} aria-label={label} data-tip={label ? "" : undefined} style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)`, ["--pc" as string]: color }}>{children}</span>;
}

/** Seconds a ticked task stays where it was (Settings → Checked tasks); -1 until the page is left. */
export function checkedLinger(): number {
  const v = Number(localStorage.getItem("checkedLinger") ?? "3");
  return Number.isFinite(v) ? v : 3;
}

/** Whether ticked tasks stay listed on Today (after the linger); chosen in Settings. */
export const showDoneOnToday = () => localStorage.getItem("showDoneOnToday") !== "false";

/**
 * Keeps ticked tasks where they were for a while, so ticking doesn't make a row jump or vanish under
 * the pointer. Rows are identified by a list name plus a key that `arrange` computes the same way.
 */
export function useCheckedHold() {
  const [held, setHeld] = useState<Map<string, { index: number; entry: TaskEntry }>>(new Map());
  const timers = useRef(new Map<string, number>());
  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); }, []);
  // The same object until a row is held or let go, so memoised lists can take it as a prop.
  return useMemo(() => {
  const drop = (k: string) => setHeld((prev) => { const n = new Map(prev); n.delete(k); return n; });
  return {
    onToggle(list: string, key: string, entry: TaskEntry, index: number, done: boolean) {
      const k = `${list}|${key}`;
      clearTimeout(timers.current.get(k));
      timers.current.delete(k);
      const secs = checkedLinger();
      if (!done || secs === 0) { drop(k); return; }
      setHeld((prev) => new Map(prev).set(k, { index, entry: { ...entry, status: "DONE" } }));
      if (secs > 0) timers.current.set(k, window.setTimeout(() => { timers.current.delete(k); drop(k); }, secs * 1000));
    },
    /** `real` with the held rows of `list` put back where they were, shown as ticked. */
    arrange(list: string, real: TaskEntry[], key: (e: TaskEntry) => string): TaskEntry[] {
      const prefix = `${list}|`;
      const mine = [...held].filter(([k]) => k.startsWith(prefix)).sort((a, b) => a[1].index - b[1].index);
      if (!mine.length) return real;
      const keys = new Set(mine.map(([k]) => k.slice(prefix.length)));
      const out = real.filter((e) => !keys.has(key(e)));
      for (const [, h] of mine) out.splice(Math.min(h.index, out.length), 0, h.entry);
      return out;
    },
  };
  }, [held]);
}

/** The "repeats" mark in front of a repeating item's title. */
export function RepeatBadge({ color }: { color: string }) {
  return <span className="rep" title="Repeats" style={{ color, background: `color-mix(in srgb, ${color} 20%, transparent)` }}><Icon name="repeat" size={12} /></span>;
}

/** The icon by an item's time for the reminders it has: an alarm clock, a bell, or a silent bell. */
function ReminderIcon({ kind }: { kind: AlertType | null }) {
  if (!kind) return null;
  const [cls, icon, label] = kind === "ALARM" ? ["alarm", "alarm", "Alarm"] : kind === "REMINDER" ? ["bell", "bell", "Notification"] : ["bell-off", "bellOff", "Silent notification"];
  return <span className={`sub-icon ${cls}`} role="img" aria-label={label}><Icon name={icon} size={14} /></span>;
}
const REMINDER_EMOJI: Record<AlertType, string> = { ALARM: "⏰", REMINDER: "🔔", NOTIFICATION: "🔕" };

export function TaskRow({ entry, s, now, streakInfo, showDay, onToggle, priorityTag, heldTime, past }: {
  entry: TaskEntry; s: Snapshot; now: number; streakInfo?: Streak; showDay?: boolean;
  /** Today's page: behind us now (shown very slightly faded). */
  past?: boolean;
  /** The phone's time, which can be held to change it (the PC passes none). */
  heldTime?: (entry: TaskEntry) => ReactNode;
  /** The phone's task lists: priority as a coloured "High" tag at the end instead of the small flag. */
  priorityTag?: boolean;
  /** Called with the new state before the tick is saved. */
  onToggle?: (done: boolean) => void;
}) {
  const { item, status } = entry;
  const done = status === "DONE";
  const color = s.colorOf(item);
  const due = dueAt(entry);
  // A ticked task's reminders are off (kept for un-ticking), so it shows none.
  const kind = done ? null : reminderKind(s.reminders.get(item.id));
  const linked = s.neighbours(item.id).size > 0;
  const subParts: ReactNode[] = [
    showDay && entry.day !== null ? relativeDay(entry.day) : null,
    item.startMin !== null ? (heldTime?.(entry) || formatTime(item.startMin)) : null,
    isRecurring(item) ? describe(item) : null,
  ].filter(Boolean);
  const sub = subParts.length > 0;
  return (
    <div className={`task ${past ? "past" : ""}`} style={{ ["--c" as string]: color }} onClick={() => openItem(item, entry.day)}>
      <span className="bar" style={{ background: color }} />
      <input type="checkbox" checked={done} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { if (e.target.checked) feel("confirm"); onToggle?.(e.target.checked); toggleCompletion(item.id, completionDay(entry), e.target.checked); }} />
      <div className="grow">
        <div className={`title ellipsis ${done ? "done" : ""}`}>
          {isRecurring(item) && <RepeatBadge color={color} />}
          {item.priority > 0 && !done && !priorityTag && <span title={`${PRIORITIES[item.priority]} priority`} role="img" aria-label={`${PRIORITIES[item.priority]} priority`} data-tip style={{ verticalAlign: "-3px", marginRight: 4 }}><Icon name="flag" size={16} color={priorityColor(item.priority)} /></span>}
          {item.title || "Untitled"}
        </div>
        {sub && <div className="sub ellipsis">
          <span className="sub-text">{subParts.map((p, i) => <Fragment key={i}>{i > 0 && " · "}{p}</Fragment>)}</span>{kind && <span className="rem-emoji"> · {REMINDER_EMOJI[kind]}</span>}
          {/* The phone shows these as small icons after the line, like the native row (hidden on the PC). */}
          <ReminderIcon kind={kind} />
          {linked && <span className="sub-icon link"><Icon name="link" size={14} /></span>}
        </div>}
      </div>
      <span className="pills">
      {/* The flag alone, never the level's name (held, the phone shows it as a tooltip). */}
      {priorityTag && item.priority > 0 && !done && <Pill className="prio" color={priorityColor(item.priority)} label={`${PRIORITIES[item.priority]} priority`}><span className="sub-icon flag"><Icon name="flag" size={16} /></span></Pill>}
      {status === "OVERDUE" && <Pill color="var(--danger)">{entry.missed > 1 ? `${entry.missed} missed` : "Overdue"}</Pill>}
      {status === "CARRIED" && <Pill color="var(--p-tertiary, #7d5260)">Carried over</Pill>}
      {status === "MISSED" && <Pill color="var(--danger)">Missed</Pill>}
      {status === "DUE" && due !== null && <Pill color={due < now ? "var(--danger)" : color}>{dueCountdown(due, now)}</Pill>}
      {status === "UPCOMING" && entry.day !== null && <Pill color="var(--muted)">{relativeDay(entry.day)}</Pill>}
      {streakInfo && streakInfo.current > 0 && <Pill color="#ff7043"><span className="fire-emoji">🔥 </span><span className="sub-icon fire"><Icon name="fire" size={12} /></span>{streakInfo.current}</Pill>}
      </span>
    </div>
  );
}

/** [heldTime]: the phone's start and end times, which can be held to change them (the PC passes none). */
export function EventRow({ o, s, showDay, heldTime, past }: { o: Occurrence; s: Snapshot; showDay?: boolean; heldTime?: (o: Occurrence, which: "start" | "end") => ReactNode; past?: boolean }) {
  const t1 = (o.timed && heldTime?.(o, "start")) || (o.startMin !== null ? formatTime(o.startMin) : "");
  const t2 = (o.timed && o.endMin !== null && heldTime?.(o, "end")) || (o.endMin !== null ? formatTime(o.endMin) : "");
  return (
    <div className={`event ${past ? "past" : ""}`} onClick={() => openItem(o.item, o.day)}>
      <div className="time">{o.timed ? <><span className="t1">{t1}</span>{o.endMin !== null && <><br /><span className="t2">{t2}</span></>}</> : <span className="t0">All day</span>}</div>
      <span style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: s.colorOf(o.item) }} />
      <div className="grow">
        <div className="ellipsis">{isRecurring(o.item) && <RepeatBadge color={s.colorOf(o.item)} />}{o.item.title || "Untitled"}</div>
        <div className="hint ellipsis" style={{ fontSize: 12 }}>
          {[showDay ? relativeDay(o.day) : null, o.multiDay ? `until ${relativeDay(o.endDay)}` : null, isRecurring(o.item) ? describe(o.item) : null].filter(Boolean).join(" · ")}
          {!past && <ReminderIcon kind={reminderKind(s.reminders.get(o.item.id))} />}
        </div>
      </div>
    </div>
  );
}
