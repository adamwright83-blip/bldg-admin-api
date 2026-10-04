import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react()],
  root: path.resolve(import.meta.dirname),
  publicDir: path.resolve(import.meta.dirname, "..", "client", "public"),
  server: { port: 5199, host: "127.0.0.1", fs: { allow: [path.resolve(import.meta.dirname, "..")] } },
});
