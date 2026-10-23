// Signed out: the sync password (and, in the phone app, the server's address).
import { useState } from "react";
import { DEFAULT_SERVER, getServer, isNative, setServer } from "../platform.ts";
import { testToken, setToken, startAutoSync } from "../store/sync.ts";
import { go } from "./shared/common.tsx";

export function Login({ message }: { message: string }) {
  const [token, setTok] = useState("");
  // The phone app isn't served by the Worker, so it asks where the server is.
  const [server, setSrv] = useState(() => getServer() || DEFAULT_SERVER);
  const [error, setError] = useState(message);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      if (isNative) setServer(server);
      const { items } = await testToken(token);
      setToken(token);
      setError("");
      startAutoSync();
      if (!location.hash) go("today");
      void items;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <div className="card">
        <div className="row"><img src="/icon.svg" alt="" width={36} /><b style={{ fontSize: 20 }}>Planner</b></div>
        <div className="hint">
          {isNative
            ? "Enter your server's address and the sync password you chose when setting it up. The password is kept only on this phone."
            : "Enter the sync password you chose when setting up the server. It is kept only in this browser."}
        </div>
        {isNative && <input className="input" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="Server address" aria-label="Server address" value={server} onChange={(e) => setSrv(e.target.value)} />}
        <input className="input" type="password" autoFocus={!isNative} placeholder="Sync password" value={token} onChange={(e) => setTok(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
        {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
        <button className="btn primary" disabled={!token || (isNative && !server.trim()) || busy} onClick={() => void submit()}>{busy ? "Connecting…" : "Connect"}</button>
      </div>
    </div>
  );
}
