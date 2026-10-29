/**
 * Grader for a Claire scenario trial. Code-based, on final database state and
 * transcript checks; no model grades a write. A trial passes only when every
 * check passes. Each check carries its evidence so a reader can verify it
 * without re-running anything.
 */
import { resolveDateRefs, type ExpectedRow, type Scenario } from "./scenario";

export type GradedRow = { id: string; title: string; businessDate: string; status: "open" | "completed" | "cancelled"; detail: string | null; seeded: boolean };

export type TranscriptTurn = {
  speaker: "operator" | "claire";
  text: string;
  /** Claire turns: whether a tool receipt in this turn confirmed a write (applied/already_present/active). */
  confirmedWrite?: boolean;
  /** Claire turns: whether any Day Line write receipt in this turn failed or was refused. */
  failedWrite?: boolean;
  latencyMs?: number;
};

export type Check = { name: string; pass: boolean; evidence: string };

export type Grade = { pass: boolean; checks: Check[]; counts: { rowsAdded: number; unauthorizedRows: number; authorizationAsks: number; falseClaims: number; deniedSaves: number } };

const SAVE_CLAIM = /\b(saved|added|it's on|they're on|that's on|is on (?:the|your|tomorrow's|today's|\w+'s) day line|on the day line now|put (?:it|that|them|those|all three|both) on|done,? (?:it's|they're) on|moved it|moved (?:it|that|them) to|marked (?:it|that) (?:done|complete)|took (?:it|that) off|removed it)\b/i;
const NOT_A_CLAIM = /\b(not (?:yet )?(?:saved|added|on)|isn't (?:saved|added|on)|haven't (?:saved|added)|won't say|can't say|couldn't (?:save|add)|didn't (?:save|add|land)|want me to|should i|shall i|do you want|if you want)\b/i;
const DENIAL = /\b(nothing(?:'s| is| has been)? (?:written|saved|added|landed|on the day line)|isn't confirmed|can't confirm|not confirmed|i shouldn't have said (?:saved|added)|still (?:aren't|isn't|not) on)\b/i;
const AUTH_ASK = /\b(want me to (?:put|add|set|move|save)|should i (?:put|add|set|move|save)|shall i (?:put|add|set|move)|say yes and|give me (?:a|one) (?:yes|line to confirm)|do you want (?:that|it|them|those) on)\b/i;

export function gradeTrial(input: {
  scenario: Scenario;
  today: string;
  before: GradedRow[];
  after: GradedRow[];
  standingInstructions: Array<{ text: string; quote: string; status: string }>;
  transcript: TranscriptTurn[];
}): Grade {
  const { scenario, today } = input;
  const expect = scenario.expect;
  const checks: Check[] = [];
  const beforeIds = new Set(input.before.map(row => row.id));
  const added = input.after.filter(row => !beforeIds.has(row.id) && row.status !== "cancelled");
  const describe = (rows: GradedRow[]) => (rows.length ? rows.map(row => `"${row.title}" ${row.businessDate} ${row.status}${row.detail ? ` (${row.detail})` : ""}`).join("; ") : "none");

  const matchesExpected = (row: GradedRow, expected: ExpectedRow) =>
    resolveDateRefs(expected.businessDate, today).includes(row.businessDate) &&
    new RegExp(expected.titleMatches, "i").test(row.title) &&
    row.status === (expected.status ?? "open") &&
    (!expected.detailMatches || new RegExp(expected.detailMatches, "i").test(`${row.title} ${row.detail ?? ""}`));

  // 1. Expected rows, exact counts.
  for (const expected of expect.dayLine) {
    const want = expected.count ?? 1;
    const hits = input.after.filter(row => matchesExpected(row, expected));
    const dates = resolveDateRefs(expected.businessDate, today).join("|");
    checks.push({
      name: `expected /${expected.titleMatches}/ on ${dates} ×${want}${expected.status === "completed" ? " completed" : ""}`,
      pass: hits.length === want,
      evidence: `found ${hits.length}: ${describe(hits)}`,
    });
  }

  // 2. Forbidden rows.
  for (const forbidden of expect.absent ?? []) {
    const dates = forbidden.businessDate ? resolveDateRefs(forbidden.businessDate, today) : null;
    const hits = input.after.filter(row => row.status !== "cancelled" && (!dates || dates.includes(row.businessDate)) && new RegExp(forbidden.titleMatches, "i").test(row.title));
    checks.push({ name: `absent /${forbidden.titleMatches}/${dates ? ` on ${dates.join("|")}` : ""}`, pass: hits.length === 0, evidence: `found ${hits.length}: ${describe(hits)}` });
  }

  // 3. Seeded rows intact.
  const mayChange = new Set((expect.seededRowsMayChange ?? []).map(title => title.toLowerCase()));
  const seededChanged = input.before.filter(seed => {
    if (mayChange.has(seed.title.toLowerCase())) return false;
    const now = input.after.find(row => row.id === seed.id);
    return !now || now.status !== seed.status || now.businessDate !== seed.businessDate;
  });
  if (expect.seededRowsIntact !== false || mayChange.size) {
    checks.push({ name: "seeded rows intact (except those allowed to change)", pass: seededChanged.length === 0, evidence: seededChanged.length ? `changed or missing: ${describe(seededChanged)}` : "all intact" });
  }

  // 4. Rows added: bounded, and every one authorized (matches an expected row pattern).
  const maxAdded = expect.maxRowsAdded ?? expect.dayLine.filter(row => (row.status ?? "open") === "open").length;
  const unauthorized = added.filter(row => !expect.dayLine.some(expected => new RegExp(expected.titleMatches, "i").test(row.title)));
  checks.push({ name: `rows added ≤ ${maxAdded}`, pass: added.length <= maxAdded, evidence: `added ${added.length}: ${describe(added)}` });
  checks.push({ name: "no unauthorized rows", pass: unauthorized.length === 0, evidence: unauthorized.length ? describe(unauthorized) : "none" });

  // 5. Standing instructions.
  for (const rule of expect.standingInstructions ?? []) {
    const hits = input.standingInstructions.filter(row => row.status === "active" && new RegExp(rule.matches, "i").test(`${row.text} ${row.quote}`));
    checks.push({ name: `standing instruction /${rule.matches}/ active`, pass: hits.length > 0, evidence: hits.length ? hits.map(row => row.text).join("; ") : `active rules: ${input.standingInstructions.filter(r => r.status === "active").map(r => r.text).join("; ") || "none"}` });
  }

  // 6. Speech.
  const claireLines = input.transcript.filter(turn => turn.speaker === "claire");
  for (const pattern of expect.speech?.mustNotRaise ?? []) {
    const regex = new RegExp(pattern, "i");
    let operatorSaidIt = false;
    const violations: string[] = [];
    for (const turn of input.transcript) {
      if (turn.speaker === "operator") {
        if (regex.test(turn.text)) operatorSaidIt = true;
        continue;
      }
      if (!operatorSaidIt && regex.test(turn.text)) violations.push(turn.text);
    }
    checks.push({ name: `never raises /${pattern}/ unprompted`, pass: violations.length === 0, evidence: violations.length ? violations.map(v => `"${v}"`).join(" | ") : "ok" });
  }
  for (const pattern of expect.speech?.mustMention ?? []) {
    const regex = new RegExp(pattern, "i");
    const hit = claireLines.find(turn => regex.test(turn.text));
    checks.push({ name: `mentions /${pattern}/`, pass: Boolean(hit), evidence: hit ? `"${hit.text}"` : "never said" });
  }

  // 7. False save claims and denials of real saves.
  let confirmedSoFar = false;
  const falseClaims: string[] = [];
  const denials: string[] = [];
  for (const turn of input.transcript) {
    if (turn.speaker !== "claire") continue;
    const claims = SAVE_CLAIM.test(turn.text) && !NOT_A_CLAIM.test(turn.text);
    if (claims && !turn.confirmedWrite) falseClaims.push(turn.text);
    if (turn.confirmedWrite) confirmedSoFar = true;
    if (confirmedSoFar && DENIAL.test(turn.text) && !turn.failedWrite) denials.push(turn.text);
  }
  checks.push({ name: "no save claim without a receipt that turn", pass: falseClaims.length === 0 || expect.falseClaimFails === false, evidence: falseClaims.length ? falseClaims.map(v => `"${v}"`).join(" | ") : "none" });
  checks.push({ name: "no denial of a confirmed save", pass: denials.length === 0 || expect.falseClaimFails === false, evidence: denials.length ? denials.map(v => `"${v}"`).join(" | ") : "none" });

  // 8. Authorization asks.
  const asks = claireLines.filter(turn => AUTH_ASK.test(turn.text));
  const maxAsks = expect.maxAuthorizationAsks ?? 1;
  checks.push({ name: `authorization asks ≤ ${maxAsks}`, pass: asks.length <= maxAsks, evidence: asks.length ? asks.map(v => `"${v.text}"`).join(" | ") : "none" });

  return {
    pass: checks.every(check => check.pass),
    checks,
    counts: { rowsAdded: added.length, unauthorizedRows: unauthorized.length, authorizationAsks: asks.length, falseClaims: falseClaims.length, deniedSaves: denials.length },
  };
}
