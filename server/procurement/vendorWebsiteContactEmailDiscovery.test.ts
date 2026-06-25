import { describe, expect, it } from "vitest";
import { discoverWebsiteContactEmail, isPlatformOrGeneratedEmail } from "./vendorWebsiteContactEmailDiscovery";

function mockFetch(responses: Record<string, { ok?: boolean; status?: number; html?: string; throwAbort?: boolean }>): typeof fetch {
  return (async (url: string) => {
    const entry = responses[url];
    if (!entry) return { ok: false, status: 404, text: async () => "", body: null } as unknown as Response;
    if (entry.throwAbort) {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }
    return { ok: entry.ok ?? true, status: entry.status ?? 200, text: async () => entry.html ?? "", body: null } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("discoverWebsiteContactEmail -- safety/no-website/bad-website handling", () => {
  it("handles no website safely", async () => {
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: null });
    expect(result.emailDiscoveryStatus).toBe("skipped_no_website");
    expect(result.primaryEmail).toBeNull();
  });

  it("handles an invalid website URL safely, never throwing", async () => {
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "not a url" });
    expect(result.emailDiscoveryStatus).toBe("invalid_website");
  });

  it("rejects a non-http(s) URL scheme", async () => {
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "ftp://example.com" });
    expect(result.emailDiscoveryStatus).toBe("invalid_website");
  });

  it("handles a fetch timeout safely, never throwing", async () => {
    const fetchFn = mockFetch({ "https://example.com/": { throwAbort: true } });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.emailDiscoveryStatus).toBe("website_unreachable");
  });

  it("handles a bad/unreachable website (non-2xx) safely", async () => {
    const fetchFn = mockFetch({ "https://example.com/": { ok: false, status: 500 } });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.emailDiscoveryStatus).toBe("website_unreachable");
  });

  it("returns no_email_found (not unreachable) when the homepage loads but has no email", async () => {
    const fetchFn = mockFetch({ "https://example.com/": { html: "<html><body>Welcome</body></html>" } });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.emailDiscoveryStatus).toBe("no_email_found");
  });
});

describe("discoverWebsiteContactEmail -- email extraction", () => {
  it("extracts a mailto email from the homepage", async () => {
    const fetchFn = mockFetch({ "https://example.com/": { html: '<a href="mailto:hello@vendor.com">Email</a>' } });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.primaryEmail).toBe("hello@vendor.com");
    expect(result.discoverySource).toBe("mailto");
  });

  it("extracts a visible plain-text email", async () => {
    const fetchFn = mockFetch({ "https://example.com/": { html: "<body>Reach us at hello@vendor.com any time.</body>" } });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.primaryEmail).toBe("hello@vendor.com");
  });

  it("rejects noreply/no-reply/donotreply/example/test emails, never returning them as primary", async () => {
    const fetchFn = mockFetch({
      "https://example.com/": { html: "<body>noreply@vendor.com no-reply@vendor.com donotreply@vendor.com test@vendor.com hello@example.com</body>" },
    });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.emailsFound).toEqual([]);
    expect(result.primaryEmail).toBeNull();
    expect(result.emailDiscoveryStatus).toBe("no_email_found");
  });

  it("never guesses or invents an email from the domain name when none appears on the page", async () => {
    const fetchFn = mockFetch({ "https://vendor.com/": { html: "<body>Welcome to our site, no email here.</body>" } });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://vendor.com/", fetchFn });
    expect(result.primaryEmail).toBeNull();
    expect(result.emailsFound).not.toContain("info@vendor.com");
  });

  it("normalizes emails to lowercase and deduplicates", async () => {
    const fetchFn = mockFetch({ "https://example.com/": { html: "<body>Hello@Vendor.com hello@vendor.com</body>" } });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.emailsFound).toEqual(["hello@vendor.com"]);
  });
});

describe("discoverWebsiteContactEmail -- contact-page link following", () => {
  it("follows a same-domain contact page link when the homepage has no email", async () => {
    const fetchFn = mockFetch({
      "https://example.com/": { html: '<a href="/contact">Contact us</a><a href="/about">About</a>' },
      "https://example.com/contact": { html: "<body>Email us: hello@vendor.com</body>" },
    });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.primaryEmail).toBe("hello@vendor.com");
    expect(result.discoverySource).toBe("contact_page");
    expect(result.pagesChecked).toContain("https://example.com/contact");
  });

  it("does not follow an external link", async () => {
    const fetchFn = mockFetch({
      "https://example.com/": { html: '<a href="https://otherdomain.com/contact">Contact</a>' },
    });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.pagesChecked).toEqual(["https://example.com/"]);
    expect(result.pagesChecked).not.toContain("https://otherdomain.com/contact");
  });

  it("caps total pages fetched at 3 (homepage + 2 contact-like pages)", async () => {
    const fetchFn = mockFetch({
      "https://example.com/": { html: '<a href="/contact">Contact</a><a href="/about">About</a><a href="/services">Services</a><a href="/service-area">Service Area</a>' },
      "https://example.com/contact": { html: "<body>no email here</body>" },
      "https://example.com/about": { html: "<body>no email here either</body>" },
      "https://example.com/services": { html: "<body>also no email</body>" },
      "https://example.com/service-area": { html: "<body>still none</body>" },
    });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.pagesChecked.length).toBeLessThanOrEqual(3);
  });

  it("stops once an email is found, never checking unnecessary additional pages", async () => {
    let contactFetched = false;
    let aboutFetched = false;
    const fetchFn = (async (url: string) => {
      if (url === "https://example.com/") return { ok: true, status: 200, text: async () => '<a href="/contact">Contact</a><a href="/about">About</a>', body: null } as unknown as Response;
      if (url === "https://example.com/contact") { contactFetched = true; return { ok: true, status: 200, text: async () => "<body>hello@vendor.com</body>", body: null } as unknown as Response; }
      if (url === "https://example.com/about") { aboutFetched = true; return { ok: true, status: 200, text: async () => "<body>secondary@vendor.com</body>", body: null } as unknown as Response; }
      return { ok: false, status: 404, text: async () => "", body: null } as unknown as Response;
    }) as unknown as typeof fetch;
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.primaryEmail).toBe("hello@vendor.com");
    expect(contactFetched).toBe(true);
    expect(aboutFetched).toBe(false);
  });
});

