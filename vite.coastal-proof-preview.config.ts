import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

/**
 * Standalone Coastal Market proof: static build with relative paths, so it can
 * be published as a claude.ai artifact and played on a phone. No server, no
 * database, no auth; the only public files are the proof's own assets.
 *
 *   npx vite --config vite.coastal-proof-preview.config.ts          (dev, :5197)
 *   npx vite build --config vite.coastal-proof-preview.config.ts    (tmp/coastal-proof-preview-build)
 */
export default defineConfig({
  plugins: [react()],
  root: path.resolve(import.meta.dirname, "preview/coastal-proof"),
  publicDir: path.resolve(import.meta.dirname, "client/public/assets/goldline/coastal-market-three-proof"),
  cacheDir: path.resolve(import.meta.dirname, "tmp/coastal-proof-preview-vite-cache"),
  base: "./",
  resolve: {
    alias: [
      { find: "@shared", replacement: path.resolve(import.meta.dirname, "shared") },
      { find: "@", replacement: path.resolve(import.meta.dirname, "client/src") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5197,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "tmp/coastal-proof-preview-build"),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
});
