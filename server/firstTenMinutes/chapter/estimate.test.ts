import { describe, expect, it } from "vitest";
import {
  approachesFor,
  chapterKind,
  chapterTitle,
  composeDraft,
  composeEstimateDraft,
  firstAreas,
  openDetail,
  openLines,
  traysProblem,
} from "../../../shared/firstTenMinutesChapter";
import { buildReveals, crewLines } from "../../../shared/firstTenMinutesCrew";
import { verifyEstimate } from "../understanding/extract";
import { asViews, exampleReading } from "../testSupport/exampleReading";
import { chapterOpportunity } from "./chapter";

/** Part 3 (docs/goldline/FIRST_TEN_MINUTES_BUILD.md, slice 8): the chapter chosen by the opportunity found. */
async function dev() {
  const { all, opportunities } = await exampleReading("journey-under-test", "dev");
  return asViews([...all, ...opportunities]);
}
async function nina() {
  const { all, opportunities } = await exampleReading();
  return asViews([...all, ...opportunities]);
}

const ORTEGA = `Northfield Electric
Estimate — Ortega residence, 1418 Avenue 54
Prepared for Marisol Ortega

Garage
New 50A circuit for an EV charger — $1,450
EV charger installation — charger model TBD by client

Kitchen
Under-cabinet lighting — $980`;

describe("an estimate, kept only in the document's own words", () => {
  it("keeps the title, the client, each area in order and each line with its price on its own line", () => {
    const verified = verifyEstimate(
      {
        sourceId: "doc",
        title: "Estimate — Ortega residence, 1418 Avenue 54",
        client: "Marisol Ortega",
        areas: [
          { name: "Garage", lines: [{ text: "New 50A circuit for an EV charger", amount: "$1,450" }, { text: "EV charger installation — charger model TBD by client", amount: null }] },
          { name: "Kitchen", lines: [{ text: "Under-cabinet lighting", amount: "$980" }] },
        ],
      },
      ORTEGA
    );
    expect(verified).toEqual({
      title: "Estimate — Ortega residence, 1418 Avenue 54",
      client: "Marisol Ortega",
      areas: [
        {
          name: "Garage",
          lines: [
            { text: "New 50A circuit for an EV charger", amount: "$1,450", open: false },
            { text: "EV charger installation — charger model TBD by client", amount: null, open: true },
          ],
        },
        { name: "Kitchen", lines: [{ text: "Under-cabinet lighting", amount: "$980", open: false }] },
      ],
    });
  });

  it("drops a price the document doesn't put on that line, a line under the wrong heading, and a made-up title", () => {
    const area = (name: string, text: string, amount: string | null) => ({ name, lines: [{ text, amount }] });
    // $980 is the kitchen's, not the circuit's
    expect(verifyEstimate({ sourceId: "doc", title: "Estimate — Ortega residence", client: null, areas: [area("Garage", "New 50A circuit for an EV charger", "$980")] }, ORTEGA)).toBeNull();
    // the lighting is under Kitchen, not Garage
    expect(verifyEstimate({ sourceId: "doc", title: "Estimate — Ortega residence", client: null, areas: [area("Garage", "Under-cabinet lighting", "$980")] }, ORTEGA)).toBeNull();
    expect(verifyEstimate({ sourceId: "doc", title: "Quote for the Ortegas", client: null, areas: [area("Kitchen", "Under-cabinet lighting", "$980")] }, ORTEGA)).toBeNull();
    // headings out of the document's order don't stand
    expect(
      verifyEstimate({ sourceId: "doc", title: "Estimate — Ortega residence", client: null, areas: [area("Kitchen", "Under-cabinet lighting", "$980"), area("Garage", "New 50A circuit for an EV charger", "$1,450")] }, ORTEGA)
    ).toBeNull();
  });
});

