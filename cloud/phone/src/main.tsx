import { ConvexReactClient } from "convex/react";
import { ConvexProvider } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./phone.css";

// The page's one connection: the Convex deployment named at build time. A build without it says so instead of opening a
// client to nowhere.
const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const root = createRoot(document.getElementById("root")!);

if (!url) {
  root.render(<p className="p-err p-pad">This page was built without a Convex address. Set VITE_CONVEX_URL and build again.</p>);
} else {
  const client = new ConvexReactClient(url);
  root.render(
    <StrictMode>
      <ConvexProvider client={client}>
        <App />
      </ConvexProvider>
    </StrictMode>,
  );
}
