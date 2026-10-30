import { describe, expect, it } from "vitest";
import {
  CORRECTED_LINES,
  buildReveals,
  crewLines,
  pluralTitle,
  ruleDays,
  suggestionRules,
  turnNow,
  waitingCompanions,
} from "../../shared/firstTenMinutesCrew";
import type { FindingView } from "../../shared/firstTenMinutesFindings";
import { asViews, exampleReading } from "./testSupport/exampleReading";

async function nina(): Promise<FindingView[]> {
  const { all, opportunities } = await exampleReading();
  return asViews([...all, ...opportunities]);
}

describe("the crew gets acquainted (Nina)", () => {
  it("opens with Nina's own words, then each companion in turn", async () => {
    const reveals = buildReveals(await nina());
    expect(reveals.map(reveal => reveal.companion)).toEqual(["sable", "mara", "rook", "bront", "luma", "orren", "ilex"]);
    expect(reveals[0]).toMatchObject({ kind: "rule", quote: "No more Sunday deliveries.", to: "Jules Moreau", days: [0] });
  });

  it("says Astra's lines, and Adam's for Sable", async () => {
    const lines = Object.fromEntries(buildReveals(await nina()).map(reveal => [reveal.companion, crewLines(reveal)]));
    expect(lines).toEqual({
      sable: ["Still true?"],
      mara: ["That's a small map with quite a lot happening on it."],
      rook: ["You tend to finish with a real question.", "I can work with that."],
      bront: ["Your wedding clients ask for a spectacular day.", "The hotels keep asking for something they can count on every week."],
      luma: ["This one keeps coming back. Three proposals. Same blue jug.", "I've kept the original."],
      orren: ["Your Friday deliveries already pass this street."],
      ilex: ["There's an older conversation we should put beside this."],
    });
  });

  it("puts the three hotels on Mara's map, each with who asked and when", async () => {
    const mara = buildReveals(await nina()).find(reveal => reveal.companion === "mara");
    expect(mara?.kind === "places" && mara.pins.map(pin => [pin.name, pin.asked?.who, pin.asked?.at.slice(0, 7)])).toEqual([
      ["The Larkspur Hotel", "Elena Ruiz", "2026-04"],
      ["Hotel Wren", "Marcus Bell", "2026-05"],
      ["The Alder House", "Priya Shah", "2026-06"],
    ]);
    expect(mara?.kind === "places" && mara.clustered).toBe(true);
  });

  it("keeps Mara, Orren and Ilex back until the reading is final", async () => {
    const reveals = buildReveals(await nina(), { final: false });
    expect(reveals.map(reveal => reveal.companion)).toEqual(["sable", "rook", "bront", "luma"]);
  });

  it("lets a companion with nothing to reveal wait, silently", async () => {
    const findings = (await nina()).filter(finding => finding.payload.kind !== "habit" && finding.payload.kind !== "contrast");
    const reveals = buildReveals(findings);
    expect(waitingCompanions(reveals)).toEqual(["rook", "bront"]);
  });

  it("never reveals what the person said was wrong, and Sable falls back to a promise", async () => {
    const findings = (await nina()).map(finding =>
      finding.payload.kind === "rule" ? { ...finding, status: "dismissed" as const } : finding
    );
    const sable = buildReveals(findings)[0];
    expect(sable).toMatchObject({ companion: "sable", kind: "promise", quote: "I'll send the final counts on the 19th" });
    expect(crewLines(sable)).toEqual(["Still on?"]);
    const noPlaces = (await nina()).map(finding => (finding.payload.kind === "place" ? { ...finding, status: "dismissed" as const } : finding));
    expect(buildReveals(noPlaces).some(reveal => reveal.companion === "mara")).toBe(false);
  });

  it("keeps Sable's turn through her answer, even when it crosses out the only words she had", async () => {
    const noPromise = (await nina()).filter(finding => finding.payload.kind !== "promise");
    const sable = turnNow(buildReveals(noPromise), [], noPromise);
    expect(sable).toMatchObject({ companion: "sable", kind: "rule", quote: "No more Sunday deliveries." });

    const changed = noPromise.map(finding => (finding.payload.kind === "rule" ? { ...finding, status: "changed" as const } : finding));
    const reveals = buildReveals(changed);
    // nothing of hers is left to reveal, but she says her line about the crossed-out words before Mara steps in
    expect(reveals.some(reveal => reveal.companion === "sable")).toBe(false);
    const still = turnNow(reveals, [], changed, sable);
    expect(still).toMatchObject({ companion: "sable", kind: "rule", quote: "No more Sunday deliveries." });
    expect(still?.companion === "sable" && still.finding.status).toBe("changed");
    expect(turnNow(reveals, ["sable"], changed, sable)?.companion).toBe("mara");
  });

  it("turns a confirmed rule into what later suggestions must respect", async () => {
    const proposed = await nina();
    expect(suggestionRules(proposed)).toEqual({ closedDays: [], rules: [] });
    const confirmed = proposed.map(finding => (finding.payload.kind === "rule" ? { ...finding, status: "confirmed" as const } : finding));
    expect(suggestionRules(confirmed)).toEqual({ closedDays: [0], rules: ["No more Sunday deliveries."] });
    // a rule that only mentions a day without closing it closes nothing
    expect(ruleDays("Fridays are for hotels")).toEqual([5]);
    const friendly = confirmed.map(finding =>
      finding.payload.kind === "rule" ? { ...finding, payload: { ...finding.payload, quote: "Fridays are for hotels", statement: "Fridays are hotel days" } } : finding
    );
    expect(suggestionRules(friendly).closedDays).toEqual([]);
  });

  it("answers a correction in character, briefly", () => {
    expect(CORRECTED_LINES.rook).toBe("Struck.");
    expect(pluralTitle("Friday delivery")).toBe("Friday deliveries");
    expect(pluralTitle("Tuesday rounds")).toBe("Tuesday rounds");
  });
});
