import { describe, expect, it } from "vitest";
import { CoverageLedger, failureReason } from "./coverage";
import { privateAddress, publicEnricher, publicHostname } from "./enrichment";
import { REDACTED, redactSensitive, sensitiveDocumentReason } from "./privacy";
import { ProviderError } from "../providerFetch";

describe("privacy", () => {
  it("redacts cards (Luhn), SSNs, IBANs, labelled account and routing numbers, and written-out passwords", () => {
    const text = [
      "Card 4111 1111 1111 1111 on file.",
      "SSN 123-45-6789.",
      "IBAN GB82 WEST 1234 5698 7654 32 please.",
      "Account number: 004512339871, routing 121000358.",
      "password: hunter2",
      "Order 1234567890123 is ordinary.",
    ].join("\n");
    const out = redactSensitive(text);
    for (const secret of ["4111 1111 1111 1111", "123-45-6789", "GB82 WEST", "004512339871", "121000358", "hunter2"]) expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
    expect(out).toContain("Order 1234567890123 is ordinary.");
  });

  it("redacts bare secrets by their issuers' formats, and passwords inside connection URLs", () => {
    // built from parts so no secret-shaped literal sits in the source
    const anthropic = ["sk", "ant", "api03", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4"].join("-");
    const stripe = ["sk", "live", "51H8xYzAbCdEfGhIjKlMnOp"].join("_");
    const google = "AIza" + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6";
    const github = "ghp" + "_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
    const text = `Claire test: ${anthropic}\nstripe ${stripe}\nmaps ${google}\n${github}\nmysql://root:hunter22@db.example:3306/app`;
    const out = redactSensitive(text);
    for (const secret of [anthropic, stripe, google, github, "hunter22"]) expect(out).not.toContain(secret);
    expect(out).toContain("Claire test:");
    // ordinary business text is untouched
    const plain = "Skip the ask-for-more step; GHP Laundry, eyJ notes; task-management-and-operations-review-checklist-2026";
    expect(redactSensitive(plain)).toBe(plain);
  });

  it("never reads a key file, by name or by contents", () => {
    expect(sensitiveDocumentReason("10292026 Claire_Test_Anthropic_api_key")).toBe("credentials");
    expect(sensitiveDocumentReason("2026-10-21 STRIPE & google API KEY")).toBe("credentials");
    expect(sensitiveDocumentReason("Credentials Rotation Checklist")).toBe("credentials");
    expect(sensitiveDocumentReason("Keys rotation plan")).toBe("credentials");
    expect(sensitiveDocumentReason("Untitled document", `notes\n${["sk", "ant", "api03", "A1b2C3d4E5f6G7h8I9j0K1l2"].join("-")}`)).toBe("credentials");
    expect(sensitiveDocumentReason("Key accounts plan", "Our key accounts this quarter")).toBeNull();
    expect(sensitiveDocumentReason("Token economics for the loyalty program")).toBeNull();
  });

  it("excludes personal finance and records, keeps a business's own books", () => {
    expect(sensitiveDocumentReason("Personal banking")).toBe("personal_finance");
    expect(sensitiveDocumentReason("2025 tax return")).toBe("personal_records");
    expect(sensitiveDocumentReason("Passwords")).toBe("credentials");
    expect(sensitiveDocumentReason("Accounts", "my checking balance deposit withdrawal")).toBe("personal_finance");
    expect(sensitiveDocumentReason("Laundry P&L 2026", "Revenue Expenses Margin")).toBeNull();
    expect(sensitiveDocumentReason("Invoices", "Customer Amount Paid")).toBeNull();
  });
});

describe("coverage", () => {
  it("knows a span was searched only when successful windows cover it", () => {
    const ledger = new CoverageLedger(() => new Date("2026-10-31"));
    ledger.record({ source: "gmail", operation: "sent_window", target: "q", status: "ok", items: 3, window: { from: new Date("2026-08-01"), to: new Date("2026-09-01") } });
    ledger.record({ source: "gmail", operation: "sent_window", target: "q", status: "failed", items: 0, window: { from: new Date("2026-09-01"), to: new Date("2026-10-01") } });
    ledger.record({ source: "gmail", operation: "sent_window", target: "q", status: "empty", items: 0, window: { from: new Date("2026-10-01"), to: new Date("2026-10-31") } });
    expect(ledger.covered("gmail", new Date("2026-08-01"), new Date("2026-09-01"))).toBe(true);
    expect(ledger.covered("gmail", new Date("2026-08-01"), new Date("2026-10-31"))).toBe(false);
    expect(ledger.summary().find(item => item.source === "gmail")!.state).toBe("partial");
    expect(ledger.summary().find(item => item.source === "sheets")!.state).toBe("not_attempted");
  });

  it("failure reasons are codes, never bodies", () => {
    expect(failureReason(new ProviderError("google", 403, "Google answered 403 (SERVICE_DISABLED)"))).toBe("403 SERVICE_DISABLED");
    expect(failureReason(new Error("message body with secrets"))).toBe("error");
  });
});

describe("public enrichment", () => {
  it("is off by default and never looks up social profiles", async () => {
    const ledger = new CoverageLedger();
    const enricher = publicEnricher(ledger, { env: {}, fetch: (async () => { throw new Error("must not fetch"); }) as any });
    expect((await enricher.website("rinsefarm.example")).status).toBe("disabled");
    expect((await enricher.social("linkedin", "someone")).status).toBe("unsupported");
  });

  it("reads only a public business domain's title and description, honouring robots.txt", async () => {
    const ledger = new CoverageLedger();
    const pages: Record<string, Response> = {};
    const fetcher = (async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private", { status: 200 });
      return new Response('<html><title>Rinse Farm &amp; Co</title><meta name="description" content="Laundry pickup in LA"></html>', { status: 200 });
    }) as any;
    void pages;
    const publicDns = async () => ["93.184.216.34"];
    const enricher = publicEnricher(ledger, { env: { JOYSTICK_PUBLIC_ENRICHMENT: "on" }, fetch: fetcher, resolve: publicDns });
    expect(await enricher.website("https://www.rinsefarm.example/about")).toMatchObject({ status: "found", title: "Rinse Farm & Co", description: "Laundry pickup in LA" });
    expect((await enricher.website("gmail.com")).status).toBe("disallowed");
    expect((await enricher.website("10.0.0.1")).status).toBe("disallowed");
    expect(publicHostname("localhost")).toBeNull();
    expect(publicHostname("api.railway.internal")).toBeNull();
    const blocked = publicEnricher(ledger, { env: { JOYSTICK_PUBLIC_ENRICHMENT: "on" }, fetch: (async () => new Response("User-agent: *\nDisallow: /", { status: 200 })) as any, resolve: publicDns });
    expect((await blocked.website("private.example")).status).toBe("disallowed");
  });

  it("never follows a public site to an internal address (redirects checked hop by hop, names resolved)", async () => {
    const ledger = new CoverageLedger();
    const requested: string[] = [];
    const redirecting = (async (url: string) => {
      requested.push(url);
      return new Response("", { status: 302, headers: { location: "http://127.0.0.1:8080/admin" } });
    }) as any;
    const enricher = publicEnricher(ledger, { env: { JOYSTICK_PUBLIC_ENRICHMENT: "on" }, fetch: redirecting, resolve: async () => ["93.184.216.34"] });
    expect((await enricher.website("bouncy.example")).status).toBe("failed");
    expect(requested.every(url => url.startsWith("https://bouncy.example/"))).toBe(true);
    // a public name that resolves to a private address is refused before any request
    const rebinding = publicEnricher(ledger, { env: { JOYSTICK_PUBLIC_ENRICHMENT: "on" }, fetch: (async () => { throw new Error("must not fetch"); }) as any, resolve: async () => ["10.1.2.3"] });
    expect((await rebinding.website("rebind.example")).status).toBe("failed");
    expect(["127.0.0.1", "10.0.0.5", "172.20.1.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"].every(privateAddress)).toBe(true);
    expect(privateAddress("93.184.216.34")).toBe(false);
  });
});
