import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { FindingView } from "../../../shared/firstTenMinutesFindings";
import { portraitLines, type PortraitLine, type PortraitView } from "../../../shared/firstTenMinutesPortrait";
import { recordEvent } from "../events";
import { setJourneyStage, type JourneyRow } from "../store";
import { understandingView } from "../understanding/view";
import { claimPortrait, editPortraitLine, finishPortrait, keepPortrait, portraitRow, restorePortraitEdit, type PortraitEdits } from "./store";
import { PORTRAIT_SYSTEM, firstNameFor, portraitCorpus, portraitFindings, settlePortrait, type PortraitWriter, type WrittenPortrait } from "./write";
import { claudePortraitWriter, examplePortraitWriter } from "./writers";

/**
 * Claire's portrait of one journey: written once the crew's reading is complete, from what still stands, in this
 * server process (like the reading), and shown through `portraitView`. Written again only while the person hasn't
 * kept it and what it rests on has changed: a finding corrected, a rule confirmed.
 */

/** What the portrait rests on: every finding still standing, with what the person said about it. */
export function portraitBasis(findings: readonly FindingView[]): string {
  const standing = portraitFindings(findings)
    .map(finding => [finding.id, finding.status, finding.correction ?? ""])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return createHash("sha256")
    .update(JSON.stringify(["portrait-v1", firstNameFor(findings), standing]))
    .digest("hex");
}

export function portraitWriterFor(journey: JourneyRow): { writer: PortraitWriter; name: string } {
  return journey.kind === "example"
    ? { writer: examplePortraitWriter(), name: "example" }
    : { writer: claudePortraitWriter(journey.id), name: "claude" };
}

/** Write the page for `runId`, which holds the portrait. One retry; a page too thin to show becomes `unavailable`. */
export async function runPortrait(
  journeyId: string,
  runId: string,
  findings: FindingView[],
  writer: { writer: PortraitWriter; name: string }
): Promise<void> {
  try {
    const corpus = portraitCorpus(findings, firstNameFor(findings));
    let written: WrittenPortrait | null = null;
    for (let attempt = 1; ; attempt++) {
      try {
        written = settlePortrait(await writer.writer.write({ system: PORTRAIT_SYSTEM, corpus, findings }), findings);
        break;
      } catch (error) {
        if (attempt >= 2) throw error;
      }
    }
    await finishPortrait(journeyId, runId, { status: written ? "ready" : "unavailable", portrait: written, writtenBy: writer.name });
  } catch (error) {
    console.warn("[FirstTen] the portrait wasn't written:", error instanceof Error ? error.message.slice(0, 120) : "unknown");
    await finishPortrait(journeyId, runId, { status: "failed", portrait: null, writtenBy: writer.name }).catch(() => undefined);
  }
}

/**
 * Begin (or rejoin) the portrait. Returns at once with what there is to see; the writing reports itself through
 * `portraitView`. Refused until the crew's reading is complete.
 */
export async function preparePortrait(
  journey: JourneyRow,
  writer: { writer: PortraitWriter; name: string } = portraitWriterFor(journey)
): Promise<{ view: PortraitView; started: Promise<void> | null }> {
  const reading = await understandingView(journey.id);
  if (reading.status !== "complete") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your crew is still getting acquainted." });
  }
  const runId = randomUUID();
  let started: Promise<void> | null = null;
  if (await claimPortrait(journey.id, runId, portraitBasis(reading.findings))) {
    started = runPortrait(journey.id, runId, reading.findings, writer);
    if (journey.stage === "crew") await setJourneyStage(journey.id, "portrait");
  }
  return { view: (await portraitView(journey.id)) ?? { status: "writing", greeting: null, paragraphs: [], closing: null }, started };
}

function withEdits(line: PortraitLine, edits: PortraitEdits): PortraitLine {
  const edit = edits[line.key];
  return edit ? { ...line, changedTo: edit.to } : line;
}

export async function portraitView(journeyId: string, now = new Date()): Promise<PortraitView | null> {
  const row = await portraitRow(journeyId);
  if (!row) return null;
  const lapsed = row.status === "writing" && (!row.leaseUntil || row.leaseUntil < now);
  const portrait = row.portraitJson;
  const edits = row.editsJson ?? {};
  if (lapsed) return { status: "failed", greeting: null, paragraphs: [], closing: null };
  if (row.status === "writing" || !portrait) return { status: row.status, greeting: null, paragraphs: [], closing: null };
  return {
    status: row.status,
    greeting: portrait.greeting,
    paragraphs: portrait.paragraphs.map(paragraph => paragraph.map(line => withEdits(line, edits))),
    closing: portrait.closing,
  };
}

/** "That sounds like me". Kept with whatever the person changed; the journey moves on to what Claire wants to show. */
export async function keepPortraitFor(journey: JourneyRow): Promise<PortraitView> {
  const view = await portraitView(journey.id);
  if (!view || (view.status !== "ready" && view.status !== "kept")) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "There's no page to keep yet." });
  }
  if (view.status === "ready" && (await keepPortrait(journey.id))) {
    const lines = portraitLines(view);
    await recordEvent(journey.id, "portrait_kept", {
      lines: lines.length,
      changed: lines.filter(line => line.changedTo !== undefined).map(line => line.key),
    });
    await setJourneyStage(journey.id, "chapter");
  }
  return (await portraitView(journey.id))!;
}

/** "Let me change something": the person's words in place of one line, or the line taken out. */
export async function changePortraitLine(journey: JourneyRow, key: string, to: string | null): Promise<PortraitView> {
  const view = await portraitView(journey.id);
  const line = view?.paragraphs.flat().find(candidate => candidate.key === key);
  if (!view || view.status !== "ready" || !line) {
    throw new TRPCError({ code: view?.status === "kept" ? "CONFLICT" : "NOT_FOUND", message: "That line can't be changed now." });
  }
  const words = to?.trim() ? to.trim() : null;
  if (!(await editPortraitLine(journey.id, key, words))) {
    throw new TRPCError({ code: "CONFLICT", message: "That line can't be changed now." });
  }
  await recordEvent(journey.id, "portrait_changed", { key, from: line.text, to: words, findingIds: line.findingIds });
  return (await portraitView(journey.id))!;
}

/** Put Claire's line back where the person had changed it. */
export async function restorePortraitLine(journey: JourneyRow, key: string): Promise<PortraitView> {
  const view = await portraitView(journey.id);
  const line = view?.paragraphs.flat().find(candidate => candidate.key === key);
  if (!view || view.status !== "ready" || !line) {
    throw new TRPCError({ code: view?.status === "kept" ? "CONFLICT" : "NOT_FOUND", message: "That line can't be changed now." });
  }
  if (line.changedTo !== undefined && (await restorePortraitEdit(journey.id, key))) {
    await recordEvent(journey.id, "portrait_changed", { key, from: line.changedTo, to: line.text, restored: true, findingIds: line.findingIds });
  }
  return (await portraitView(journey.id))!;
}
