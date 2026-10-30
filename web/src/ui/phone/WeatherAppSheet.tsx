// Settings' weather app picker (83): the phone's apps by name in a sheet with a search bar, instead of
// Android's own "pick an app" screen, which loads every icon before it shows and was slow. Rows off screen
// skip layout (content-visibility) and an icon is asked for only when its row comes near the screen, once.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type LaunchApp, act, native } from "../../alarms/native.ts";
import { filterApps } from "../../domain/apps.ts";
import { MIcon } from "./chrome.tsx";
import { BottomSheet } from "./m3.tsx";

/** Icons already read, by component, for the life of the page. */
const icons = new Map<string, string>();
function AppIcon({ component, list }: { component: string; list: React.RefObject<HTMLDivElement | null> }) {
  const [src, setSrc] = useState(() => icons.get(component) ?? "");
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (src || !el.current) return;
    let live = true;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void native.appIcon(component).then((png) => { icons.set(component, png); if (live) setSrc(png); });
    }, { root: list.current, rootMargin: "200px 0px" });
    io.observe(el.current);
    return () => { live = false; io.disconnect(); };
  }, [component]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={el} className="ps-appicon">{src ? <img src={src} alt="" width={40} height={40} /> : <MIcon name="oApps" size={24} />}</span>;
}

export function WeatherAppSheet({ apps, current, onClose }: { apps: LaunchApp[]; current: string | null; onClose: () => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => filterApps(apps, q), [apps, q]);
  const list = useRef<HTMLDivElement>(null);
  return createPortal(
    <BottomSheet onClose={onClose} className="ps-apps-sheet">{(close) => (
      <div className="ps-apps">
        <div className="p-sheet-title">Weather app</div>
        <label className="ps-apps-search">
          <MIcon name="oSearch" size={20} />
          <input value={q} placeholder="Search apps" enterKeyHint="search" onChange={(e) => setQ(e.target.value)} />
          {q && <button aria-label="Clear" onClick={() => setQ("")}><MIcon name="fClose" size={20} /></button>}
        </label>
        <div className="ps-apps-list" ref={list}>
          {shown.length === 0 && <div className="ps-apps-none muted">No app called that</div>}
          {shown.map((a) => (
            <button key={a.component} className={`ps-app ${a.label === current ? "on" : ""}`}
              onClick={() => { close(); void act(native.setWeatherApp(a.component, a.label)); }}>
              <AppIcon component={a.component} list={list} />
              <span className="name">{a.label}</span>
              {a.label === current && <MIcon name="fCheck" size={20} />}
            </button>
          ))}
        </div>
      </div>
    )}</BottomSheet>,
    document.body,
  );
}
