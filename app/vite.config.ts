import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri loads the dev server on a fixed port and watches src-tauri itself.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // TAURI_ENV_DEBUG decides whether the debug-only test hooks are compiled in.
  envPrefix: ["VITE_", "TAURI_ENV_"],
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "safari17",
    outDir: "dist",
    emptyOutDir: true,
  },
});
