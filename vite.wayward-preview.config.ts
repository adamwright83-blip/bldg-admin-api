import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

/**
 * Standalone Wayward preview — no server, no database, no auth.
 *
 * Mounts the real Wayward stage through its explicit preview seam, so Rook can
 * travel aboard without any production party authority. The only module
 * substitution is `@/lib/trpc` (the Colosseum preview's in-memory stub); nothing
 * here can reach production. Run: npx vite --config vite.wayward-preview.config.ts
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: path.resolve(import.meta.dirname, "preview/wayward"),
  publicDir: path.resolve(import.meta.dirname, "client/public"),
  cacheDir: path.resolve(import.meta.dirname, "tmp/wayward-preview-vite-cache"),
  base: "./",
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
    port: 5195,
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
    outDir: path.resolve(import.meta.dirname, "tmp/wayward-preview-build"),
    emptyOutDir: true,
  },
});
