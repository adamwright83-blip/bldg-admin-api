import { z } from "zod";
import type { Scenario } from "./scenarios";
import { geminiJson, type GeminiConfig } from "./synthesis";

/**
 * Two stand-ins for the product test that matters (a real owner, unfamiliar with JOYSTICK, reading the reveal cold).
 * Neither replaces it: both are a model reading lines, and say so in every report.
 *
 *   coldRead      someone who knows nothing reads only the lines: can they tell what this person is after, and what
 *                 the day-to-day would show? If they can't, the significance never reached the page.
 *   ownerProxy    for fictional owners only: a model given the owner's whole situation reacts as them. "That's my
 *                 business" (an accurate inventory) is not the goal; "it sees why" is.
 */

export const coldReadSchema = z.object({
  whatTheyDo: z.string(),
  whatTheyreAfter: z.string(),
  whatTheDayToDayShows: z.string(),
});

export const COLD_READ_SYSTEM = [
  "You are reading, cold, the first few lines a character said to a business owner. The lines are about the owner",
  "(\"you\"), not the speaker. You know nothing else about the owner.",
  "Say, in a sentence each, what a stranger takes away from these lines alone about the OWNER: what they do; what they",
  "seem to be ultimately after; what their day-to-day work would show or achieve toward that. Use what the lines say or",
  "plainly imply. Write 'not said' only when the lines give nothing on it; never fill a gap from outside knowledge.",
].join("\n");

export async function coldRead(gemini: GeminiConfig, lines: readonly string[]) {
  return geminiJson(gemini, { purpose: "cold-read", schema: coldReadSchema, system: COLD_READ_SYSTEM, prompt: lines.join("\n"), thinking: "low", timeoutMs: 30_000 });
}

export const ownerReactionSchema = z.object({
  /** what it told them that they never typed (they typed only their name and email) */
  newToMe: z.array(z.string()),
  wrong: z.array(z.string()),
  /** what would make them uncomfortable: money, family or health stated wrongly or too bluntly */
  uneasy: z.array(z.string()),
  reaction: z.enum(["wrong", "generic", "thats_my_business", "sees_why"]),
  wouldContinue: z.enum(["yes", "maybe", "no"]),
  why: z.string(),
});

export const OWNER_PROXY_SYSTEM = [
  "You play a business owner who has just connected their email and files to a new product and typed nothing but their",
  "name and email. You are given your real situation (what only you know) and the first lines the product said.",
  "React honestly, as that person, not as a reviewer:",
  "newToMe: what it told you that you never typed in. wrong: anything inaccurate. uneasy: anything that would make you",
  "uncomfortable (money, family or health stated wrongly or too bluntly).",
  "reaction: wrong (it got something important wrong); generic (it could say this to anyone); thats_my_business (an",
  "accurate summary of what you do, nothing more); sees_why (it understood why you're doing it, which you never said).",
  "wouldContinue: would you keep going?",
].join("\n");

export async function ownerProxy(gemini: GeminiConfig, scenario: Scenario, lines: readonly string[]) {
  const truth = [
    `You are ${scenario.ownerName}.`,
    `What you are really after: ${scenario.reviewerKey.ultimateObjective}`,
    `What each part of your work is for: ${scenario.reviewerKey.roles.join("; ")}`,
    `What matters most right now: ${scenario.reviewerKey.keyResult}`,
    "Your recent mail and files:",
    ...scenario.privateEvidence.map(e => `- ${e.title}: ${e.text}`),
  ].join("\n");
  return geminiJson(gemini, { purpose: "owner-proxy", schema: ownerReactionSchema, system: OWNER_PROXY_SYSTEM, prompt: `${truth}\n\nWhat the product said first:\n${lines.join("\n")}`, thinking: "low", timeoutMs: 30_000 });
}