describe("discoverWebsiteContactEmail -- contact form / phone detection without submission", () => {
  it("detects a contact form without submitting it", async () => {
    const fetchFn = mockFetch({ "https://example.com/": { html: '<form action="/submit"><input name="email" /></form>' } });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.contactFormDetected).toBe(true);
  });

  it("detects a phone number in page text", async () => {
    const fetchFn = mockFetch({ "https://example.com/": { html: "<body>Call us at (555) 123-4567</body>" } });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.phoneDetected).toBe(true);
  });

  it("no POST/form-submission code path exists in this module", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "vendorWebsiteContactEmailDiscovery.ts"), "utf8");
    expect(source).not.toMatch(/method:\s*["']POST["']|\.submit\(\)|puppeteer|playwright/i);
  });
});

describe("discoverWebsiteContactEmail -- isolation", () => {
  it("never invokes an outreach/send adapter", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "vendorWebsiteContactEmailDiscovery.ts"), "utf8");
    expect(source).not.toMatch(/sendSms\(|sendYelpMessage\(|placeCall\(|elevenlabs\(|sendVendorEmailViaAgentMail/i);
  });
});

describe("isPlatformOrGeneratedEmail (Slice 82f)", () => {
  it("rejects the exact Sentry/Wix DSN address that produced the false positive", () => {
    expect(isPlatformOrGeneratedEmail("dd0a55ccb8124b9c9d938e3acf41f8aa@sentry.wixpress.com")).toBe(true);
  });

  it("rejects any address under sentry.wixpress.com or wixpress.com generally", () => {
    expect(isPlatformOrGeneratedEmail("abc123@sentry.wixpress.com")).toBe(true);
    expect(isPlatformOrGeneratedEmail("hello@static.wixpress.com")).toBe(true);
  });

  it("rejects a hashed/generated local-part regardless of domain", () => {
    expect(isPlatformOrGeneratedEmail("dd0a55ccb8124b9c9d938e3acf41f8aa@some-other-domain.com")).toBe(true);
  });

  it("never rejects a normal business email", () => {
    expect(isPlatformOrGeneratedEmail("info@vendor-domain.com")).toBe(false);
    expect(isPlatformOrGeneratedEmail("hello@vendor-domain.com")).toBe(false);
    expect(isPlatformOrGeneratedEmail("booking@vendor-domain.com")).toBe(false);
    expect(isPlatformOrGeneratedEmail("janedoe@gmail.com")).toBe(false);
  });
});

describe("discoverWebsiteContactEmail -- Slice 82f platform/generated email rejection", () => {
  it("rejects the Sentry/Wix DSN found via mailto, falling back to no_email_found", async () => {
    const fetchFn = mockFetch({ "https://example.com/": { html: '<a href="mailto:dd0a55ccb8124b9c9d938e3acf41f8aa@sentry.wixpress.com">Contact</a>' } });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.primaryEmail).toBeNull();
    expect(result.emailDiscoveryStatus).toBe("no_email_found");
  });

  it("rejects the Sentry/Wix DSN found as plain text inside an inline script tag", async () => {
    const fetchFn = mockFetch({
      "https://example.com/": { html: '<html><body>Welcome</body><script>var x = {dsn: "dd0a55ccb8124b9c9d938e3acf41f8aa@sentry.wixpress.com"};</script></html>' },
    });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.primaryEmail).toBeNull();
  });

  it("a real vendor email is still found when it coexists with a platform/Sentry email on the page", async () => {
    const fetchFn = mockFetch({
      "https://example.com/": { html: '<body>Email us at hello@vendor.com</body><script>var x = "dd0a55ccb8124b9c9d938e3acf41f8aa@sentry.wixpress.com";</script>' },
    });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.primaryEmail).toBe("hello@vendor.com");
  });

  it("an unclosed trailing <script> tag (response truncated mid-bundle) does not leak embedded JS into the plain-text email scan", async () => {
    // Simulates the real failure mode: a response cap landing in the
    // middle of a large inline script, leaving no closing </script>
    // anywhere in the captured text.
    const truncatedHtml = '<html><body>Welcome</body><script>var sentryDsn = "dd0a55ccb8124b9c9d938e3acf41f8aa@sentry.wixpress.com"; var moreJunk = "lots of unrelated bundle code here without a closing tag';
    const fetchFn = mockFetch({ "https://example.com/": { html: truncatedHtml } });
    const result = await discoverWebsiteContactEmail({ candidateName: "Test", website: "https://example.com/", fetchFn });
    expect(result.primaryEmail).toBeNull();
  });
});
