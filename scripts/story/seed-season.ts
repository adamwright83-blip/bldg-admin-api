/**
 * Load a season file into the database.
 *
 *   pnpm exec tsx scripts/story/seed-season.ts <path-to-season.json>
 *   railway run pnpm exec tsx scripts/story/seed-season.ts <path>      (production)
 *
 * The repository holds only the placeholder Season 0 (server/story/fixtures/season-0.json). Real seasons live outside
 * the repository and are passed in by path. The file is validated first; nothing is written if it is invalid. This
 * script prints counts only, never text, so a season's words never land in a terminal log or CI output.
 */
import { readFile } from "node:fs/promises";
import { storySeasonSchema } from "../../shared/story";
import { seedStorySeason } from "../../server/story/storyStore";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: tsx scripts/story/seed-season.ts <path-to-season.json>");
    process.exit(2);
  }
  const parsed = storySeasonSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
  if (!parsed.success) {
    // Issue paths and messages only; zod messages from this schema never echo line text.
    for (const issue of parsed.error.issues) console.error(`invalid: ${issue.path.join(".") || "(season)"}: ${issue.message}`);
    process.exit(1);
  }
  const result = await seedStorySeason(parsed.data);
  console.log(`seeded season "${parsed.data.slug}": id ${result.seasonId}, ${result.chapters} chapters, ${result.lines} lines`);
  process.exit(0);
}

main().catch(error => {
  console.error("seed failed:", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
