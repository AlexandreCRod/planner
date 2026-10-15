// Shared phone page chrome: the Material top app bar and its actions.
import { type ReactNode } from "react";
import { Icon, go } from "../common.tsx";

/** Material top app bar with search and settings, then the page's scrolling content. */
export function Scaffold({ title, children, flush, back }: { title: ReactNode; children: ReactNode; flush?: boolean; back?: boolean }) {
  return (
    <div className="p-scaffold">
      <header className="p-appbar">
        {back && <button className="p-icon" aria-label="Back" onClick={() => history.back()}><Icon name="left" size={24} /></button>}
        <h1 className={back ? "" : "pad"}>{title}</h1>
        {!back && <AppBarActions />}
      </header>
      <div className={`p-content ${flush ? "flush" : ""}`}>{children}</div>
    </div>
  );
}

export function AppBarActions() {
  return <>
    <button className="p-icon" aria-label="Search and browse" onClick={() => go("browse")}><Icon name="search" size={24} /></button>
    <button className="p-icon" aria-label="Settings" onClick={() => go("settings")}><Icon name="settings" size={24} /></button>
  </>;
}

