// A screen that crashes shows a calm message with Reload instead of leaving a blank page, and what
// happened goes to the problem log (Settings → Problem log). Used around the whole app and each page,
// so one page failing leaves the rest usable.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { logProblem } from "../../problems.ts";

interface Props { children: ReactNode; where: string; full?: boolean }

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logProblem("screen", `${this.props.where}: ${error.message}`, `${error.stack ?? ""}\n${info.componentStack ?? ""}`);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={`p-crashed ${this.props.full ? "full" : ""}`} role="alert">
        <b>Something went wrong here</b>
        <span>It's saved in Settings → Problem log. Your data is safe.</span>
        <button className="btn primary" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
