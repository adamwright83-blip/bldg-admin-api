import { describe, expect, it } from "vitest";
import corpus from "../../../shared/firstTenMinutesExampleCorpus.json";
import { objectNames, UNDERSTANDING_COPY, type FindingView } from "../../../shared/firstTenMinutesFindings";
import { findingIds, type DraftFinding } from "./draft";
import { habitFindings, imageFindings, peopleFindings, plainImageName, routeFindings } from "./deterministic";
import { exampleGeocoder, exampleReaders } from "./exampleReaders";
import { exampleExtractor } from "./extractors";
import {
  CONVERSATIONS_SYSTEM,
  conversationCorpus,
  conversationExtractionSchema,
  verifyConversations,
  verifyWork,
  workCorpus,
  type ConversationExtraction,
} from "./extract";
import { linkOpportunities, nowOffers } from "./opportunity";
import { clusteredPlaces, routeMeetsPlace, streetOf } from "./places";
import { mergeDrafts } from "./run";
import { closingSentence, findVerbatim, looksAutomated, parseAddressList, stripQuotedReply } from "./text";

const ids = findingIds("journey-under-test");

async function exampleReading() {
  const readers = exampleReaders();
  const extractor = exampleExtractor();
  const owner = await readers.owner();
  const sent = (await readers.sentMail(160)).items;
  const received = (await readers.receivedMail(240)).items;
  const now = readers.now();
  const day = 24 * 60 * 60 * 1000;
  const events = (await readers.calendar({ from: new Date(now.getTime() - 90 * day), to: new Date(now.getTime() + 30 * day) })).items;
  const files = (await readers.drive(60)).items;
  const { corpus: text, items } = conversationCorpus(sent, received, owner);
  const conversations = verifyConversations(await extractor.conversations({ system: CONVERSATIONS_SYSTEM, corpus: text }), items, owner, ids);
  let all = mergeDrafts([
    ...peopleFindings(sent, received, owner, ids),
    ...habitFindings(sent, ids),
    ...imageFindings(sent, ids),
    ...routeFindings(events, ids),
    ...conversations,
  ]);
  const work = await extractor.work({ system: "", corpus: workCorpus({ files, slack: [], events, verified: all }) });
  all = mergeDrafts([...all, ...verifyWork(work, { files, slack: [] }, ids)]);
  const { placeFindings } = await import("./places");
  await placeFindings(all, exampleGeocoder());
  return { all, owner, sent, received, items, events, files, opportunities: linkOpportunities(all, [], ids) };
}

const ofKind = <K extends DraftFinding["payload"]["kind"]>(all: DraftFinding[], kind: K) =>
  all.filter(finding => finding.payload.kind === kind) as Array<DraftFinding & { payload: Extract<DraftFinding["payload"], { kind: K }> }>;

describe("text", () => {
  it("finds a quote in its source despite case, curly quotes and spacing, and returns the source's own words", () => {
    const source = "Thank you, that dinner was a joy. We’re only doing events at the moment.";
    expect(findVerbatim(source, "we're ONLY doing  events")).toBe("We’re only doing events");
    expect(findVerbatim(source, "We're only doing weddings")).toBeNull();
    expect(findVerbatim(source, "We")).toBeNull();
  });

  it("reads what someone wrote, not the history under it, and how they ended it", () => {
    const body = "Before 10 it is. Shall I start you on the 11th?\n\nNina\n\nOn Sep 4, 2026, Teo wrote:\n> Yes please!";
    expect(stripQuotedReply(body)).toBe("Before 10 it is. Shall I start you on the 11th?\n\nNina");
    expect(closingSentence(body)).toBe("Shall I start you on the 11th?");
    expect(closingSentence("Hi Sam,\n\nWould Friday suit?\n\nNina Vale\nWildroot Flowers · Silver Lake")).toBe("Would Friday suit?");
    expect(closingSentence("Thanks,\nNina")).toBeNull();
  });

  it("reads addresses and leaves automated mail out", () => {
    expect(parseAddressList('"Ruiz, Elena" <Elena@LarkspurHotel.example>, jules@julesmoreau.example')).toEqual([
      { name: "Ruiz, Elena", email: "elena@larkspurhotel.example" },
      { name: null, email: "jules@julesmoreau.example" },
    ]);
    expect(looksAutomated({ from: "no-reply@stripe.example" })).toBe(true);
    expect(looksAutomated({ from: "elena@larkspurhotel.example", listUnsubscribe: true })).toBe(true);
    expect(looksAutomated({ from: "elena@larkspurhotel.example" })).toBe(false);
  });
});

