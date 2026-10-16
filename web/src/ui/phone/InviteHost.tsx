// Calendar invitations opened with the app (Gmail's invite.ics, a .ics in Files). The native side
// (invite/InvitePlugin.kt) reads the shared file; here its event is read (domain/ics.ts) and shown in
// the editor, filled in, to be added with Save. A cancellation only says so. Nothing is fetched: no
// Google account, no links opened.
import { registerPlugin } from "@capacitor/core";
import { useEffect, useState } from "react";
import { formatDate } from "../../domain/dates.ts";
import { readInvite } from "../../domain/ics.ts";
import type { Reminder } from "../../domain/types.ts";
import { isNative } from "../../platform.ts";
import { Dialog } from "./chrome.tsx";
import { TextButton, showSnackbar } from "./m3.tsx";
import { defaultAlert, firstAlerts, openNewDraft } from "./PhoneItem.tsx";

interface InvitePlugin {
  take(): Promise<{ text?: string; name?: string; error?: string }>;
  addListener(event: "invite", fn: () => void): Promise<{ remove: () => Promise<void> }>;
}
const plugin = isNative ? registerPlugin<InvitePlugin>("Invite") : null;

/** Shows what an opened invitation holds (one per app, from PhoneApp). */
export function InviteHost() {
  const [msg, setMsg] = useState<{ title: string; text: string } | null>(null);
  useEffect(() => {
    if (!plugin) return;
    const take = async () => {
      const r = await plugin.take().catch(() => ({} as { text?: string; error?: string }));
      if (r.error) { setMsg({ title: "Can't open this file", text: r.error }); return; }
      if (!r.text) return;
      const res = readInvite(r.text);
      if (res.kind === "empty") { setMsg({ title: "No event in this file", text: "This calendar file has no event to add." }); return; }
      if (res.kind === "cancelled") {
        const what = res.title ? `"${res.title}"` : "This event";
        const when = res.day !== null ? ` on ${formatDate(res.day)}` : "";
        setMsg({ title: "Event cancelled", text: `${what}${when} was cancelled by its organiser. Nothing was added or changed; if you added it earlier, you can delete it from your calendar.` });
        return;
      }
      const { item, alerts, repeatDropped } = res.invite;
      const reminders: Reminder[] = alerts.length
        ? alerts.map((offsetMin) => ({ id: 0, itemId: 0, offsetMin, type: defaultAlert("EVENT"), soundUri: null }))
        : firstAlerts(item);
      setMsg(null);
      openNewDraft({ item, reminders, tags: "" });
      if (repeatDropped) showSnackbar("It repeats in a way this app can't follow, so it's added once");
      else if (res.others > 0) showSnackbar(`The file has ${res.others + 1} events; this is the first`);
    };
    const h = plugin.addListener("invite", () => void take());
    void take();
    return () => { void h.then((x) => x.remove()); };
  }, []);
  if (!msg) return null;
  return (
    <Dialog title={msg.title} onClose={() => setMsg(null)} actions={<TextButton onClick={() => setMsg(null)}>OK</TextButton>}>
      {msg.text}
    </Dialog>
  );
}
