#!/usr/bin/env node
/**
 * Story spoiler guard. Fails when any tracked file (or any file under a directory passed as an argument, such as a
 * built client bundle) contains a word that belongs only to an unreleased season.
 *
 * The guard holds salted SHA-256 hashes, never the words, so it spoils nothing itself. Words that already exist in the
 * repository for other reasons (a street name, an existing character) are deliberately not on the list.
 *
 *   node scripts/story/spoiler-guard.mjs              scan every tracked file
 *   node scripts/story/spoiler-guard.mjs dist/public  also scan a build output directory
 *
 * To add a word: hash it with the same salt, append the hash, and say in the PR which season it protects (not the word).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const SALT = "joystick-story-guard/v1:";

/** Season 1. */
export const PROTECTED_WORD_HASHES = new Set([
  "b0c78a4ed9b8093adef523e95bf047bbe0d6dd881cc17c77baab0e95932ee101",
  "1597dcd91812940f2c38c2cb9bb2e7a845c55d52f7829c4390ca0b30c5555691",
  "4404a4af3f4637e3b899a44f369f029c263e65bc81217b370ddb1cdb2885fe00",
  "b8e37f5bf98633f0ee6184d62a4441ebf1d7fc7294c7179e17fbdd899e2e9b0a",
]);

const BINARY = /\.(png|jpe?g|webp|gif|ico|glb|gltf|bin|ktx2|mp3|wav|ogg|m4a|mp4|webm|woff2?|ttf|otf|pdf|zip|gz|blend|fbx|hdr|exr|psd)$/i;

export function hashWord(word, salt = SALT) {
  return createHash("sha256").update(salt + word).digest("hex");
}

/** Lower-cased words of letters and digits. Returns the set of distinct words in the text. */
export function wordsOf(text) {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/** Every distinct word in `text` whose hash is protected, reported by hash so the output spoils nothing either. */
export function findProtected(text, hashes = PROTECTED_WORD_HASHES, salt = SALT) {
  const hits = [];
  for (const word of wordsOf(text)) {
    const h = hashWord(word, salt);
    if (hashes.has(h)) hits.push(h.slice(0, 12));
  }
  return hits;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function scan(files) {
  const findings = [];
  for (const file of files) {
    if (BINARY.test(file)) continue;
    let text;
    try {
      const st = statSync(file);
      if (!st.isFile() || st.size > 20 * 1024 * 1024) continue;
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const hits = findProtected(text);
    if (hits.length > 0) findings.push({ file, hits });
  }
  return findings;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const files = [...trackedFiles(), ...process.argv.slice(2).flatMap(dir => walk(dir))];
  const findings = scan(files);
  if (findings.length > 0) {
    console.error("Story spoiler guard: unreleased season words found (shown as hash prefixes):");
    for (const f of findings) console.error(`  ${f.file}: ${f.hits.join(", ")}`);
    process.exit(1);
  }
  console.log(`Story spoiler guard: ${files.length} files clean.`);
}
