/**
 * The three-stream reveal (server/businessKnowledge/firstRead/reveal.ts): private mail, private files and the public
 * web, reconciled into what Claire says first. NOT run by CI. Read-only; writes nothing to the database; nothing goes
 * to analytics; reports are readable by you only.
 *
 *   scripts/first-read-reveal.sh --personas plumber,laundromat,electrician
 *     synthetic owners (fictional; their public findings stand in for the public stream): tests the reasoning
 *
 *   scripts/first-read-reveal.sh --journey <own journey id> --i-have-authorization [--user-evidence <file.json>]
 *     a real connected account: Gmail and Drive (the discover strategy) and live public research (Claude web search,
 *     xAI X search, Google Places) at once, then three reveals from that one retrieval: Gmail and Drive alone; plus
 *     public research; plus what the person handed over themselves (--user-evidence: a JSON list of
 *     {text, signal, url?, date?}, kept outside the repo; labelled user-provided, never passed off as discovered)
 *
 * Each subject's report has:
 *   1. what Gmail and Drive alone find, and the opening Claire would give from them alone
 *   2. what public research adds
 *   3. what only the combination makes possible
 *   4. Claire's opening
 *   5. internally, which lines are confirmed and which are inferred
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

type Section = {
  title: string;
  privateClaims: import("../server/businessKnowledge/firstRead/synthesis").CheckedClaim[];
  privateOpening: import("../server/businessKnowledge/firstRead/synthesis").OpeningSentence[];
  publicFindings: import("../server/businessKnowledge/firstRead/publicResearch").PublicFinding[];
  rejected: Array<{ text: string; why: string }>;
  publicRuns: import("../server/businessKnowledge/firstRead/publicResearch").StreamRun[];
  reveal: import("../server/businessKnowledge/firstRead/reveal").RevealResult;
  timings: Record<string, number>;
  costCents: number;
  shouldRecognise?: string[];
  traps?: string[];
};

const STATED = new Set(["active", "in_progress", "fiction", "open_problem", "happened", "ended", "relationship"]);

function sectionReport(s: Section): string {
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "undated");
  const r = s.reveal.reveal;
  const lines: string[] = [`# ${s.title}`, ""];
  lines.push(`Timings: ${Object.entries(s.timings).map(([k, ms]) => `${k} ${(ms / 1000).toFixed(1)} s`).join(", ")}. Model cost about ${s.costCents.toFixed(1)}¢.`, "");
  if (s.shouldRecognise) lines.push("**What a perceptive first meeting should land on (the reviewer's key, never shown to the model):**", ...s.shouldRecognise.map(x => `- ${x}`), "", `Traps: ${s.traps?.join("; ")}`, "");

  lines.push("## 1. Gmail and Drive alone", "");
  for (const c of s.privateClaims.filter(c => STATED.has(c.verdict) || c.verdict === "status_unknown")) {
    lines.push(`- ${c.statement} _(${c.verdict}${c.partOf ? ` of ${c.partOf}` : ""}; last seen ${day(c.lastSeen)})_`);
  }
  const alone = s.privateOpening.filter(o => o.kept).map(o => o.sentence).join(" ");
  lines.push("", `What Claire would say from these alone: > ${alone || "(nothing survived the checks)"}`, "");

  lines.push("## 2. What public research adds", "");
  for (const run of s.publicRuns) lines.push(`- ${run.source}: ${run.findings} findings in ${(run.ms / 1000).toFixed(1)} s${run.note ? ` (${run.note})` : ""}${run.error ? `, ERROR: ${run.error}` : ""}`);
  for (const f of s.publicFindings) lines.push(`- ${f.id} [${f.source}, ${f.signal}, ${day(f.at)}, identity ${f.identity}] ${f.text}${f.url ? ` — ${f.url}` : ""}`);
  if (s.rejected.length) lines.push("", "Thrown out by the identity check:", ...s.rejected.map(x => `- ${x.text} (${x.why})`));
  lines.push("");

  lines.push("## 3. Only possible by combining them", "");
  lines.push(...(s.reveal.combined.length ? s.reveal.combined.map(x => `- ${x}`) : ["- nothing rested on both private and public items"]), "");
  if (r) {
    lines.push("All inferences (internal):", ...r.inferred.map((x, i) => `- I${i} (${x.confidence}) ${x.statement} — signals ${x.signals.join(", ")}; doesn't prove: ${x.caveat}`), "");
    if (r.discrepancies.length) lines.push("Discrepancies (recognised, not explained):", ...r.discrepancies.map(x => `- ${x.statement} — ${x.supports.join(", ")}`), "");
  }

  if (s.reveal.spotlight) lines.push(`**Spotlight (strongest discovery she built the opening on):** ${s.reveal.spotlight.item}: ${s.reveal.spotlight.text} — ${s.reveal.spotlight.why}`, "");
  lines.push("## 4. What Claire says first", "");
  const kept = s.reveal.lines.filter(l => l.kept);
  lines.push(kept.length ? kept.map(l => `> ${l.line}`).join("\n>\n") : "> (nothing survived the checks)", "");

  lines.push("## 5. Behind the curtain: each line", "");
  for (const l of s.reveal.lines) {
    lines.push(`- ${l.kept ? "SAID" : "STRUCK"} [${l.basis}${l.combined ? ", combined" : ""}${l.userProvided ? ", uses user-provided evidence" : ""}] “${l.line}” — rests on ${l.rests.join(", ")}${l.why ? ` — ${l.why}` : ""}`);
  }
  if (r) {
    lines.push("", "Confirmed items:", ...r.confirmed.map((x, i) => `- F${i} ${x.statement} — ${x.supports.join(", ")}`));
  }
  for (const call of s.reveal.calls) if (call.error) lines.push(`- ${call.purpose} FAILED: ${call.error}`);
  return lines.join("\n");
}

async function main() {
  const { geminiReading, checkClaims, judgeClaims } = await import("../server/businessKnowledge/firstRead/synthesis");
  const { runReveal } = await import("../server/businessKnowledge/firstRead/reveal");
  const geminiKey = process.env.GEMINI_API_KEY?.trim() || refuse("GEMINI_API_KEY isn't set.");
  const gemini = { apiKey: geminiKey, model: value("--model") ?? "gemini-3.8-flash", thinking: "low" as const };
  const price = (calls: Array<{ inputTokens: number; outputTokens: number }>) => calls.reduce((sum, c) => sum + (c.inputTokens * 75 + c.outputTokens * 375) / 1_000_000, 0);
  const sections: Section[] = [];

  const personas = value("--personas");
  if (personas) {
    const { PERSONAS } = await import("../server/businessKnowledge/firstRead/personas");
    for (const key of personas.split(",").map(k => k.trim())) {
      const p = PERSONAS.find(x => x.key === key) ?? refuse(`no persona ${key}`);
      const t0 = Date.now();
      const { value: reading, call } = await geminiReading(gemini, { question: "combined", evidence: p.privateEvidence, today: p.today });
      if (!reading) {
        console.error(`${key}: private reading failed: ${call.error}`);
        continue;
      }
      const judged = await judgeClaims(gemini, checkClaims(reading, p.privateEvidence, p.today), p.privateEvidence, p.today, reading.opening);
      const tPrivate = Date.now() - t0;
      const reveal = await runReveal(gemini, { claims: judged.claims, publicFindings: p.publicFindings, today: p.today, ownerName: p.ownerName });
      sections.push({
        title: `Synthetic owner: ${p.ownerName} (${p.key})`,
        privateClaims: judged.claims,
        privateOpening: judged.opening,
        publicFindings: p.publicFindings,
        rejected: p.rejectedPublic,
        publicRuns: [],
        reveal,
        timings: { private: tPrivate, reveal: Date.now() - t0 - tPrivate },
        costCents: price([call, ...(judged.call ? [judged.call] : []), ...reveal.calls]),
        shouldRecognise: p.shouldRecognise,
        traps: p.traps,
      });
      console.log(`${key}: ${reveal.lines.filter(l => l.kept).length} lines kept of ${reveal.lines.length}`);
    }
  }

  const journeyId = value("--journey");
  if (journeyId) {
    if (!args.includes("--i-have-authorization")) refuse("this reads a real person's Gmail and Drive and researches them publicly. Pass --i-have-authorization only with their go-ahead.");
    const { coldTestSource, readOnlyFetch } = await import("../server/businessKnowledge/coldTest");
    const { refreshGoogleAccess, googleAccount } = await import("../server/firstTenMinutes/google");
    const { googleResearch } = await import("../server/firstTenMinutes/research/googleResearch");
    const { CoverageLedger } = await import("../server/firstTenMinutes/research/coverage");
    const { runFirstReadBench } = await import("../server/businessKnowledge/firstRead/bench");
    const { webResearch, xResearch, placesResearch } = await import("../server/businessKnowledge/firstRead/publicResearch");
    const { google } = await coldTestSource(journeyId);
    const t0 = Date.now();

    // identity anchors, from the account and the owner's own Sent headers (a second or two)
    const tokens = await refreshGoogleAccess({ refreshToken: google.refreshToken! }, { fetch: readOnlyFetch() });
    const account = await googleAccount(tokens.accessToken);
    const research = googleResearch({ ...google, accessToken: tokens.accessToken, accessExpiresAt: tokens.expiresAt }, new CoverageLedger(), { fetch: readOnlyFetch() });
    const sent = await research.searchMail("in:sent", { limit: 30 });
    const free = /^(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|aol|proton|protonmail)\./i;
    const domains = [...new Set((sent?.items ?? []).filter(i => i.sentByOwner).map(i => i.from.email.split("@")[1]?.toLowerCase()).filter((d): d is string => Boolean(d) && !free.test(d!)))];
    const anchors = { name: account.name ?? google.ownerEmail, email: google.ownerEmail, domains, businesses: [] as string[], city: null };
    const tAnchors = Date.now() - t0;

    // Private (Gmail + Drive) runs from the start. Public research starts the moment discovery has named the owner's
    // businesses and projects (about 15 s in): without them, identity anchors are too thin to find their accounts.
    type Web = Awaited<ReturnType<typeof webResearch>> & { end: number; startedAt: number };
    let resolveWeb!: (value: Promise<Web>) => void;
    const webLater = new Promise<Promise<Web>>(resolve => (resolveWeb = resolve));
    let started = false;
    const startPublic = () => {
      if (started) return;
      started = true;
      const startedAt = Date.now() - t0;
      resolveWeb(webResearch(anchors).then(r => ({ ...r, end: Date.now() - t0, startedAt })));
    };
    const privateRun = runFirstReadBench({
      google,
      variants: ["discover:combined"],
      runs: 1,
      geminiKey,
      model: gemini.model,
      thinking: "low",
      centsPerMillion: { input: 75, output: 375 },
      onDiscovery: discovery => {
        anchors.businesses = discovery.undertakings.filter(u => u.category === "business" || u.category === "project").map(u => u.name);
        startPublic();
      },
    }).then(r => ({ result: r, ms: Date.now() - t0 }));
    const priv = await privateRun;
    // if discovery never reported (it failed), start public research now with what we have
    startPublic();
    const w = await (await webLater);
    const run = priv.result.runs[0];
    const answer = run.answers[0];
    const businesses = (run.discovery?.undertakings ?? []).filter(u => u.category === "business").map(u => u.name);
    const handle = w.found?.handles.x || "";
    const tAfter = Date.now() - t0;
    const [places, x] = await Promise.all([placesResearch({ ...anchors, businesses }), xResearch(anchors, { handle: handle || null })]);
    const x0 = { end: Date.now() - t0 };
    const tPublic = Date.now() - t0;
    const keep = (found: typeof w.found, source: "web" | "x") =>
      (found?.findings ?? []).filter(f => f.identity !== "different_person" && f.matchedAnchors.length >= 2).map(f => ({ source, text: f.text, signal: f.signal, url: f.url || null, at: /^\d{4}-\d{2}-\d{2}$/.test(f.date) ? new Date(f.date) : null, identity: f.identity === "certain" ? ("certain" as const) : ("likely" as const) }));
    const publicFindings = [...keep(w.found, "web"), ...keep(x.found, "x"), ...places.findings].map((f, i) => ({ ...f, id: `p${i + 1}` }));
    const rejected = [...(w.found?.findings ?? []), ...(x.found?.findings ?? [])].filter(f => f.identity === "different_person" || f.matchedAnchors.length < 2).map(f => ({ text: f.text, why: f.identity === "different_person" ? "a different person" : `matched only ${f.matchedAnchors.join(", ") || "nothing"}` }));
    // One retrieval, three reveals: what changes is only the evidence Claire is given.
    //   A: Gmail and Drive alone. B: plus what public research found on its own. C: plus what the person handed over.
    const userFile = value("--user-evidence");
    const userProvided = userFile
      ? (JSON.parse(readFileSync(userFile, "utf8")) as Array<{ text: string; signal: string; url?: string; date?: string }>).map((u, i) => ({
          id: `u${i + 1}`,
          source: "user" as const,
          text: u.text,
          signal: u.signal,
          url: u.url ?? null,
          at: u.date ? new Date(u.date) : null,
          identity: "certain" as const,
        }))
      : [];
    const tReveal = Date.now();
    const conditions: Array<[string, Parameters<typeof runReveal>[1]]> = [
      ["A. Gmail and Drive alone", { claims: answer?.claims ?? [], publicFindings: [], today: new Date(), ownerName: anchors.name }],
      ["B. plus independent public research", { claims: answer?.claims ?? [], publicFindings, today: new Date(), ownerName: anchors.name }],
      ...(userProvided.length ? [["C. plus the screenshots the person provided (user-provided, not discovered)", { claims: answer?.claims ?? [], publicFindings, userProvided, today: new Date(), ownerName: anchors.name }] as [string, Parameters<typeof runReveal>[1]]] : []),
    ];
    const reveals = await Promise.all(conditions.map(([, input]) => runReveal(gemini, input)));
    reveals.forEach((reveal, i) => {
      sections.push({
        title: `Real account: ${anchors.name}, ${conditions[i][0]}`,
        privateClaims: answer?.claims ?? [],
        privateOpening: answer?.opening ?? [],
        publicFindings: [...(conditions[i][1].publicFindings ?? []), ...(conditions[i][1].userProvided ?? [])],
        rejected: i === 0 ? [] : rejected,
        publicRuns: i === 0 ? [] : [w.run, x.run, places.run],
        reveal,
        timings: { anchors: tAnchors, "public started": w.startedAt, "private done": priv.ms, "web done": w.end, "both streams in": tAfter, "x + places done": x0.end, "reveal (all three, in parallel)": Date.now() - tReveal },
        costCents: (i === 0 ? run.costCents + w.run.costCents + places.run.costCents : 0) + price(reveal.calls),
      });
      console.log(`${conditions[i][0]}: ${reveal.lines.filter(l => l.kept).length} of ${reveal.lines.length} lines kept`);
    });
    console.log(`real account: private ${priv.ms} ms, public ${tPublic} ms, reveals ${Date.now() - tReveal} ms`);
  }

  if (!sections.length) refuse("nothing to run: pass --personas and/or --journey");
  const dir = value("--out-dir") ?? "tmp/first-read-bench";
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const out = join(dir, `reveal-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(out, sections.map(sectionReport).join("\n\n---\n\n"), { mode: 0o600 });
  chmodSync(out, 0o600);
  console.log(`Report: ${out}`);
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
