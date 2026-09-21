import path from "node:path";
import { defineConfig } from "vite";

// Isolated World Dwell graybox. No app shell, no API, no Claire/Narrator.
export default defineConfig({
  root: path.resolve(import.meta.dirname, "preview/world-dwell-graybox"),
  server: {
    host: true,
    port: 4178,
    allowedHosts: [".bldg.chat", "localhost", "127.0.0.1"],
  },
});