describe("the example reading (Nina)", () => {
  it("meets the people Nina writes to, most first", async () => {
    const { all } = await exampleReading();
    const people = ofKind(all, "person");
    expect(people[0].payload.person.name).toBe("Jules Moreau");
    expect(people.every(person => !person.payload.person.address.includes("flowermarket"))).toBe(true);
  });

  it("finds Rook's habit with Astra's two endings, from Nina's own sent mail", async () => {
    const { all } = await exampleReading();
    const [habit] = ofKind(all, "habit");
    expect(habit.payload.examples).toEqual(["Would Friday suit?", "Shall I bring two?"]);
    expect(habit.payload.share).toBeGreaterThan(0.5);
    expect(habit.sources.map(source => source.label)).toEqual(["You, to Sam Okafor", "You, to Hannah Price"]);
  });

  it("finds Luma's blue jug: one photograph, three proposals", async () => {
    const { all } = await exampleReading();
    const [image] = ofKind(all, "image");
    expect(image.payload).toMatchObject({ name: "blue jug", uses: 3, inWhat: "proposals" });
    expect(plainImageName("IMG_4023.jpg")).toBeNull();
  });

  it("finds Orren's Friday route, in the order the calendar runs it", async () => {
    const { all } = await exampleReading();
    const [route] = ofKind(all, "route");
    expect(route.payload).toMatchObject({ title: "Friday delivery", weekday: 5, occurrences: 8 });
    expect(route.payload.stops.map(stop => stop.label)).toEqual(["Café Lumen", "Juniper Yoga", "Mercer"]);
    expect(route.payload.stops.every(stop => stop.lat !== null)).toBe(true);
  });

  it("keeps every quote the reading cites, in the source's own words, with the right person", async () => {
    const { all } = await exampleReading();
    const [rule] = ofKind(all, "rule");
    expect(rule.payload).toMatchObject({ quote: "No more Sunday deliveries.", saidTo: { name: "Jules Moreau" } });
    expect(rule.payload.at.startsWith("2026-08-12")).toBe(true);
    // the same rule written in the service sheet joins it as a second source
    expect(rule.sources.map(source => source.excerpt)).toEqual(["No more Sunday deliveries.", "No Sunday deliveries."]);
    expect(ofKind(all, "request")).toHaveLength(7);
    expect(ofKind(all, "reply")).toHaveLength(7);
    expect(ofKind(all, "place").map(place => place.payload.name)).toEqual(["The Larkspur Hotel", "Hotel Wren", "The Alder House"]);
    expect(clusteredPlaces(ofKind(all, "place").map(place => place.payload))).toBe(true);
    const [contrast] = ofKind(all, "contrast");
    expect(contrast.payload.aLine).toBe("Your wedding clients ask for a spectacular day.");
    for (const finding of all) {
      for (const source of finding.sources) {
        if (source.provider !== "gmail") continue;
        const message = corpus.messages.find(candidate => candidate.id === source.ref)!;
        const attachments = message.attachments.map(attachment => attachment.filename).join("\n");
        expect(`${message.subject}\n${message.body}\n${attachments}`).toContain(source.excerpt);
      }
    }
  });

  it("finds Ilex's opportunity: Elena asked before Friday delivery existed, and the route passes the hotel", async () => {
    const { opportunities, all } = await exampleReading();
    const [first, second] = opportunities;
    expect(first.payload).toMatchObject({
      type: "became_possible",
      person: { name: "Elena Ruiz", address: "elena@larkspurhotel.example" },
      along: "street",
    });
    expect(first.payload.kind === "opportunity" && first.payload.summary).toBe(
      "Elena Ruiz asked in April, before you offered weekly Friday delivery. You offer it now."
    );
    expect(all.find(finding => finding.id === (first.payload.kind === "opportunity" ? first.payload.placeId : ""))?.payload).toMatchObject({
      name: "The Larkspur Hotel",
    });
    expect(second.payload).toMatchObject({ person: { name: "Priya Shah" }, along: "nearby" });
    expect(first.sources.map(source => source.excerpt)).toEqual([
      "Could you do fresh arrangements every Friday?",
      "We're only doing events at the moment. Ask me again once we have a Friday delivery.",
      "Wildroot has a weekly Friday delivery",
      "Friday delivery, every week.",
    ]);
  });

  it("puts real names on the crew's objects as they arrive", async () => {
    const { all } = await exampleReading();
    const views: FindingView[] = all.map(draft => ({ id: draft.id, companion: draft.companion, status: "proposed", payload: draft.payload, sources: draft.sources, correction: null }));
    expect(objectNames(views)).toEqual({ map: "Wildroot Flowers", folder: "Weekly Friday delivery", photograph: "blue jug", notebook: "Jules Moreau" });
    expect(UNDERSTANDING_COPY.people).toBe("Meeting the people you write to.");
  });
});

