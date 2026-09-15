import ReactDOM from "react-dom/client";
import { App } from "./App.tsx";
import "./styles/tokens.css";
import "./styles/usage.css";
import "./styles/settings.css";
import "./styles/overlay.css";

if (import.meta.env.TAURI_ENV_DEBUG === "true") {
  void import("./testHooks.ts").then((m) => m.installTestHooks());
}

// No StrictMode: its double-invoked effects would spawn the terminal's PTY twice.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
