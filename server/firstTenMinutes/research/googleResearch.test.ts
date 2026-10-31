import { describe, expect, it } from "vitest";
import { fakeAccess, fakeGoogle } from "../testSupport/fakeGoogle";
import { SCENARIO_NOW, SYNTHETIC_NAMES, onboardingScenario } from "../testSupport/onboardingScenario";
import { CoverageLedger } from "./coverage";
import { GOOGLE_SHEET, columnLetters, googleResearch, parseCsv, passagesOf, selectPassages, withRetry } from "./googleResearch";
import { ProviderError } from "../providerFetch";

const names = SYNTHETIC_NAMES;
const now = () => SCENARIO_NOW;
const noSleep = async () => undefined;

function setup(overrides: Partial<ReturnType<typeof onboardingScenario>> = {}, scopes?: string[]) {
  const data = { ...onboardingScenario(names), ...overrides };
  const google = fakeGoogle(data, { now: SCENARIO_NOW });
  const ledger = new CoverageLedger(now);
  const research = googleResearch(fakeAccess(names.owner.email, scopes), ledger, { fetch: google.fetch, now, sleep: noSleep });
  return { data, google, ledger, research };
}

describe("Gmail research: sent first, across time, bounded", () => {
  it("reads a few of the owner's own messages from every month, and records which months it covered", async () => {
    const { research, ledger } = setup();
    const windows = (await research.sentHistory({ months: 12, perWindow: 5 }))!;
    expect(windows).toHaveLength(12);
    const march = windows.find(window => window.from.toISOString().startsWith("2026-03"))!;
    expect(march.items.some(item => /Website proposal/.test(item.subject))).toBe(true);
    const later = windows.filter(window => window.from >= new Date("2026-05-01"));
    expect(later.flatMap(window => window.items).some(item => /Website proposal/.test(item.subject))).toBe(false);
    // every item is the owner's own, never a newsletter
    expect(windows.flatMap(window => window.items).every(item => item.sentByOwner && !item.automated)).toBe(true);
    // bounded: the busy months say more existed, so a sample of them proves nothing about what wasn't read
    expect(windows.some(window => window.truncated)).toBe(true);
    expect(ledger.covered("gmail", new Date("2026-05-01"), new Date("2026-10-31"))).toBe(false);
    // a targeted search that read every result is what covers the quiet months
    const after = new Date("2026-05-01");
    const targeted = (await research.searchMail('in:sent "website"', { window: { from: after, to: SCENARIO_NOW }, limit: 50 }))!;
    expect(targeted.items).toEqual([]);
    expect(ledger.covered("gmail", after, SCENARIO_NOW)).toBe(true);
  });

  it("searches beyond the sample for one person, and reads a whole conversation", async () => {
    const { research } = setup();
    const found = (await research.searchMail(`from:${names.collaborator.email} OR to:${names.collaborator.email}`))!;
    expect(found.items.length).toBe(3);
    const thread = (await research.readThread(found.items.find(item => item.threadId === "collab-ops")!.threadId))!;
    expect(thread.map(message => message.sentByOwner)).toEqual([true, false]);
    expect(thread[1].text).toContain("updated the drivers tab");
  });

  it("redacts account and routing numbers in snippets and bodies", async () => {
    const { research } = setup();
    const found = (await research.searchMail("statement"))!;
    expect(found.items).toHaveLength(1);
    expect(found.items[0].snippet).not.toMatch(/004512339871|121000358/);
    const message = (await research.readMessage(found.items[0].id))!;
    expect(message.text).not.toMatch(/004512339871|121000358/);
    expect(message.text).toContain("[redacted]");
  });

  it("a Gmail failure is recorded as failed coverage, never as an empty mailbox", async () => {
    const { research, ledger } = setup({ fail: { gmail: { status: 500, reason: "backendError" } } });
    expect(await research.searchMail("in:sent")).toBeNull();
    const windows = (await research.sentHistory({ months: 3 }))!;
    expect(windows.every(window => window.failed)).toBe(true);
    expect(ledger.summary().find(item => item.source === "gmail")!.state).toBe("failed");
    expect(ledger.covered("gmail", new Date("2026-09-01"), new Date("2026-10-31"))).toBe(false);
  });

  it("without the Gmail grant, it says not granted rather than nothing found", async () => {
    const { research, ledger } = setup({}, ["https://www.googleapis.com/auth/drive.readonly"]);
    expect(await research.searchMail("anything")).toBeNull();
    expect(ledger.summary().find(item => item.source === "gmail")!.state).toBe("not_granted");
  });
});