describe("what the model may not do", () => {
  it("drops invented quotes, rules someone else wrote, requests the owner made, and figures in a contrast", async () => {
    const { items, owner } = await exampleReading();
    const invented: ConversationExtraction = conversationExtractionSchema.parse({
      business: { name: "Wildroot Flowers & Gifts", offering: "flowers", sourceId: "nina-m02", quote: "Wildroot Flowers · Silver Lake" },
      rules: [
        { sourceId: "nina-m14", quote: "No more Saturday deliveries.", statement: "No Saturdays" },
        { sourceId: "nina-m15", quote: "Saturday works for the Hawthorne install.", statement: "Saturday installs" },
      ],
      promises: [],
      requests: [{ sourceId: "nina-m06", quote: "Ask me again once we have a Friday delivery.", wants: "x", recurring: false }],
      replies: [{ sourceId: "nina-m06", quote: "We're only doing events at the moment.", requestSourceId: "nina-m07", declined: true, missing: "Friday delivery" }],
      services: [{ sourceId: "nina-m05", quote: "Could you do fresh arrangements every Friday?", service: "Friday flowers" }],
      places: [{ name: "The Ritz", category: "hotel", sourceId: "nina-m05", quote: "The Larkspur Hotel", address: "1 Main St" }],
      contrast: {
        a: { sourceId: "nina-m01", quote: "We want the day to feel spectacular.", line: "Your 3 wedding clients ask for a spectacular day." },
        b: { sourceId: "nina-m07", quote: "We need something we can count on every week for the lobby.", line: "The hotels want weekly flowers." },
      },
    });
    expect(verifyConversations(invented, items, owner, ids)).toEqual([]);
  });

  it("only links a became-possible chain that holds in order", () => {
    expect(nowOffers("Friday delivery", { kind: "service", name: "Weekly Friday delivery", quote: "x", at: "2026-09-03T00:00:00Z" })).toBe(true);
    expect(nowOffers("weekly hotel flowers", { kind: "service", name: "Weekly Friday delivery", quote: "Wildroot has a weekly Friday delivery", at: "2026-09-03T00:00:00Z" })).toBe(false);
    const request: DraftFinding = { id: "q", companion: null, rank: 0, sources: [], payload: { kind: "request", from: { name: "A", address: "a@x.example" }, quote: "q", wants: "Friday flowers", recurring: true, at: "2026-04-18T00:00:00Z", subject: null } };
    const reply: DraftFinding = { id: "r", companion: null, rank: 0, sources: [], payload: { kind: "reply", to: { name: "A", address: "a@x.example" }, quote: "r", requestId: "q", declined: true, missing: "Friday delivery", at: "2026-04-19T00:00:00Z" } };
    const before: DraftFinding = { id: "s", companion: null, rank: 0, sources: [], payload: { kind: "service", name: "Friday delivery", quote: "s", at: "2026-04-01T00:00:00Z" } };
    expect(linkOpportunities([request, reply, before], [{ type: "became_possible", requestFindingId: "q", replyFindingId: "r", serviceFindingId: "s", summary: "x" }], ids)).toEqual([]);
  });

  it("reads streets and distances, not travel times", () => {
    expect(streetOf("2304 Hyperion Avenue, Los Angeles, CA 90027")).toBe("hyperion ave");
    expect(streetOf("The Hawthorne courtyard, Los Angeles")).toBeNull();
    const route = { kind: "route" as const, title: "Friday", weekday: 5, occurrences: 3, since: "", stops: [{ label: "A", location: "2215 Hyperion Ave, LA", lat: 34.0972, lng: -118.2742 }] };
    const place = { kind: "place" as const, name: "P", category: "hotel", address: "2304 Hyperion Ave, LA", neighborhood: null, lat: null, lng: null, people: [] };
    expect(routeMeetsPlace(route, place)).toBe("street");
    expect(routeMeetsPlace(route, { ...place, address: "9 Elm St", lat: 34.0975, lng: -118.2745 })).toBe("nearby");
    expect(routeMeetsPlace(route, { ...place, address: "9 Elm St", lat: 34.2, lng: -118.5 })).toBeNull();
  });
});