describe("Dev's example: the estimate that wouldn't fit", () => {
  it("reads Dev's estimate, Marisol's later message, and the opportunity they make together", async () => {
    const findings = await dev();
    const estimate = findings.find(finding => finding.payload.kind === "estimate");
    expect(estimate?.payload.kind === "estimate" && estimate.payload.areas.map(area => area.name)).toEqual(["Garage", "Kitchen", "Upstairs hallway"]);
    const scope = findings.find(finding => finding.payload.kind === "scope");
    expect(scope?.payload).toMatchObject({ kind: "scope", quote: "Let's do the garage first; the house can wait.", first: "the garage", later: "the house" });
    const opportunity = chapterOpportunity(findings)!;
    expect(opportunity).toMatchObject({
      type: "deserves_finishing",
      person: { name: "Marisol Ortega", address: "marisol.ortega@mail.example" },
      request: { quote: "Could you look at the garage, the kitchen lighting and the upstairs hallway while you're out here?" },
      scope: { first: "the garage", later: "the house" },
    });
    expect(chapterKind(opportunity)).toBe("scope");
    expect(chapterTitle(opportunity)).toBe("The Estimate That Wouldn't Fit");
    expect(firstAreas(opportunity)).toEqual(["Garage"]);
    expect(openLines(opportunity)).toEqual([{ area: "Garage", text: "EV charger installation — charger model TBD by client" }]);
    expect(openDetail(openLines(opportunity)[0].text)).toBe("charger model");
    expect(approachesFor(opportunity)).toEqual(["focused", "question"]);
  });

  it("lets the crew step in with what it has, and the rest wait", async () => {
    const reveals = buildReveals(await dev());
    expect(reveals.map(reveal => reveal.companion)).toEqual(["sable", "mara", "rook", "bront", "ilex"]);
    expect(crewLines(reveals[0])).toEqual(["Still true?"]);
    expect(reveals[0]).toMatchObject({ kind: "rule", quote: "I only quote after a site visit" });
  });

  it("separates the scope without taking anything out", async () => {
    const opportunity = chapterOpportunity(await dev())!;
    expect(traysProblem(opportunity, { thisJob: ["Garage"], later: ["Kitchen", "Upstairs hallway"] })).toBeNull();
    expect(traysProblem(opportunity, { thisJob: ["Garage"], later: ["Kitchen"] })).toMatch(/Nothing is taken out/);
    expect(traysProblem(opportunity, { thisJob: ["Garage", "Kitchen", "Upstairs hallway"], later: [] })).toMatch(/won't fit/);
    expect(traysProblem(opportunity, { thisJob: ["Garage", "Porch"], later: ["Kitchen", "Upstairs hallway"] })).toMatch(/aren't this estimate's/);
  });

  it("composes Astra's cover message and the focused estimate in the document's words, or the precise question", async () => {
    const opportunity = chapterOpportunity(await dev())!;
    const trays = { thisJob: ["Garage"], later: ["Kitchen", "Upstairs hallway"] };
    expect(composeEstimateDraft(opportunity, "focused", trays)).toEqual({
      subject: "Re: Electrical work at Avenue 54",
      body: [
        "Hi Marisol — I've separated the garage work from the house work so we can move ahead with the first part. The later work is listed separately.",
        "",
        "Garage",
        "New 50A circuit for an EV charger — $1,450",
        "EV charger installation — charger model TBD by client",
        "LED shop lights (4) — $620",
        "",
        "Later work",
        "Kitchen",
        "Under-cabinet lighting — $980",
        "Two GFCI outlets by the sink — $360",
        "Upstairs hallway",
        "Replace three hallway fixtures — $540",
        "Hardwired smoke detectors (2) — $410",
      ].join("\n"),
    });
    expect(composeEstimateDraft(opportunity, "question", trays).body).toBe(
      "Hi Marisol — before I finish the garage estimate, I need one detail from you: the charger model. Could you let me know?"
    );
    // the person's own arrangement, not the client's: named by its rooms
    expect(composeEstimateDraft(opportunity, "focused", { thisJob: ["Garage", "Kitchen"], later: ["Upstairs hallway"] }).body.split("\n")[0]).toBe(
      "Hi Marisol — I've separated the garage and kitchen work from the upstairs hallway work so we can move ahead with the first part. The later work is listed separately."
    );
  });
});

describe("Nina's chapter: the Friday that didn't exist", () => {
  it("is chosen by what became possible, and named for it", async () => {
    const opportunity = chapterOpportunity(await nina())!;
    expect(chapterKind(opportunity)).toBe("time");
    expect(chapterTitle(opportunity)).toBe("The Friday That Didn't Exist");
    expect(approachesFor(opportunity)).toEqual(["still_wanted", "offer_start", "short"]);
    expect(opportunity.estimate).toBeNull();
  });
});

describe("A Proper Letter, for any other opportunity", () => {
  it("picks the conversation up and claims nothing there is no record of", async () => {
    const nina = chapterOpportunity(await (async () => {
      const { all, opportunities } = await exampleReading();
      return asViews([...all, ...opportunities]);
    })())!;
    const unanswered = { ...nina, type: "unanswered" as const, reply: null, service: null };
    expect(chapterKind(unanswered)).toBe("letter");
    expect(chapterTitle(unanswered)).toBe("A Proper Letter");
    expect(approachesFor(unanswered)).toEqual(["still_wanted", "short"]);
    const now = new Date("2026-10-29T17:00:00Z");
    expect(composeDraft(unanswered, "still_wanted", now).body).toBe(
      "Hi Elena — you asked earlier this year about Friday flowers, and I never got back to you. Is that still something you're looking for at the hotel?"
    );
    expect(composeDraft(unanswered, "short", now).body).toBe("Hi Elena — still looking for Friday flowers?");
  });
});

