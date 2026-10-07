import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  optimizeDeps: { entries: ["e2e/boreslay/fixture.html"] },
  publicDir: resolve("client/public"),
  resolve: {
    alias: {
      "@": resolve("client/src"),
      "@shared": resolve("shared"),
    },
  },
  plugins: [
    {
      name: "boreslay-proof-seams",
      enforce: "pre",
      resolveId(source, importer) {
        if (
          importer?.endsWith("/boreslay-rally/RallyDemo.tsx") &&
          (source === "@/lib/trpc" || source.endsWith("/client/src/lib/trpc"))
        ) {
          return resolve("e2e/boreslay/mocks.ts");
        }
      },
    },
  ],
});
