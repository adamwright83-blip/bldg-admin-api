import { z } from "zod";
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
 * Nina's example: Astra's portrait, word for word, each line citing the findings that hold it in Nina's invented
 * records. It answers what the person said during the example: a rule they changed or a finding they took away
 * changes or removes the lines that rested on it. No model is called; the lines are checked like any other.
 */
export function examplePortraitWriter(): PortraitWriter {
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
