// Whole-screen notices shown instead of the app, in the sign-in screen's calm card: Planner open in
// another tab (only one tab may write the local copy), or a start that failed.

export function OtherTab({ onUseHere }: { onUseHere: () => void }) {
  return (
    <div className="login">
      <div className="card">
        <div className="row"><img src="/icon.svg" alt="" width={36} /><b style={{ fontSize: 20 }}>Planner</b></div>
        <div className="hint">Planner is open in another tab or window. Only one can be used at a time, so nothing is lost between them.</div>
        <button className="btn primary" onClick={onUseHere}>Use here</button>
      </div>
    </div>
  );
}

export function StartFailed({ message }: { message: string }) {
  return (
    <div className="login">
      <div className="card">
        <div className="row"><img src="/icon.svg" alt="" width={36} /><b style={{ fontSize: 20 }}>Planner</b></div>
        <div className="hint">Planner couldn't open its data on this device. Nothing has been changed or sent.</div>
        <div style={{ color: "var(--danger)", fontSize: 13 }}>{message}</div>
        <button className="btn primary" onClick={() => location.reload()}>Try again</button>
      </div>
    </div>
  );
}
