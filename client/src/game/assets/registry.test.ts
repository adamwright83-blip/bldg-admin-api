/**
 * The enforcement half of the asset registry.
 *
 * Slice A's success condition is that an agent "cannot silently add an unregistered
 * asset". These are the tests that make that true. If you added art and a test here
 * is red, the fix is to classify it in `ASSET_GROUPS`, not to loosen the test.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  ASSET_GROUPS,
  DUPLICATE_SETS,
  KNOWN_MISSING_REFERENCES,
  RETIRED_ASSETS,
  allAssets,
  assetByUrl,
  groupFor,
} from "./registry";

const REPO = resolve(__dirname, "..", "..", "..", "..");
const PUBLIC_ROOT = join(REPO, "client", "public");
const SRC_ROOT = join(REPO, "client", "src");
const IMAGE_EXT = /\.(png|jpe?g|webp|svg|gif|avif)$/i;

/** Both asset roots: served under client/public, and bundled under client/src. */
const ROOTS = [
  { base: PUBLIC_ROOT, dir: join(PUBLIC_ROOT, "assets"), prefix: "/" },
  { base: SRC_ROOT, dir: join(SRC_ROOT, "assets"), prefix: "@/" },
];

function walk(dir: string, base: string, prefix: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, base, prefix, out);
    else if (IMAGE_EXT.test(name)) out.push(prefix + relative(base, path).split(/[\\/]/).join("/"));
  }
  return out;
}

function toDisk(url: string): string {
  return url.startsWith("@/") ? join(SRC_ROOT, url.slice(2)) : join(PUBLIC_ROOT, url.replace(/^\//, ""));
}

const onDisk = ROOTS.flatMap((r) => {
  try { return walk(r.dir, r.base, r.prefix); } catch { return []; }
}).sort();

/** Source files that could reference art, excluding the registry's own machinery. */
function sourceFiles(): string[] {
  const roots = ["client/src", "server", "shared"];
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name === "generated") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (/\.(tsx?|jsx?|css|html)$/.test(name)) out.push(path);
    }
  };
  for (const root of roots) if (existsSync(join(REPO, root))) visit(join(REPO, root));
  return out;
}

describe("asset manifest tracks the filesystem", () => {
  it("every image on disk is in the generated manifest", () => {
    const known = new Set(allAssets().map((a) => a.url));
    const missing = onDisk.filter((url) => !known.has(url));
    expect(
      missing,
      `${missing.length} image(s) exist on disk but are absent from the manifest. ` +
        `Run \`npm run assets:scan\`, then classify them in ASSET_GROUPS.`,
    ).toEqual([]);
  });

  it("every manifest entry points at a file that exists", () => {
    const gone = allAssets()
      .map((a) => a.url)
      .filter((url) => !existsSync(toDisk(url)));
    expect(gone, `Registry entries point at missing files: ${gone.join(", ")}`).toEqual([]);
  });
});

