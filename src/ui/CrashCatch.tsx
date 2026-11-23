import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { logError } from "../errorLog";

/**
 * When a part of the screen fails, Duet must never turn into a blank window. The error is written
 * to errors.log with the part that failed, and a plain way back shows instead. The design lives in
 * the store, outside the screen, so drawing the screen again loses nothing.
 */
export default class CrashCatch extends Component<{ children: ReactNode }, { broken: boolean; tries: number }> {
  state = { broken: false, tries: 0 };

  static getDerivedStateFromError() {
    return { broken: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError("screen failed", new Error(`${error.message}\n${error.stack ?? ""}\nIn: ${(info.componentStack ?? "").split("\n").slice(0, 8).join(" <")}`));
  }

  render() {
    if (!this.state.broken) return <Fragment key={this.state.tries}>{this.props.children}</Fragment>;
    return (
      <div className="crash-catch" data-name="crash-catch">
        <h2>Something went wrong on the screen</h2>
        <p>Your work is safe. What happened is written down, so it can be fixed.</p>
        <button className="pill primary" data-name="crash-back" onClick={() => this.setState((s) => ({ broken: false, tries: s.tries + 1 }))}>
          Back to your work
        </button>
      </div>
    );
  }
}

/** Errors outside the screen (a timer, a promise nobody waited for) go to errors.log too. */
export function catchStrayErrors() {
  window.addEventListener("error", (e) => logError("uncaught", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => logError("promise not caught", e.reason));
}
