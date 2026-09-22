import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

/**
 * Standalone Colosseum preview — no server, no database, no auth.
 *
 * Mounts the real ColosseumBossGate / ClockheadDuel. The only substitution is
 * `@/lib/trpc`, swapped for an in-memory stub so the unmodified
 * Day1FieldMission can be clicked through locally; nothing here can reach
 * production. Run: npx vite --config vite.colosseum-preview.config.ts
 */
export default defineConfig({
  plugins: [react()],
  root: path.resolve(import.meta.dirname, "preview/colosseum"),
  publicDir: path.resolve(import.meta.dirname, "client/public"),
  // Its own dependency cache, so running it never invalidates the app's.
  cacheDir: path.resolve(import.meta.dirname, "tmp/colosseum-preview-vite-cache"),
  resolve: {
    alias: [
      {
        find: /^@\/lib\/trpc$/,
        replacement: path.resolve(import.meta.dirname, "preview/colosseum/trpcStub.ts"),
      },
      { find: "@shared", replacement: path.resolve(import.meta.dirname, "shared") },
      { find: "@", replacement: path.resolve(import.meta.dirname, "client/src") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5193,
    strictPort: true,
    fs: {
      allow: [
        import.meta.dirname,
        path.resolve(import.meta.dirname, "node_modules"),
        path.resolve(import.meta.dirname, "../Cursor_bldg-admin-api/node_modules"),
      ],
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "tmp/colosseum-preview-build"),
    emptyOutDir: true,
  },
});
