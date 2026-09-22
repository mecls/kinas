import ReactDOM from "react-dom/client";
import { App } from "./App.tsx";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/usage.css";
import "./styles/settings.css";
import "./styles/overlay.css";
import "./styles/reader.css";
// Last, and entirely inside `@media print`: what the print sheet gets (Print as PDF).
import "./styles/print.css";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

if (import.meta.env.TAURI_ENV_DEBUG === "true") {
  void import("./testHooks.ts").then((m) => m.installTestHooks());
  // The component library's stories (DESIGN.md §9), in debug builds only and only when asked for by the hash: the
  // page mounts instead of the app, so no PTY is spawned. Vite drops this branch from a release build.
  if (location.hash === "#stories") {
    void import("./ui/stories/Stories.tsx").then((m) => root.render(<m.Stories />));
  } else {
    root.render(<App />);
  }
} else {
  // No StrictMode: its double-invoked effects would spawn the terminal's PTY twice.
  root.render(<App />);
}
