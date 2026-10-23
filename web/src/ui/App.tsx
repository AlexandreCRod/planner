import { useWide } from "../platform.ts";
import { Login } from "./Login.tsx";
import { PhoneApp } from "./phone/PhoneApp.tsx";
import { useSyncStatus } from "./shared/settings.ts";

export function App() {
  // One app everywhere: the phone's screens, on the phone and in every browser window. A wide window
  // (the PC) lays them out for its width: a side rail, panes side by side, sheets as dialogs (wide.css).
  const wide = useWide();
  const sync = useSyncStatus();
  // All of the screens' CSS hangs off html.phone, and the wide layout off html.wide. Set while
  // rendering, so the pages measure themselves with it already applied.
  document.documentElement.classList.add("phone");
  document.documentElement.classList.toggle("wide", wide);
  if (sync.state === "signed-out") return <Login message={sync.message} />;
  return <PhoneApp />;
}
