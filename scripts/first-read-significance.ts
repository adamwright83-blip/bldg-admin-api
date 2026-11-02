/**
 * Why their work matters, tested apart from what Claire says (server/businessKnowledge/firstRead/significance.ts), and
 * the fast path to the first reveal. NOT run by CI. Read-only; writes nothing to the database; nothing to analytics;
 * reports readable by you only.
 *
 *   scripts/first-read-significance.sh --scenarios all
 *     fictional owners: verified facts → significance (graded against a reviewer's key the model never sees) → reveal
 *
 *   scripts/first-read-significance.sh --journey <own journey id> --i-have-authorization --fast [--runs 3]
 *       [--sig-thinking low|medium] [--reveal-thinking low|medium]   (default low: the first-minute budget)
 *     a real account, timed from completed Google authorization: Gmail and Drive at once, the reading, the
 *     significance, the first reveal. Public research is progressive (PublicResearchRun): their own profiles are
 *     searched for from the start; Places and the wider web search start once the businesses are named; X starts
 *     once a search confirms their handle. Whatever has landed when the significance starts goes into the first
 *     reveal (it waits for what is running until --public-wait seconds after authorization, default 20); the rest feeds the second
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

process.env.POSTHOG_AI_CAPTURE_CONTENT = "0";
delete process.env.POSTHOG_PROJECT_TOKEN;

const args = process.argv.slice(2);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const refuse = (message: string): never => {
  console.error(`Refusing: ${message}`);
  process.exit(2);
};

type Synth = typeof import("../server/businessKnowledge/firstRead/synthesis");
type Sig = typeof import("../server/businessKnowledge/firstRead/significance");
type CheckedClaim = import("../server/businessKnowledge/firstRead/synthesis").CheckedClaim;
type Significance = import("../server/businessKnowledge/firstRead/significance").Significance;
type RevealResult = import("../server/businessKnowledge/firstRead/reveal").RevealResult;
type Grounded = import("../server/businessKnowledge/firstRead/significance").GroundedSignificance;
type Reader = typeof import("../server/businessKnowledge/firstRead/readerTest");

const STATED = new Set(["active", "in_progress", "fiction", "open_problem", "happened", "ended", "relationship"]);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "undated");

function reasoningSection(claims: readonly CheckedClaim[], sig: Significance | null, issues: string[], sigLines: Sig["significanceLines"], grounded?: Grounded | null): string[] {
  const lines = ["### 1. Verified facts", ""];
  for (const c of claims.filter(c => STATED.has(c.verdict) || c.verdict === "status_unknown")) lines.push(`- ${c.statement} _(${c.verdict}${c.partOf ? ` of ${c.partOf}` : ""}; source dated ${day(c.lastSeen)})_`);
  if (!sig) return [...lines, "", "Significance failed.", ...issues.map(i => `- ${i}`)];
  const all = sigLines(sig);
  lines.push("", "### 2. Inferred and verified relationships (with evidence and uncertainty)", "", ...all.filter(l => /^[AR]\d/.test(l)).map(l => `- ${l}`));
  lines.push("", "### 3. Their larger objective", "", ...all.filter(l => /^O\d/.test(l)).map(l => `- ${l}`), `- ${all.find(l => l.startsWith("Business is the end")) ?? ""}`);
  lines.push("", "### 4. The result that matters most, and why", "", `- ${all.find(l => l.startsWith("K ")) ?? ""}`, ...all.filter(l => l.startsWith("T ")).map(l => `- ${l}`));
  lines.push("", "### 5. What it still doesn't know", "", ...sig.unknowns.map(u => `- ${u}`));
  if (issues.length) lines.push("", "Checker notes on the reasoning:", ...issues.map(i => `- ${i}`));
  if (grounded) lines.push("", "Checked against the source text:", ...(grounded.issues.length ? grounded.issues.map(i => `- ${i}`) : ["- every conclusion held up"]));
  return lines;
}

function revealSection(reveal: RevealResult): string[] {
  const lines = ["### Claire's first words", ""];
  if (!reveal.spotlight && reveal.reveal) lines.push(`Spotlight UNRESOLVED: the model named "${reveal.reveal.spotlight.item}"`, "");
  if (reveal.spotlight) lines.push(`Spotlight: ${reveal.spotlight.item} — ${reveal.spotlight.text}${reveal.spotlight.carried ? "" : " — NOT CARRIED by any kept line"}${reveal.spotlight.repaired ? " (took the repair pass)" : ""}`, "");
  const kept = reveal.lines.filter(l => l.kept);
  lines.push(kept.length ? kept.map(l => `> ${l.line}`).join("\n>\n") : "> (nothing survived the checks)", "");
  for (const l of reveal.lines) lines.push(`- ${l.kept ? "SAID" : "STRUCK"} [${l.basis}] “${l.line}” — rests on ${l.rests.join(", ")}${l.why ? ` — ${l.why}` : ""}`);
  for (const call of reveal.calls) if (call.error) lines.push(`- ${call.purpose} FAILED: ${call.error}`);
  return lines;
}

async function readerSection(reader: Reader, gemini: Parameters<Reader["coldRead"]>[0], lines: string[], scenario?: import("../server/businessKnowledge/firstRead/scenarios").Scenario): Promise<{ out: string[]; reaction?: string }> {
  const out = ["### Read cold (a model stand-in: not the human test)", ""];
  if (!lines.length) return { out: [...out, "- nothing to read"] };
  const [cold, owner] = await Promise.all([reader.coldRead(gemini, lines), scenario ? reader.ownerProxy(gemini, scenario, lines) : Promise.resolve(null)]);
  out.push(cold.value ? `- a stranger reading only these lines: does: ${cold.value.whatTheyDo} | after: ${cold.value.whatTheyreAfter} | the day-to-day shows: ${cold.value.whatTheDayToDayShows}` : `- cold read failed: ${cold.call.error}`);
  const o = owner?.value;
  if (o) out.push(`- the owner (model playing them): ${o.reaction}; would continue: ${o.wouldContinue}. ${o.why}`, `  - new to them: ${o.newToMe.join("; ") || "nothing"}`, ...(o.wrong.length ? [`  - WRONG: ${o.wrong.join("; ")}`] : []), ...(o.uneasy.length ? [`  - UNEASY: ${o.uneasy.join("; ")}`] : []));
  else if (owner) out.push(`- owner proxy failed: ${owner.call.error}`);
  return { out, reaction: o?.reaction };
}

async function main() {
  const synth: Synth = await import("../server/businessKnowledge/firstRead/synthesis");
  const sig: Sig = await import("../server/businessKnowledge/firstRead/significance");
  const { runReveal } = await import("../server/businessKnowledge/firstRead/reveal");
  const reader: Reader = await import("../server/businessKnowledge/firstRead/readerTest");
  const geminiKey = process.env.GEMINI_API_KEY?.trim() || refuse("GEMINI_API_KEY isn't set.");
  const gemini = { apiKey: geminiKey, model: value("--model") ?? "gemini-3.8-flash", thinking: "low" as const };
  const out: string[] = [];

  const which = value("--scenarios");
  if (which) {
    const { SCENARIOS } = await import("../server/businessKnowledge/firstRead/scenarios");
    const chosen = which === "all" ? SCENARIOS : SCENARIOS.filter(s => which.split(",").includes(s.key));
    const results = await Promise.all(
      chosen.map(async s => {
        const { value: reading, call } = await synth.geminiReading(gemini, { question: "combined", evidence: s.privateEvidence, today: s.today });
        if (!reading) return { s, error: call.error };
        const judged = await synth.judgeClaims(gemini, synth.checkClaims(reading, s.privateEvidence, s.today), s.privateEvidence, s.today, reading.opening);
        const input = { claims: judged.claims, publicFindings: s.publicFindings, today: s.today, ownerName: s.ownerName };
        const significance = await sig.runSignificance(gemini, { ...input, evidence: s.privateEvidence });
        const grounded = significance.significance ? await sig.groundSignificance(gemini, significance.significance, { ...input, evidence: s.privateEvidence }) : null;
        // graded BEFORE any dialogue exists, against a key the reasoning never saw
        const grade = grounded ? await sig.gradeReasoning(gemini, grounded.significance, s.reviewerKey) : null;
        const reveal = await runReveal(gemini, { ...input, evidence: s.privateEvidence, significance: significance.significance, grounded });
        const read = await readerSection(reader, gemini, reveal.lines.filter(l => l.kept).map(l => l.line), s);
        return { s, claims: judged.claims, significance, grounded, grade, reveal, read };
      })
    );
    for (const r of results) {
      out.push(`# Scenario: ${r.s.ownerName} (${r.s.key})`, "");
      if ("error" in r) {
        out.push(`Reading failed: ${r.error}`, "");
        continue;
      }
      out.push(...reasoningSection(r.claims, r.grounded?.significance ?? r.significance.significance, r.significance.issues, sig.significanceLines, r.grounded), "");
      const g = r.grade?.value;
      out.push("### Reasoning graded against the reviewer's key (before Claire spoke)", "");
      out.push(g ? `- objective ${g.objective}; roles ${g.roles}; key result ${g.keyResult}; business-is-the-end ${g.businessIsTheEnd}` : `- grading failed: ${r.grade?.call.error}`);
      if (g?.violations.length) out.push(`- VIOLATIONS: ${g.violations.join("; ")}`);
      if (g?.overreach.length) out.push(`- overreach: ${g.overreach.join("; ")}`);
      if (g) out.push(`- ${g.note}`);
      out.push(`- key (reviewer's, never shown to the model): ${r.s.reviewerKey.ultimateObjective} | ${r.s.reviewerKey.keyResult}`, "");
      out.push(...revealSection(r.reveal), "", ...r.read.out, "", "---", "");
      console.log(`${r.s.key}: objective ${g?.objective ?? "?"}, roles ${g?.roles ?? "?"}, key result ${g?.keyResult ?? "?"}, end ${g?.businessIsTheEnd ?? "?"}${g?.violations.length ? `, VIOLATIONS ${g.violations.length}` : ""}; ${r.reveal.lines.filter(l => l.kept).length} lines kept, spotlight ${r.reveal.spotlight?.carried ? "carried" : "lost"}; owner proxy ${r.read.reaction ?? "?"}; ${r.reveal.lines.filter(l => !l.kept && /sensitive|source never/.test(l.why)).length} sensitive lines struck`);
    }
  }

  const journeyId = value("--journey");
  if (journeyId) {
    if (!args.includes("--i-have-authorization")) refuse("this reads a real person's Gmail and Drive. Pass --i-have-authorization only with their go-ahead.");
    if (!args.includes("--fast")) refuse("--journey runs the fast path here: pass --fast");
    const { coldTestSource, readOnlyFetch } = await import("../server/businessKnowledge/coldTest");
    const { refreshGoogleAccess, googleAccount } = await import("../server/firstTenMinutes/google");
    const { googleResearch } = await import("../server/firstTenMinutes/research/googleResearch");
    const { CoverageLedger } = await import("../server/firstTenMinutes/research/coverage");
    const { fastGmail, fastDrive } = await import("../server/businessKnowledge/firstRead/bench");
    const { PublicResearchRun, identityAnchors } = await import("../server/businessKnowledge/firstRead/publicResearch");
    const publicWaitMs = Number(value("--public-wait") ?? 20) * 1000;
    const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, ms)));
    const { google } = await coldTestSource(journeyId);
    const runs = Number(value("--runs") ?? 1);
    for (let n = 1; n <= runs; n += 1) {
      // t0: Google authorization has just completed (here: the stored grant, refreshed)
      const t0 = Date.now();
      const at = () => Date.now() - t0;
      const tokens = await refreshGoogleAccess({ refreshToken: google.refreshToken! }, { fetch: readOnlyFetch() });
      const tAuth = at();
      const access = { ...google, accessToken: tokens.accessToken, accessExpiresAt: tokens.expiresAt, onRefreshed: async () => undefined };
      const research = googleResearch(access, new CoverageLedger(), { fetch: readOnlyFetch() });
      const accountP = googleAccount(tokens.accessToken);
      const times: Record<string, number> = { auth: tAuth };
      const [gmailEvidence, driveEvidence] = await Promise.all([
        fastGmail(research, new Date()).then(e => ((times["gmail retrieved"] = at()), e)),
        fastDrive(research, new Date(), google.ownerEmail).then(e => ((times["drive retrieved"] = at()), e)),
      ]);
      const evidence = [...gmailEvidence, ...driveEvidence];
      // their own profiles and sites, searched for from the moment the account and sending domains are known
      const account = await accountP;
      const free = /^(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|aol|proton|protonmail)\./i;
      const domains = [...new Set(gmailEvidence.map(e => /from [^<]*<[^@]+@([^>]+)>/.exec(e.people)?.[1]?.toLowerCase()).filter((d): d is string => Boolean(d) && !free.test(d!)))];
      const ownText = evidence.map(e => `${e.title} ${e.people} ${e.text}`).join("\n");
      // organizations current and past, from titles and headers (a few seconds), run beside the reading: the identity
      // search can't tell a common name from a namesake without them
      const readingP = synth.geminiReading(gemini, { question: "combined", evidence, today: new Date() });
      const anchors = await identityAnchors(gemini, evidence, account.name ?? google.ownerEmail);
      times["identity anchors"] = at();
      const pub = new PublicResearchRun(
        { name: account.name ?? google.ownerEmail, email: google.ownerEmail, domains, businesses: [], organizations: anchors.organizations.map(o => o.name), city: null, ownText },
        { fastModel: value("--fast-web-model") ?? "claude-sonnet-5-5", t0 }
      ).start();
      const { value: reading, call } = await readingP;
      times["reading"] = at();
      if (!reading) {
        out.push(`# Fast path run ${n}: reading failed (${call.error})`);
        continue;
      }
      const checked = synth.checkClaims(reading, evidence, new Date());
      // the businesses are named: Places and the wider footprint search start now
      // "Adam Wright operates Laundry Farm, a laundry business" → "Laundry Farm"
      const nameOf = (statement: string) => statement.replace(/^.*?\b(?:operates|runs|owns|manages|is developing|is building|develops|builds|is working on)\s+/i, "").split(/[,.;:(]| - | — | is | was | located | at /)[0].trim();
      const businesses = [...new Set(checked.filter(c => (c.kind === "business" || c.kind === "project") && c.verdict !== "unsupported").map(c => nameOf(c.statement)))].slice(0, 6);
      pub.withBusinesses(businesses);
      const judged = await synth.judgeClaims(gemini, checked, evidence, new Date(), reading.opening);
      times["claims judged"] = at();
      const input = { claims: judged.claims, publicFindings: [], today: new Date(), ownerName: account.name ?? "the owner" };
      const sigThinking = (value("--sig-thinking") ?? "low") as "low" | "medium" | "high";
      const revealThinking = (value("--reveal-thinking") ?? "low") as "low" | "medium" | "high";
      // whatever public research has landed goes into the first reveal; it waits for what's running only so long
      await Promise.race([pub.settled(), sleep(publicWaitMs - at())]);
      times["public cut-off"] = at();
      const firstPublic = pub.snapshot();
      const significance = await sig.runSignificance(gemini, { ...input, publicFindings: firstPublic, evidence }, { thinking: sigThinking });
      times["significance"] = at();
      // the grounding check runs while the opening is written; lines are checked once both land
      const groundedP = significance.significance ? sig.groundSignificance(gemini, significance.significance, { ...input, publicFindings: firstPublic, evidence }).then(g => ((times["grounded"] = at()), g)) : null;
      const first = await runReveal(gemini, { ...input, publicFindings: firstPublic, evidence, significance: significance.significance, grounded: groundedP }, { thinking: revealThinking });
      times["FIRST REVEAL"] = at();
      const grounded = groundedP ? await groundedP : null;

      // the deeper discovery, when public research lands
      await Promise.race([pub.settled(), sleep(Number(value("--public-cap") ?? 150) * 1000 - at())]);
      times["public research settled"] = at();
      const publicFindings = pub.snapshot();
      const deeper = await sig.runSignificance(gemini, { ...input, publicFindings, evidence }, { thinking: sigThinking });
      const deeperGroundedP = deeper.significance ? sig.groundSignificance(gemini, deeper.significance, { ...input, publicFindings, evidence }) : null;
      const second = await runReveal(gemini, { ...input, publicFindings, evidence, significance: deeper.significance, grounded: deeperGroundedP }, { thinking: revealThinking });
      const deeperGrounded = deeperGroundedP ? await deeperGroundedP : null;
      times["second reveal (with public)"] = at();

      out.push(`# Fast path run ${n}: ${account.name}`, "");
      out.push(`Timings from completed authorization: ${Object.entries(times).map(([k, ms]) => `${k} ${(ms / 1000).toFixed(1)} s`).join(" → ")}. The identity search started ${((pub.identityStartedAt ?? 0) / 1000).toFixed(1)} s after authorization (after Gmail and Drive were retrieved and the organizations read from them).`, "");
      out.push(`Evidence: ${gmailEvidence.length} sent messages, ${driveEvidence.length} files.`, "");
      out.push("### Public research, as it landed", "", ...pub.runs.map(r => `- ${r.label}: landed ${(r.at / 1000).toFixed(1)} s after authorization, ${r.findings} findings${r.error ? `, error: ${r.error}` : ""}${r.note ? ` (${r.note})` : ""}`));
      out.push(`- in the first reveal: ${firstPublic.length} public findings (${firstPublic.map(f => `${f.id} ${f.source}`).join(", ") || "none"})`);
      out.push("", `Organizations read from their own mail and files (identity anchors): ${anchors.organizations.map(o => `${o.name} [${o.relation}; ${o.evidence.join(", ")}]`).join("; ") || "none"}${anchors.dropped.length ? `; dropped: ${anchors.dropped.join("; ")}` : ""}`);
      out.push("", "Profiles proposed by the research model (a profile found is not a profile read: only X is read, and only a verified handle):", ...(pub.candidates.length ? pub.candidates.map(c => `- ${c.verified ? "VERIFIED" : "rejected"} ${c.kind}: ${c.value} — proposed by ${c.proposedBy}; ${c.why}${c.verified && c.kind !== "x" && c.kind !== "website" ? "; known from search results only, never opened" : ""}`) : ["- none proposed"]));
      if (pub.rejected.length) out.push("", "Rejected as someone else or unconfirmed:", ...pub.rejected.map(r => `- ${r.text} (${r.why})`));
      out.push("");
      const firstRead = await readerSection(reader, gemini, first.lines.filter(l => l.kept).map(l => l.line));
      out.push("## First reveal (Gmail + Drive)", "", ...reasoningSection(judged.claims, grounded?.significance ?? significance.significance, significance.issues, sig.significanceLines, grounded), "", ...revealSection(first), "", ...firstRead.out, "");
      out.push("## Second, deeper reveal (all public research)", "", `Public findings: ${publicFindings.length}`, ...publicFindings.map(f => `- ${f.id} [${f.source}; ${f.signal}] ${f.text}`), "");
      const deeperSig = deeperGrounded?.significance ?? deeper.significance;
      out.push("### What the significance became with public evidence", "", ...(deeperSig ? sig.significanceLines(deeperSig).map(l => `- ${l}`) : ["- failed"]), ...(deeperGrounded?.issues ?? []).map(i => `- source check: ${i}`), "", ...revealSection(second), "", "---", "");
      console.log(`fast run ${n}: first reveal ${(times["FIRST REVEAL"] / 1000).toFixed(1)} s (${first.lines.filter(l => l.kept).length} lines kept, ${firstPublic.length} public findings in it, ${first.lines.filter(l => l.kept && l.combined).length} lines combining private and public, spotlight ${first.spotlight?.carried ? "carried" : "lost"}); profiles verified ${Object.entries(pub.handles).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}, rejected ${pub.candidates.filter(c => !c.verified).map(c => c.kind).join(", ") || "none"}; organizations ${anchors.organizations.length}; identity search from ${((pub.identityStartedAt ?? 0) / 1000).toFixed(1)} s; second ${(times["second reveal (with public)"] / 1000).toFixed(1)} s`);
    }
  }

  if (!out.length) refuse("nothing to run: pass --scenarios and/or --journey --fast");
  const dir = value("--out-dir") ?? "tmp/first-read-bench";
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `significance-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(file, out.join("\n"), { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log(`Report: ${file}`);
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
