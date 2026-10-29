import { describe, expect, it } from "vitest";
import type { FindingView } from "../../../shared/firstTenMinutesFindings";
import { PORTRAIT_CLOSING } from "../../../shared/firstTenMinutesPortrait";
import { asViews, exampleReading } from "../testSupport/exampleReading";
import { portraitBasis } from "./portrait";
import { PORTRAIT_SYSTEM, firstNameFor, lineProblem, portraitCorpus, settlePortrait, stem } from "./write";
import { examplePortraitWriter } from "./writers";

async function nina(): Promise<FindingView[]> {
  const { all, opportunities } = await exampleReading();
  return asViews([...all, ...opportunities]);
}

async function writeExample(findings: FindingView[]) {
  const draft = await examplePortraitWriter().write({ system: PORTRAIT_SYSTEM, corpus: portraitCorpus(findings, firstNameFor(findings)), findings });
  return settlePortrait(draft, findings);
}

const text = (portrait: Awaited<ReturnType<typeof writeExample>>) => portrait?.paragraphs.map(paragraph => paragraph.map(line => line.text));
const of = (findings: FindingView[], kind: string) => findings.filter(finding => finding.payload.kind === kind);

describe("Claire's portrait (Nina)", () => {
  it("is Astra's page, word for word, every line resting on Nina's own records", async () => {
    const findings = await nina();
    const portrait = await writeExample(findings);
    expect(portrait?.greeting).toBe("Nina, here's where you are.");
    expect(text(portrait)).toEqual([
      ["Weddings fill your weekends.", "You're building a steadier weekday business around hotel flowers."],
      ["Jules handles the installations.", "You carry the promises: what arrives, when it arrives, and what the client actually agreed to."],
      ["You've added Friday deliveries and kept Sundays for yourself.", "The next hotel conversation should fit the business you're building now."],
    ]);
    expect(portrait?.closing).toMatchObject({ key: "closing", text: PORTRAIT_CLOSING });
    const ids = new Set(findings.map(finding => finding.id));
    for (const line of portrait!.paragraphs.flat()) {
      expect(line.findingIds.length).toBeGreaterThan(0);
      for (const id of line.findingIds) expect(ids.has(id)).toBe(true);
    }
    expect(portrait!.paragraphs.flat().map(line => line.key)).toEqual(["p1.s1", "p1.s2", "p2.s1", "p2.s2", "p3.s1", "p3.s2"]);
  });

  it("answers what Nina said: a changed Sunday rule and a dismissed calendar pattern change the page", async () => {
    const findings = (await nina()).map(finding =>
      finding.payload.kind === "rule"
        ? { ...finding, status: "changed" as const, correction: "Sundays are fine in wedding season." }
        : finding.payload.kind === "rhythm"
          ? { ...finding, status: "dismissed" as const }
          : finding
    );
    const lines = text(await writeExample(findings))!.flat();
    expect(lines).toContain("You've added Friday deliveries.");
    expect(lines.some(line => line.includes("Sundays"))).toBe(false);
    // the weekends line rested on the calendar pattern; with only the wedding requests left, it can't stand
    expect(lines).not.toContain("Weddings fill your weekends.");
  });

  it("offers the model only what still stands, the person's own words included", async () => {
    const findings = (await nina()).map(finding =>
      finding.payload.kind === "rule"
        ? { ...finding, status: "changed" as const, correction: "Sundays are fine in wedding season." }
        : finding.payload.kind === "habit"
          ? { ...finding, status: "dismissed" as const }
          : finding
    );
    const corpus = JSON.parse(portraitCorpus(findings, firstNameFor(findings))) as {
      person: string;
      findings: Array<{ kind: string; changedByThePerson?: string }>;
    };
    expect(corpus.person).toBe("Nina");
    expect(corpus.findings.some(finding => finding.kind === "habit" || finding.kind === "owner")).toBe(false);
    expect(corpus.findings.find(finding => finding.kind === "rule")?.changedByThePerson).toBe("Sundays are fine in wedding season.");
  });

  it("strikes a line that names, dates, counts or quotes what its findings don't hold", async () => {
    const findings = await nina();
    const [service] = of(findings, "service");
    const [jules] = of(findings, "person").filter(finding => finding.payload.kind === "person" && finding.payload.person.name === "Jules Moreau");
    const hotels = of(findings, "place");
    const [rule] = of(findings, "rule");
    const [weddings] = of(findings, "rhythm");
    expect(lineProblem("Marta handles the installations.", [jules], findings)).toBe("name");
    expect(lineProblem("Jules handles the installations.", [service], findings)).toBe("name");
    expect(lineProblem("Jules handles the installations.", [jules], findings)).toBeNull();
    expect(lineProblem("Tuesdays are for the hotels.", [service, ...hotels], findings)).toBe("day");
    expect(lineProblem("You've added Friday deliveries and kept Sundays for yourself.", [service, rule], findings)).toBeNull();
    expect(lineProblem("Weddings fill your weekends.", [weddings], findings)).toBeNull();
    expect(lineProblem("Weddings fill your weekends.", [service], findings)).not.toBeNull();
    expect(lineProblem("Three hotels keep asking about your flowers.", hotels, findings)).toBeNull();
    expect(lineProblem("Four hotels keep asking about your flowers.", hotels, findings)).toBe("number");
    expect(lineProblem("You told Jules “no more weekend work.”", [rule], findings)).toBe("quotation");
    expect(lineProblem("You told Jules “No more Sunday deliveries.”", [rule], findings)).toBeNull();
    expect(lineProblem("Your crew noticed the hotels.", hotels, findings)).toBe("machinery");
    expect(lineProblem("Every hotel loves you!", hotels, findings)).toBe("machinery");
    expect(lineProblem("Since January, the hotels have kept asking.", hotels, findings)).toBe("month");
    expect(lineProblem("Since April, the hotels have kept asking.", hotels, findings)).toBeNull();
    expect(lineProblem("Weddings fill your weekends.", [], findings)).toBe("uncited");
  });

  it("drops a line citing a finding that isn't there, and shows no page when fewer than two lines stand", async () => {
    const findings = await nina();
    const [service] = of(findings, "service");
    const [rule] = of(findings, "rule");
    const settled = settlePortrait(
      {
        paragraphs: [
          {
            sentences: [
              { text: "You've added Friday deliveries.", findingIds: [service.id] },
              { text: "You've added Friday deliveries and kept Sundays for yourself.", findingIds: [service.id, "not-a-finding"] },
              { text: "No more Sunday deliveries, as you told Jules.", findingIds: [rule.id] },
            ],
          },
        ],
      },
      findings
    );
    expect(text(settled)).toEqual([["You've added Friday deliveries.", "No more Sunday deliveries, as you told Jules."]]);
    expect(settlePortrait({ paragraphs: [{ sentences: [{ text: "You've added Friday deliveries.", findingIds: [service.id] }] }] }, findings)).toBeNull();
  });

  it("greets by the name Nina's mail goes out under, never by her business's name", async () => {
    const findings = await nina();
    expect(firstNameFor(findings)).toBe("Nina");
    const asBusiness = findings.map(finding =>
      finding.payload.kind === "owner" ? { ...finding, payload: { kind: "owner" as const, name: "Wildroot Flowers" } } : finding
    );
    expect(firstNameFor(asBusiness)).toBeNull();
  });

  it("is written again only when what it rests on changes", async () => {
    const findings = await nina();
    const confirmed = findings.map(finding => (finding.payload.kind === "rule" ? { ...finding, status: "confirmed" as const } : finding));
    expect(portraitBasis(findings)).toBe(portraitBasis([...findings].reverse()));
    expect(portraitBasis(confirmed)).not.toBe(portraitBasis(findings));
  });
});

describe("what the portrait needs from the reading (Nina)", () => {
  it("finds her own name and the weddings that fill her Saturdays", async () => {
    const findings = await nina();
    expect(of(findings, "owner").map(finding => finding.payload)).toEqual([{ kind: "owner", name: "Nina Vale" }]);
    expect(of(findings, "rhythm").map(finding => finding.payload)).toEqual([
      { kind: "rhythm", word: "wedding", days: [6], count: 5, titles: ["Garcia wedding", "Ito wedding", "Nguyen wedding"] },
    ]);
  });

  it("recognises the words the findings already use", () => {
    expect(stem("Weddings")).toBe(stem("wedding"));
    expect(stem("promises")).toBe(stem("promised"));
  });
});
