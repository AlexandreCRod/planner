// Web links in notes and descriptions: the card a long press shows (title, picture, site, with Open and
// Copy). The preview is asked of the Worker only now, so the site isn't contacted unless you look; without
// it (offline, an older Worker) the card still has the address and the site.
import { type ReactNode, useEffect, useState } from "react";
import { type LinkPreview, shortUrl } from "../../domain/links.ts";
import { fetchPreview } from "../../store/preview.ts";
import type { LinkActions } from "../shared/linkGesture.ts";
import { BottomSheet, TextButton, showSnackbar } from "./m3.tsx";
import { openExternal } from "./native.ts";

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

function LinkCard({ url, onClose }: { url: string; onClose: () => void }) {
  const [info, setInfo] = useState<LinkPreview | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const ctl = new AbortController();
    void fetchPreview(url, ctl.signal).then((p) => { if (!ctl.signal.aborted) { setInfo(p); setLoading(false); } });
    return () => ctl.abort();
  }, [url]);
  const title = info?.title.trim() ?? "";
  const copy = (close: () => void) => {
    void navigator.clipboard.writeText(url).then(() => showSnackbar("Copied"), () => showSnackbar("Couldn't copy"));
    close();
  };
  return (
    <BottomSheet onClose={onClose} className="wl-sheet">{(close) => <>
      <div className="wl-card">
        {info?.image && <img className="wl-image" src={info.image} alt="" />}
        <div className="wl-site">{info?.site || hostOf(url)}</div>
        {title && <div className="wl-title">{title}</div>}
        {info?.description && <div className="wl-desc">{info.description}</div>}
        <div className="wl-url">{loading ? "Loading preview…" : shortUrl(url)}</div>
      </div>
      <div className="p-sheet-buttons">
        <TextButton onClick={() => copy(close)}>Copy</TextButton>
        <button className="p-filled-btn" autoFocus onClick={() => { openExternal(url); close(); }}>Open</button>
      </div>
    </>}</BottomSheet>
  );
}

/** The actions for links in text (a tap opens, a long press shows the card) and the card to render beside the text. */
export function useWebLinks(): { act: LinkActions; card: ReactNode } {
  const [url, setUrl] = useState<string | null>(null);
  return {
    act: { open: openExternal, card: setUrl },
    card: url && <LinkCard url={url} onClose={() => setUrl(null)} />,
  };
}