describe("registry classifies everything", () => {
  it("every image on disk falls into exactly one asset group", () => {
    const unclassified = onDisk.filter((url) => groupFor(url) === null);
    expect(
      unclassified,
      `${unclassified.length} image(s) match no group in ASSET_GROUPS. Add a group ` +
        `declaring surface, status, style and pivot — that declaration is the only ` +
        `record of what the art is for.`,
    ).toEqual([]);
  });

  it("no two groups declare the same id", () => {
    const ids = ASSET_GROUPS.map((g) => g.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("every group actually covers at least one file", () => {
    const covered = new Set(allAssets().map((a) => a.group.id));
    const empty = ASSET_GROUPS.filter((g) => !covered.has(g.id)).map((g) => g.id);
    expect(empty, `Groups matching nothing on disk (stale after a move or delete): ${empty}`).toEqual([]);
  });

  it("a group that is not rendered declares no loader, and a live one declares at least one", () => {
    for (const group of ASSET_GROUPS) {
      if (group.status === "live") {
        expect(group.loadedBy.length, `Group ${group.id} is live but names no loader`).toBeGreaterThan(0);
      } else if (group.status === "source" || group.status === "reference" || group.status === "unused") {
        expect(group.loadedBy, `Group ${group.id} is ${group.status} but names a loader`).toEqual([]);
      }
    }
  });

  it("every declared loader path exists", () => {
    for (const group of ASSET_GROUPS) {
      for (const loader of group.loadedBy) {
        expect(existsSync(join(REPO, loader)), `${group.id} names a loader that does not exist: ${loader}`).toBe(true);
      }
    }
  });
});

describe("game surfaces only reference registered art", () => {
  // Three reference forms, and conflating them produced two rounds of false
  // positives before this was written down:
  //   "/assets/x"        served at runtime from client/public
  //   "@/assets/x"       bundler import via the "@" alias -> client/src
  //   "../assets/x"      bundler import relative to the importing file
  // Only the first is a runtime URL. The other two are build-time and resolve
  // against the filesystem, so they must be checked against disk, not the URL map.
  // Match any quoted image path, then keep the ones that address the asset tree.
  // An earlier version folded that filter into the pattern and required "/assets/"
  // to appear AFTER the leading slash, so plain "/assets/x.png" never matched and
  // the check silently passed on everything. Keep the two steps separate.
  const literal =
    /["'`]((?:@\/|\.{1,2}\/|\/)[^"'`\s()]*\.(?:png|jpe?g|webp|svg|gif|avif))["'`]/g;
  const addressesAssets = (raw: string) => /(^|\/)assets\//.test(raw);
  // Paths built at runtime cannot be checked statically. Their groups carry
  // `dynamic: true` instead, which is where that contract is recorded.
  const isTemplate = (raw: string) => raw.includes("${");

  it("no source file references an /assets/ path that is not registered", () => {
    const known = new Set(KNOWN_MISSING_REFERENCES);
    const offences: string[] = [];
    for (const file of sourceFiles()) {
      if (file.endsWith("registry.test.ts")) continue; // its own examples are not references
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(literal)) {
        const raw = match[1];
        if (!addressesAssets(raw) || isTemplate(raw)) continue;
        if (raw.startsWith("/")) {
          // Runtime URL. Normalize any ".." segments before looking it up.
          const url = "/" + relative(PUBLIC_ROOT, resolve(PUBLIC_ROOT, raw.slice(1))).split(/[\\/]/).join("/");
          if (assetByUrl(url) || known.has(url) || existsSync(toDisk(url))) continue;
          offences.push(`${relative(REPO, file)} -> ${url}`);
        } else {
          // Build-time import. Resolve against the alias or the importing file.
          const abs = raw.startsWith("@/")
            ? join(SRC_ROOT, raw.slice(2))
            : resolve(dirname(file), raw);
          if (existsSync(abs)) continue;
          offences.push(`${relative(REPO, file)} -> ${raw} (unresolved import)`);
        }
      }
    }
    expect(
      offences,
      `A surface references art that is not in the registry (missing file, typo, or ` +
        `an asset added without running \`npm run assets:scan\`):\n${offences.join("\n")}`,
    ).toEqual([]);
  });

  it("no source file renders a retired asset", () => {
    const retired = Object.keys(RETIRED_ASSETS);
    const offences: string[] = [];
    for (const file of sourceFiles()) {
      // Skip the files whose job is to NAME retired art: the retirement lists
      // themselves, and the tests that assert art stays retired.
      if (file.endsWith("buildingArt.ts") || file.endsWith("registry.ts")) continue;
      if (/\.(test|spec)\.tsx?$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const name of retired) {
        if (text.includes(name)) offences.push(`${relative(REPO, file)} -> ${name}: ${RETIRED_ASSETS[name]}`);
      }
    }
    expect(offences, `Retired art is being rendered again:\n${offences.join("\n")}`).toEqual([]);
  });

  it("the canonical building art in buildingArt.ts is registered and live", () => {
    const text = readFileSync(join(REPO, "client/src/components/admin/control-room/buildingArt.ts"), "utf8");
    const paths = [...text.matchAll(/\$\{ASSETS\}\/([A-Za-z0-9_\-.]+\.png)/g)].map(
      (m) => `/assets/admin/control-room/tower-wars/${m[1]}`,
    );
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const entry = assetByUrl(path);
      expect(entry, `buildingArt.ts renders unregistered art: ${path}`).not.toBeNull();
      expect(entry?.status, `buildingArt.ts renders non-live art: ${path}`).toBe("live");
    }
  });
});

describe("recorded missing references stay accurate", () => {
  it("every recorded missing reference is still genuinely missing", () => {
    const resurrected = KNOWN_MISSING_REFERENCES.filter((url) => existsSync(toDisk(url)));
    expect(
      resurrected,
      `These now exist, so remove them from KNOWN_MISSING_REFERENCES: ${resurrected.join(", ")}`,
    ).toEqual([]);
  });
});

describe("recorded duplicates stay accurate", () => {
  it("each duplicate set really is byte-identical", () => {
    for (const set of DUPLICATE_SETS) {
      const shas = set.map((url) => {
        const entry = assetByUrl(url);
        expect(entry, `DUPLICATE_SETS names a file that is not registered: ${url}`).not.toBeNull();
        return entry?.sha256;
      });
      expect(new Set(shas).size, `No longer identical, so this set should be removed: ${set.join(" / ")}`).toBe(1);
    }
  });

  it("no unrecorded duplicate pairs exist", () => {
    const recorded = new Set(DUPLICATE_SETS.flat());
    const bySha = new Map<string, string[]>();
    for (const asset of allAssets()) {
      bySha.set(asset.sha256, [...(bySha.get(asset.sha256) ?? []), asset.url]);
    }
    const unrecorded = [...bySha.values()].filter(
      (urls) => urls.length > 1 && urls.some((u) => !recorded.has(u)),
    );
    expect(
      unrecorded,
      `The same picture is stored twice without being recorded in DUPLICATE_SETS. ` +
        `This is how art gets regenerated that already exists.`,
    ).toEqual([]);
  });
});

describe("style contract", () => {
  it("art in a shared art space declares a pivot that matches the convention", () => {
    for (const group of ASSET_GROUPS) {
      if (!group.artSpace) continue;
      expect(
        ["center_bottom", "top_left"],
        `Group ${group.id} shares an art space, so it must anchor to the footprint or the frame`,
      ).toContain(group.pivot);
    }
  });

  it("nothing rendered is tagged not_rendered", () => {
    const wrong = ASSET_GROUPS.filter((g) => g.style === "not_rendered" && g.loadedBy.length > 0 && g.surface !== "lantern_city");
    expect(wrong.map((g) => g.id)).toEqual([]);
  });
});
