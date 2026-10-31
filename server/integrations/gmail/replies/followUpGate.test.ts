import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The reply gate, as a ratchet. Nothing sends an automated follow-up yet:
 * followUpVerdict (./trackedConversations) has no production caller, and the
 * only module that sends through sendApprovedEmail is the first-ten activation,
 * which sends the one message the person approved at the writing table. It is
 * a first message, not a follow-up written for silence.
 *
 * Any other module that sends through sendApprovedEmail must also import and
 * call followUpVerdict, so a future automated follow-up can't skip the check
 * that holds it once the person has written back or the address has bounced.
 * And nothing but gmailSend.ts may post to Gmail's send endpoint, so a sender
 * can't step around sendApprovedEmail altogether.
 */

const root = join(import.meta.dirname, "../../../..");
const serverDir = join(root, "server");

/** First sends the person approved word for word; not follow-ups. */
const FIRST_SEND_EXEMPT = new Set(["server/firstTenMinutes/activation/activation.ts"]);
const SEND_MODULE = "server/integrations/gmail/gmailSend.ts";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(name) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name) && !/\.testSupport\.[cm]?[jt]sx?$/.test(name)
      ? [path]
      : [];
  });
}

const files = sourceFiles(serverDir).map(path => ({
  path: relative(root, path).replaceAll("\\", "/"),
  source: readFileSync(path, "utf8"),
}));

const usesSendApprovedEmail = (source: string) => /\bsendApprovedEmail\b/.test(source);
const importsVerdict = (source: string) =>
  /import\s*(?:type\s+)?\{[^}]*\bfollowUpVerdict\b[^}]*\}\s*from\s*["'][^"']*\/trackedConversations["']/.test(source) ||
  /import\(\s*["'][^"']*\/trackedConversations["']\s*\)/.test(source);
const callsVerdict = (source: string) => /\bfollowUpVerdict\s*\(/.test(source);

describe("automated follow-ups pass the reply gate", () => {
  it("finds the modules it is guarding (the scan is not looking at nothing)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some(file => file.path === SEND_MODULE && /export async function sendApprovedEmail\b/.test(file.source))).toBe(true);
    expect(
      files.some(file => file.path === "server/integrations/gmail/replies/trackedConversations.ts" && /export async function followUpVerdict\b/.test(file.source))
    ).toBe(true);
    for (const exempt of FIRST_SEND_EXEMPT) {
      expect(files.some(file => file.path === exempt && usesSendApprovedEmail(file.source))).toBe(true);
    }
  });

  it("every sender other than the first-ten activation imports and calls followUpVerdict", () => {
    const ungated = files
      .filter(file => file.path !== SEND_MODULE && !FIRST_SEND_EXEMPT.has(file.path))
      .filter(file => usesSendApprovedEmail(file.source))
      .filter(file => !(importsVerdict(file.source) && callsVerdict(file.source)))
      .map(file => file.path);
    expect(ungated).toEqual([]);
  });

  it("only gmailSend.ts posts to Gmail's send endpoint", () => {
    const direct = files
      .filter(file => /messages\/send\b/.test(file.source))
      .map(file => file.path);
    expect(direct).toEqual([SEND_MODULE]);
  });

  it("the gate recognises an ungated sender, and a gated one", () => {
    const ungated = 'import { sendApprovedEmail } from "../gmailSend";\nawait sendApprovedEmail(input, deps);';
    const gated =
      'import { sendApprovedEmail } from "../gmailSend";\nimport { followUpVerdict } from "./trackedConversations";\n' +
      "if ((await followUpVerdict(conversation)).proceed) await sendApprovedEmail(input, deps);";
    expect(usesSendApprovedEmail(ungated) && !(importsVerdict(ungated) && callsVerdict(ungated))).toBe(true);
    expect(importsVerdict(gated) && callsVerdict(gated)).toBe(true);
  });
});