describe("Docs: actual contents, by passage, with provenance", () => {
  it("returns passages that mention the focus, with their index and offset in the document", async () => {
    const { research } = setup();
    const files = (await research.searchDrive([names.collaborator.first]))!;
    const manual = files.find(file => file.id === "doc-ops")!;
    expect(manual.lastModifiedBy?.email).toBe(names.collaborator.email);
    const read = (await research.readDocument(manual, { focus: [names.collaborator.first], maxPassages: 3 }))!;
    expect(read.excluded).toBeNull();
    const lead = read.passages.find(passage => passage.text.includes("Operations lead"))!;
    expect(lead).toBeTruthy();
    const original = onboardingScenario(names).files.find(file => file.id === "doc-ops")!.text!;
    expect(original.slice(lead.offset, lead.offset + 15)).toBe(lead.text.slice(0, 15));
  });

  it("a document that can't be read is failed coverage for that document", async () => {
    const { research, ledger } = setup({ failItems: { "doc-roadmap": { status: 403, reason: "insufficientFilePermissions" } } });
    const [roadmap] = (await research.searchDrive([`${names.product} roadmap`]))!;
    expect(await research.readDocument(roadmap)).toBeNull();
    const entry = ledger.all().find(item => item.operation === "read_document")!;
    expect(entry.status).toBe("failed");
    expect(entry.reason).toBe("403 insufficientFilePermissions");
  });
});

describe("Sheets: real contents through the Sheets API under drive.readonly", () => {
  it("reads tab names, headings, the opening rows, the most recent rows and formulas; skips hidden tabs", async () => {
    const { research, google } = setup();
    const [routes] = (await research.searchDrive([`${names.business} routes`], { mimeTypes: [GOOGLE_SHEET] }))!;
    const read = (await research.readSpreadsheet(routes))!;
    expect(read.via).toBe("sheets_api");
    expect(read.tabTitles).toEqual(["Routes", "Drivers", "Old"]);
    expect(read.tabs.map(tab => tab.title)).toEqual(["Routes", "Drivers"]);
    const tab = read.tabs[0];
    expect(tab.headers).toEqual(["Date", "Route", "Stops", "Driver", "Revenue"]);
    expect(tab.lastRow).toBe(62);
    // the most recent rows, not just the top of the sheet
    expect(tab.rows.at(-1)!.row).toBe(62);
    expect(tab.rows.some(row => row.cells[0] === "2026-09-29")).toBe(true);
    expect(tab.truncated).toBe(true);
    expect(tab.formulas).toContainEqual({ cell: "E62", formula: "=SUM(E2:E61)" });
    expect(read.tabs[1].rows[0].cells).toContain("Operations lead");
    // bounded: two batch reads plus metadata, never the whole sheet
    expect(google.calls.filter(call => call.startsWith("sheets.googleapis.com")).length).toBeLessThanOrEqual(4);
  });

  it("leaves a personal banking spreadsheet out entirely", async () => {
    const { research, ledger } = setup();
    const [banking] = (await research.searchDrive(["banking"]))!;
    const read = (await research.readSpreadsheet(banking))!;
    expect(read.excluded).toBe("personal_finance");
    expect(read.tabs).toEqual([]);
    expect(JSON.stringify(ledger.all())).not.toMatch(/004512339871|121000358/);
  });

  it("a formula carrying a sensitive literal is redacted like its cell", async () => {
    const data = onboardingScenario(names);
    data.files.push({
      id: "sheet-cards",
      name: "Supplier cards",
      mimeType: GOOGLE_SHEET,
      modifiedTime: "2026-10-01T00:00:00Z",
      sheets: [{ title: "Cards", rows: [["Supplier", "Card"], ["Acme", "4111111111111111"]], formulas: { B2: '="4111111111111111"' } }],
    });
    const { research } = setup({ files: data.files });
    const read = (await research.readSpreadsheet((await research.searchDrive(["Supplier cards"]))![0]))!;
    expect(JSON.stringify(read)).not.toContain("4111111111111111");
    expect(read.tabs[0].formulas[0].formula).toContain("[redacted]");
  });

  it("a count reads nothing, so it never covers a window", async () => {
    const { research, ledger } = setup();
    const window = { from: new Date("2026-05-01"), to: SCENARIO_NOW };
    expect(await research.countMail("in:sent", window)).toBeGreaterThan(0);
    expect(ledger.covered("gmail", window.from, window.to)).toBe(false);
  });

  it("drops columns headed with bank details even inside a business sheet", async () => {
    const data = onboardingScenario(names);
    data.files.push({
      id: "sheet-payroll",
      name: "Driver payroll",
      mimeType: GOOGLE_SHEET,
      modifiedTime: "2026-10-01T00:00:00Z",
      sheets: [{ title: "Pay", rows: [["Driver", "Hours", "Account number"], ["Kim", "32", "99887766554"]] }],
    });
    const { research } = setup({ files: data.files });
    const read = (await research.readSpreadsheet((await research.searchDrive(["payroll"]))![0]))!;
    expect(read.tabs[0].droppedColumns).toEqual(["Account number"]);
    expect(JSON.stringify(read)).not.toContain("99887766554");
  });

  it("when the Sheets API is disabled, reads the first tab through Drive and says only that was read", async () => {
    const { research, ledger } = setup({ fail: { sheets: { status: 403, reason: "SERVICE_DISABLED" } } });
    const [launch] = (await research.searchDrive([`${names.product} launch`]))!;
    const read = (await research.readSpreadsheet(launch))!;
    expect(read.via).toBe("drive_csv_export");
    expect(read.note).toBe("Only the first tab could be read.");
    expect(read.tabs[0].headers).toEqual(["Task", "Owner", "Due", "Status"]);
    const entry = ledger.all().find(item => item.source === "sheets")!;
    expect(entry.status).toBe("partial");
    expect(entry.reason).toContain("SERVICE_DISABLED");
    expect(ledger.summary().find(item => item.source === "sheets")!.state).toBe("partial");
  });

  it("when both the Sheets API and Drive fail, it is failed coverage", async () => {
    const { research, ledger } = setup({ fail: { sheets: { status: 403, reason: "SERVICE_DISABLED" } }, failItems: { "sheet-launch": { status: 403, reason: "cannotExportFile" } } });
    const [launch] = (await research.searchDrive([`${names.product} launch`]))!;
    expect(await research.readSpreadsheet(launch)).toBeNull();
    expect(ledger.summary().find(item => item.source === "sheets")!.state).toBe("failed");
  });
});

