import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  optimizeDeps: { entries: ["e2e/cleancloud-intake/fixture.html"] },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": resolve("client/src"), "@shared": resolve("shared") },
  },
  server: { host: "127.0.0.1" },
});
