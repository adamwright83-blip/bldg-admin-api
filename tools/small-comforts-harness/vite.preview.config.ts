import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react()],
  base: "./",
  root: path.resolve(import.meta.dirname),
  publicDir: process.env.SC_PUBLIC || path.resolve(import.meta.dirname, "..", "client", "public"),
  define: { __SC_BUILD_SHA__: JSON.stringify(process.env.SC_BUILD_SHA || "unknown") },
  build: { outDir: process.env.SC_OUT || path.resolve(import.meta.dirname, "..", "..", "sc-preview-dist"), emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
