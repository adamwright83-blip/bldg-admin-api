/**
 * Does one description of work plausibly refer to the same item as another?
 *
 * "Dubois regulation" and "Regulate the action on Mr. Dubois's upright" are the
 * same job said two ways (run 20 created a duplicate). "Mow the Kessler lawn"
 * on Monday and on the next Monday are two legitimate rows. So this answers
 * only "plausibly the same work", conservatively, and the caller decides what
 * to do with a plausible match on another day: never merge silently, resolve.
 *
 * Matching: possessives stripped, honorifics dropped, tokens compared by a
 * short stem (the first five letters: regul-ation / regul-ate, deliver-y /
 * deliver). Two titles plausibly match when they share a proper name, or at
 * least two stems that are not generic work words.
 */
import { GENERIC_WORK_WORDS, normalizeWords } from "./authorization";

const HONORIFICS = new Set(["mr", "mrs", "ms", "dr", "miss", "sir", "madam"]);
const FILLER = new Set(["the", "a", "an", "at", "to", "for", "of", "and", "then", "with", "from", "into", "on", "in", "up", "out", "off", "by", "about", "his", "her", "their", "our", "my", "your", "new", "old", "that", "this", "it", "its"]);

export function stem(token: string): string {
  const base = token.replace(/'s$|'$/, "");
  return base.length > 5 ? base.slice(0, 5) : base;
}

/** Content stems of a title, honorifics and filler removed. */
export function workStems(title: string): string[] {
  return [
    ...new Set(
      normalizeWords(title)
        .split(" ")
        .map(token => token.replace(/'s$|'$/, ""))
        .filter(token => token.length >= 3 && !FILLER.has(token) && !HONORIFICS.has(token))
        .map(stem)
    ),
  ];
}

/** Proper-name stems in a title: capitalized words after the first, honorifics excluded. */
export function properStems(title: string): string[] {
  return [
    ...new Set(
      title
        .replace(/[’‘]/g, "'")
        .split(/\s+/)
        .slice(1)
        .filter(word => /^[A-Z][A-Za-z'.-]*$/.test(word))
        .map(word => normalizeWords(word))
        .filter(word => word.length >= 3 && !HONORIFICS.has(word) && !/^(the|a|an|at|in|on|to|for|with|and|of|from|by)$/.test(word))
        .map(stem)
    ),
  ];
}

export type WorkMatch = {
  /** Strict: safe to treat as the same job for duplicate prevention. */
  plausible: boolean;
  /** Loose: worth showing as a candidate when searching; the model decides. */
  candidate: boolean;
  sharedProper: string[];
  sharedStems: string[];
};

export function matchWork(a: string, b: string): WorkMatch {
  const properA = new Set(properStems(a));
  const properB = new Set(properStems(b));
  const stemsA = new Set(workStems(a));
  const stemsB = new Set(workStems(b));
  const generic = new Set([...GENERIC_WORK_WORDS, "job", "jobs", "thing", "item", "task", "run", "stop"].map(stem));
  // Proper names in one title may be lower-cased in the other ("the dubois job").
  const properEither = new Set([...properA, ...properB]);
  const sharedProper = [...properEither].filter(token => stemsA.has(token) && stemsB.has(token));
  const sharedStems = [...stemsA].filter(token => stemsB.has(token) && !generic.has(token) && !properEither.has(token));
  // A place name alone ("… at Opus") is shared by many different jobs: strict needs a second signal.
  const plausible = sharedProper.length >= 2 || (sharedProper.length >= 1 && sharedStems.length >= 1) || sharedStems.length >= 2;
  const candidate = plausible || sharedProper.length >= 1 || sharedStems.length >= 1;
  return { plausible, candidate, sharedProper, sharedStems };
}

export function plausibleSameWork(a: string, b: string): boolean {
  return matchWork(a, b).plausible;
}
