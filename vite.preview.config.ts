import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// Standalone preview of the True P&L Cockpit with mock data — no backend/auth.
// Serves preview/index.html at "/" so the Preview MCP can screenshot it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "preview"),
  server: {
    host: true,
    allowedHosts: [".bldg.chat", "localhost", "127.0.0.1"],
    fs: { allow: [path.resolve(import.meta.dirname)] },
  },
});