describe("Calendar: who was there, and whether it repeats", () => {
  it("finds the weekly sync with its attendee and series", async () => {
    const { research } = setup();
    const events = (await research.searchCalendar({ from: new Date("2026-05-01"), to: SCENARIO_NOW, query: names.collaborator.first }))!;
    expect(events.length).toBeGreaterThan(10);
    expect(events.every(event => event.seriesId === "sync")).toBe(true);
    expect(events[0].attendees).toEqual([{ name: `${names.collaborator.first} ${names.collaborator.last}`, email: names.collaborator.email }]);
  });
});

describe("helpers", () => {
  it("retries rate limits and server errors, not refusals", async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls += 1;
      if (calls < 3) throw new ProviderError("google", 429, "Google answered 429");
      return "ok";
    }, noSleep)).resolves.toBe("ok");
    calls = 0;
    await expect(withRetry(async () => {
      calls += 1;
      throw new ProviderError("google", 403, "Google answered 403");
    }, noSleep)).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("splits documents into passages and prefers those that mention the focus", () => {
    const text = Array.from({ length: 30 }, (_, index) => `Paragraph ${index} ${index === 20 ? "mentions Vega" : "is ordinary"}. ${"x".repeat(300)}`).join("\n\n");
    const passages = passagesOf(text, 700);
    expect(passages.length).toBeGreaterThan(10);
    const chosen = selectPassages(passages, ["vega"], 3);
    expect(chosen.some(passage => passage.text.includes("mentions Vega"))).toBe(true);
    expect(chosen).toHaveLength(3);
  });

  it("columns and CSV", () => {
    expect([1, 26, 27, 52, 703].map(columnLetters)).toEqual(["A", "Z", "AA", "AZ", "AAA"]);
    expect(parseCsv('a,"b,c","d ""e"""\n1,2,3').map(row => row.cells)).toEqual([["a", "b,c", 'd "e"'], ["1", "2", "3"]]);
  });
});
