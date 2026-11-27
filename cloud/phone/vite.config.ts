// The phone page: a static app built from this folder (build spec §11.1). The build reads `VITE_CONVEX_URL` (the dev or
// production deployment's address) and, from slice 9, `VITE_VAPID_PUBLIC_KEY`. Its Content-Security-Policy is written into
// the page at build time from the one address it may talk to: scripts and styles from itself, a connection to Convex and to
// nothing else, no inline script, no frame.

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/** `https://x.convex.cloud` → the https origin and its secure websocket, the two a Convex client opens. */
export function connectSrc(convexUrl: string | undefined): string {
  if (!convexUrl) return "'self'";
  const url = new URL(convexUrl);
  return `'self' https://${url.host} wss://${url.host}`;
}

export function policy(convexUrl: string | undefined): string {
  return ["default-src 'self'", `connect-src ${connectSrc(convexUrl)}`, "img-src 'self' data:", "style-src 'self' 'unsafe-inline'", "script-src 'self'", "base-uri 'self'", "form-action 'none'", "frame-ancestors 'none'", "object-src 'none'", "manifest-src 'self'", "worker-src 'self'"].join("; ");
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "VITE_");
  return {
    root: import.meta.dirname,
    plugins: [
      react(),
      {
        name: "kinas-csp",
        transformIndexHtml: (html: string) => html.replace("__CSP__", policy(env.VITE_CONVEX_URL)),
      },
    ],
    build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
    server: { port: 5174 },
  };
});
