// The update popup (update.ts decides when there is one): the release's name and notes, then Update
// (download, Android's installer) or Later. Before the first install Android needs "Allow from this
// source" for this app; a short note explains that and opens the setting.
import { useEffect, useState, useSyncExternalStore } from "react";
import { releaseNoteBlocks } from "../../domain/version.ts";
import { Dialog } from "./chrome.tsx";
import { TextButton } from "./m3.tsx";
import {
  askInstallPermission, canInstall, closeOffer, currentOffer, dismissOffer, downloadUpdate, openInstaller, subscribeOffer, watchForUpdates,
} from "./update.ts";

type Step = "offer" | "permission" | "downloading" | "failed";

export function UpdateHost() {
  const offer = useSyncExternalStore(subscribeOffer, currentOffer);
  const [step, setStep] = useState<Step>("offer");
  const [progress, setProgress] = useState<number | null>(null);
  // On opening the app and on coming back to it (update.ts keeps it to every 6 hours).
  useEffect(() => watchForUpdates(), []);
  useEffect(() => { if (offer) { setStep("offer"); setProgress(null); } }, [offer]);
  if (!offer) return null;
  const { release, installed } = offer;
  const version = release.tag.replace(/^v/i, "");

  const download = async () => {
    if (!release.apkUrl) { setStep("failed"); return; }
    setStep("downloading");
    setProgress(null);
    try {
      await downloadUpdate(release.apkUrl, setProgress);
      await openInstaller();
      closeOffer();
    } catch { setStep("failed"); }
  };
  const update = async () => {
    if (await canInstall()) void download();
    else setStep("permission");
  };
  const allow = async () => {
    if (await askInstallPermission()) void download();
  };

  if (step === "permission") {
    return (
      <Dialog title="Allow updates" onClose={closeOffer} actions={<>
        <TextButton onClick={closeOffer}>Cancel</TextButton>
        <TextButton onClick={() => void allow()}>Open settings</TextButton>
      </>}>
        Android asks once before an app can install its own updates. Turn on <b>Allow from this source</b> for Planner, then come back here.
      </Dialog>
    );
  }
  if (step === "downloading") {
    return (
      <Dialog title={release.name} onClose={() => { /* stays until the download ends */ }} actions={<TextButton onClick={() => { /* busy */ }} disabled>Downloading…</TextButton>}>
        <div className="p-update-progress">
          <div className="p-progress"><span className={`active ${progress === null ? "busy" : ""}`} style={{ width: `${(progress ?? 0.3) * 100}%` }} /></div>
          <span className="p-update-size">{progress === null ? "Downloading…" : `Downloading… ${Math.round(progress * 100)}%`}</span>
        </div>
      </Dialog>
    );
  }
  if (step === "failed") {
    return (
      <Dialog title="Couldn't download the update" onClose={closeOffer} actions={<>
        <TextButton onClick={dismissOffer}>Later</TextButton>
        <TextButton onClick={() => void download()}>Try again</TextButton>
      </>}>Check the connection and try again.</Dialog>
    );
  }
  const notes = releaseNoteBlocks(release.body);
  return (
    <Dialog title={release.name} onClose={dismissOffer} actions={<>
      <TextButton onClick={dismissOffer}>Later</TextButton>
      <TextButton onClick={() => void update()}>Update</TextButton>
    </>}>
      <div className="p-update-version">Version {version} is available · you have {installed}</div>
      {notes.length > 0 && (
        <div className="p-update-notes">
          {notes.map((n, i) => n.kind === "heading" ? <div key={i} className="h">{n.text}</div>
            : n.kind === "bullet" ? <div key={i} className="li">{n.text}</div>
            : <p key={i}>{n.text}</p>)}
        </div>
      )}
    </Dialog>
  );
}
