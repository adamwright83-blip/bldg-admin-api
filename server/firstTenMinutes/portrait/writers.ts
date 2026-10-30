import { z } from "zod";
import type { ExampleKey } from "../../../shared/firstTenMinutesExample";
import type { FindingKind, FindingPayload, FindingView } from "../../../shared/firstTenMinutesFindings";
import { invokeLLM } from "../../_core/llm";
import { portraitSchema, type PortraitDraft, type PortraitWriter } from "./write";

/** Claude writes the portrait (server/_core/llm.ts, structured output), attributed to this journey's AI spend. */
export function claudePortraitWriter(journeyId: string): PortraitWriter {
  return {
    async write({ system, corpus }) {
      const result = await invokeLLM({
        tenantId: `first_ten:${journeyId}`,
        feature: "first_ten_portrait",
        maxTokens: 2048,
        messages: [
          { role: "system", content: system },
          { role: "user", content: corpus },
        ],
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "first_ten_portrait", strict: true, schema: z.toJSONSchema(portraitSchema) as Record<string, unknown> },
        },
      });
      const content = result.choices[0]?.message.content;
      if (typeof content !== "string") throw new Error("The portrait came back empty");
      return portraitSchema.parse(JSON.parse(content));
    },
  };
}

type Of<K extends FindingKind> = FindingView & { payload: Extract<FindingPayload, { kind: K }> };

/**
 * An example's portrait. Nina's is Astra's, word for word; Dev's is written the same way for his invented records.
 * Each line cites the findings that hold it, and answers what the person said during the example: a rule they changed
 * or a finding they took away changes or removes the lines that rested on it. No model is called; the lines are
 * checked like any other.
 */
export function examplePortraitWriter(key: ExampleKey = "nina"): PortraitWriter {
  return key === "dev" ? devPortraitWriter() : ninaPortraitWriter();
}

function standingOf(findings: readonly FindingView[]) {
  const standing = findings.filter(finding => finding.status !== "dismissed" && finding.status !== "changed");
  const all = <K extends FindingKind>(kind: K) => standing.filter((finding): finding is Of<K> => finding.payload.kind === kind);
  const one = <K extends FindingKind>(kind: K, test: (finding: Of<K>) => boolean = () => true) => all(kind).find(test) ?? null;
  const ids = (...items: Array<FindingView | null | FindingView[]>) =>
    items.flat().filter((item): item is FindingView => Boolean(item)).map(item => item.id);
  const line = (text: string, findingIds: string[]) => (findingIds.length ? [{ text, findingIds }] : []);
  return { all, one, ids, line };
}

function devPortraitWriter(): PortraitWriter {
  return {
    async write({ findings }): Promise<PortraitDraft> {
      const { all, one, ids, line } = standingOf(findings);
      const business = one("business");
      const contrast = one("contrast");
      const siteVisit = all("rule").filter(finding => /site visit/i.test(finding.payload.quote));
      const replies = all("reply").filter(finding => !finding.payload.declined);
      const estimate = one("estimate");
      const scope = one("scope");
      return {
        paragraphs: [
          {
            sentences: [
              ...line("Your work runs between homes and small businesses around Highland Park.", business && contrast ? ids(business, all("place"), contrast) : []),
              ...line("The businesses need it fixed before they open; the homeowners bring a list.", ids(contrast)),
            ],
          },
          {
            sentences: [
              ...line("You only quote after a site visit.", ids(siteVisit)),
              ...line("You answer the same day, with a time.", replies.length >= 3 ? ids(replies) : []),
            ],
          },
          { sentences: [...line("An estimate still holds more than the client asked for first.", estimate && scope ? ids(estimate, scope) : [])] },
        ].filter(paragraph => paragraph.sentences.length),
      };
    },
  };
}

function ninaPortraitWriter(): PortraitWriter {
  return {
    async write({ findings }): Promise<PortraitDraft> {
      const live = findings.filter(finding => finding.status !== "dismissed");
      const standing = live.filter(finding => finding.status !== "changed");
      const all = <K extends FindingKind>(kind: K, from: FindingView[] = standing) =>
        from.filter((finding): finding is Of<K> => finding.payload.kind === kind);
      const one = <K extends FindingKind>(kind: K, test: (finding: Of<K>) => boolean = () => true) => all(kind).find(test) ?? null;
      const ids = (...items: Array<FindingView | null | FindingView[]>) =>
        items.flat().filter((item): item is FindingView => Boolean(item)).map(item => item.id);

      const weddings = one("rhythm", finding => finding.payload.word === "wedding");
      const contrast = one("contrast");
      const service = one("service", finding => /friday/i.test(finding.payload.name));
      const route = one("route", finding => finding.payload.weekday === 5);
      const regular = all("request").filter(finding => finding.payload.recurring);
      const isJules = (name: string | null | undefined) => /^jules\b/i.test(name ?? "");
      const jules = one("person", finding => isJules(finding.payload.person.name));
      const julesFrame = one("reply", finding => /\bjules\b/i.test(finding.payload.quote));
      const julesInstall = one("request", finding => isJules(finding.payload.from.name));
      const promise = one("promise");
      const kept = all("reply").filter(finding => !finding.payload.declined && !/\bjules\b/i.test(finding.payload.quote));
      const sundays = one("rule", finding => /sunday/i.test(finding.payload.quote));
      const hotels = all("place").filter(finding => finding.payload.category === "hotel");

      const line = (text: string, findingIds: string[]) => (findingIds.length ? [{ text, findingIds }] : []);
      return {
        paragraphs: [
          {
            sentences: [
              ...line("Weddings fill your weekends.", ids(weddings, contrast)),
              ...line("You're building a steadier weekday business around hotel flowers.", ids(service, route, regular)),
            ],
          },
          {
            sentences: [
              ...line("Jules handles the installations.", ids(jules, julesFrame, julesInstall)),
              ...line("You carry the promises: what arrives, when it arrives, and what the client actually agreed to.", ids(promise, kept)),
            ],
          },
          {
            sentences: [
              ...(sundays
                ? line("You've added Friday deliveries and kept Sundays for yourself.", ids(service, sundays))
                : line("You've added Friday deliveries.", ids(service))),
              ...line("The next hotel conversation should fit the business you're building now.", ids(hotels, service)),
            ],
          },
        ].filter(paragraph => paragraph.sentences.length),
      };
    },
  };
}
