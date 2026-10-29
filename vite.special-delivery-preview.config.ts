import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

/**
 * Standalone Silver Lake · Special Delivery preview: no server, no database, no auth.
 *
 * Mounts the real Silver Lake 3D component with its synthetic neighbours. The only module substitution is
 * `@/lib/trpc` (an in-memory stub), so nothing here can reach production; the correspondence desk shows the
 * labelled synthetic fixture. Static build with relative paths, so it can be published as an artifact.
 *
 *   npx vite --config vite.special-delivery-preview.config.ts           (dev, :5199)
 *   npx vite build --config vite.special-delivery-preview.config.ts     (tmp/special-delivery-preview-build)
 *   node preview/special-delivery/package-artifact.mjs                  (trims that build into a publishable artifact)
 */
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  root: path.resolve(import.meta.dirname, "preview/special-delivery"),
  publicDir: path.resolve(import.meta.dirname, "client/public"),
  cacheDir: path.resolve(import.meta.dirname, "tmp/special-delivery-preview-vite-cache"),
  base: "./",
  resolve: {
    alias: [
      // the artifact build only: textures through <img> (the artifact CSP blocks blob: fetches) and the courtyard
      // reassembled from parts (one artifact file may be at most 15 MB)
      ...(command === "build"
        ? [{ find: /^three\/examples\/jsm\/loaders\/GLTFLoader\.js$/, replacement: path.resolve(import.meta.dirname, "preview/special-delivery/artifactGltfLoader.ts") }]
        : []),
      { find: /^@\/lib\/trpc$/, replacement: path.resolve(import.meta.dirname, "preview/special-delivery/trpcStub.ts") },
      { find: "@shared", replacement: path.resolve(import.meta.dirname, "shared") },
      { find: "@", replacement: path.resolve(import.meta.dirname, "client/src") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5199,
    strictPort: true,
    fs: {
      allow: [
        import.meta.dirname,
        path.resolve(import.meta.dirname, "node_modules"),
        // worktrees under .claude/worktrees/ share the main checkout's node_modules
        path.resolve(import.meta.dirname, "../../../node_modules"),
      ],
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "tmp/special-delivery-preview-build"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
}));
