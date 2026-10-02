import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

// Integration suites opt in to the real disposable DATABASE_URL supplied by CI.
// The default Vitest config remains fail-closed against accidental database access.
process.env.ALLOW_TEST_DB ??= "1";

/** Optional: DB + local server + Twilio. Not part of default `pnpm test`. */
export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
