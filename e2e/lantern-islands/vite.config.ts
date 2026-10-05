import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  optimizeDeps: { entries: ["e2e/lantern-islands/fixture.html"] },
  publicDir: resolve("client/public"),
  resolve: { alias: { "@": resolve("client/src"), "@shared": resolve("shared") } },
  plugins: [{ name: "lantern-proof-seams", enforce: "pre", resolveId(source, importer) {
    if (importer?.endsWith("/LanternCityIslands.tsx") && (["@/lib/trpc", "@/_core/hooks/useAuth", "./islandBoard", "./ObjectiveMarksLayer"].includes(source) || source.endsWith("/client/src/lib/trpc") || source.endsWith("/client/src/_core/hooks/useAuth"))) return resolve("e2e/lantern-islands/mocks.ts");
  } }],
});
