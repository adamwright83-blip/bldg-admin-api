import { describe, expect, it } from "vitest";
import {
  extractZipFromAddress,
  fetchWebsiteTextSnippet,
  haversineDistanceMiles,
  verifyCandidateServiceArea,
} from "./vendorCandidateServiceAreaVerifier";

function mockFetch(text: string, options?: { ok?: boolean; status?: number; throwAbort?: boolean }): typeof fetch {
  return (async () => {
    if (options?.throwAbort) {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }
    return {
      ok: options?.ok ?? true,
      status: options?.status ?? 200,
      text: async () => text,
      body: null,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const OPUS_LA_COORDS = { lat: 34.1141, lng: -118.2932 };
const SUNSET_LIKE_COORDS = { lat: 34.2011, lng: -118.5739 }; // ~91306, San Fernando Valley

describe("extractZipFromAddress", () => {
  it("extracts the trailing ZIP from a formatted US address", () => {
    expect(extractZipFromAddress("123 Main St, Reseda, CA 91306, USA")).toBe("91306");
  });

  it("does not mistake a street number for the ZIP", () => {
    expect(extractZipFromAddress("90210 Sunset Blvd, Los Angeles, CA 90027, USA")).toBe("90027");
  });

  it("returns null for a null/empty address", () => {
    expect(extractZipFromAddress(null)).toBeNull();
    expect(extractZipFromAddress("")).toBeNull();
  });
});

describe("haversineDistanceMiles", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineDistanceMiles(OPUS_LA_COORDS, OPUS_LA_COORDS)).toBeCloseTo(0, 3);
  });

  it("returns a plausible ~20mi distance between 90027 and a San Fernando Valley point", () => {
    const distance = haversineDistanceMiles(SUNSET_LIKE_COORDS, OPUS_LA_COORDS);
    expect(distance).toBeGreaterThan(10);
    expect(distance).toBeLessThan(30);
  });
});

describe("fetchWebsiteTextSnippet", () => {
  it("returns skipped when no website is given", async () => {
    const result = await fetchWebsiteTextSnippet(null);
    expect(result).toEqual({ status: "skipped", reason: "no_website" });
  });

  it("returns the page text on a successful fetch", async () => {
    const result = await fetchWebsiteTextSnippet("https://example.com", { fetchFn: mockFetch("<html>hi</html>") });
    expect(result).toEqual({ status: "ok", text: "<html>hi</html>" });
  });

  it("returns failed on a non-2xx response, never throwing", async () => {
    const result = await fetchWebsiteTextSnippet("https://example.com", { fetchFn: mockFetch("", { ok: false, status: 404 }) });
    expect(result).toEqual({ status: "failed", reason: "http_status_404" });
  });

  it("returns failed (not a crash) on timeout/abort", async () => {
    const result = await fetchWebsiteTextSnippet("https://example.com", { fetchFn: mockFetch("", { throwAbort: true }) });
    expect(result.status).toBe("failed");
    expect((result as { reason: string }).reason).toBe("timeout");
  });

  it("caps the response body size when a streaming reader is available", async () => {
    const hugeChunk = new TextEncoder().encode("a".repeat(600_000));
    let read = false;
    const streamingFetch = (async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (read) return { done: true, value: undefined };
            read = true;
            return { done: false, value: hugeChunk };
          },
          cancel: async () => {},
        }),
      },
      text: async () => "",
    })) as unknown as typeof fetch;
    const result = await fetchWebsiteTextSnippet("https://example.com", { fetchFn: streamingFetch });
    expect(result.status).toBe("ok");
    expect((result as { text: string }).text.length).toBeLessThanOrEqual(500_000);
  });
});

describe("verifyCandidateServiceArea -- no form submission method exists in this module", () => {
  it("never imports or calls any form-submission/click/automation API", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "vendorCandidateServiceAreaVerifier.ts"), "utf8");
    expect(source).not.toMatch(/\.submit\(\)|puppeteer|playwright|sendSms|sendYelpMessage|placeCall|elevenlabs/i);
  });
});

describe("verifyCandidateServiceArea -- classification", () => {
  it("verifies a candidate whose address ZIP matches the target ZIP", async () => {
    const result = await verifyCandidateServiceArea({
      candidate: { address: "123 Main St, Los Angeles, CA 90027, USA", website: null, phone: "(323) 555-0100", coordinates: OPUS_LA_COORDS },
      targetZip: "90027",
      targetBuildingName: "OPUS LA",
    });
    expect(result.serviceAreaStatus).toBe("verified_serves_target");
    expect(result.targetZipMatched).toBe(true);
    expect(result.verificationConfidence).toBe("high");
  });

  it("verifies a candidate whose website explicitly mentions the target ZIP", async () => {
    const result = await verifyCandidateServiceArea({
      candidate: { address: "9000 Sunset Blvd, West Hollywood, CA 90069, USA", website: "https://example.com", phone: "555-1234", coordinates: null },
      targetZip: "90027",
      targetBuildingName: "OPUS LA",
      fetchFn: mockFetch("<html><body>We proudly serve 90027 and nearby areas. Contact us: hello@example.com</body></html>"),
    });
    expect(result.serviceAreaStatus).toBe("verified_serves_target");
    expect(result.websiteMentionsTargetZip).toBe(true);
  });

  it("Sunset Mobile Grooming fixture: far address + website service areas excluding target -> not verified, not email-ready", async () => {
    const sunsetWebsiteHtml = `
      <html><body>
        <h2>Service Areas</h2>
        <p>San Fernando Valley, Woodland Hills, West Hills, Tarzana, Encino, North Hollywood, Palisades, Malibu, Topanga Canyon, Santa Monica, Brentwood, Hollywood</p>
        <form action="/contact"><input name="email" /><button>Send</button></form>
        <p>Call us at (818) 555-0199</p>
      </body></html>
    `;
    const result = await verifyCandidateServiceArea({
      candidate: {
        address: "456 Valley Way, Reseda, CA 91306, USA",
        website: "https://sunsetmobilegrooming.example.com",
        phone: "(818) 555-0199",
        coordinates: SUNSET_LIKE_COORDS,
      },
      targetZip: "90027",
      targetBuildingName: "OPUS LA",
      fetchFn: mockFetch(sunsetWebsiteHtml),
    });

    expect(result.candidateAddressZip).toBe("91306");
    expect(result.targetZipMatched).toBe(false);
    expect(["unverified", "likely_out_of_area"]).toContain(result.serviceAreaStatus);
    expect(result.websiteMentionsTargetZip).toBe(false);
    expect(result.websiteServiceAreas.length).toBeGreaterThan(0);
    expect(result.emailAddressesFound).toEqual([]);
    expect(result.contactFormDetected).toBe(true);
    expect(result.phoneFound).toBe(true);
    expect(result.outreachReadiness).not.toBe("email_ready");
    expect(result.contactRoute).toBe("contact_form_available");
  });

  it("classifies as likely_serves_target when the address is close but no website confirmation exists", async () => {
    const result = await verifyCandidateServiceArea({
      candidate: { address: "100 Vermont Ave, Los Angeles, CA 90004, USA", website: null, phone: "555-1234", coordinates: { lat: 34.108, lng: -118.291 } },
      targetZip: "90027",
      targetBuildingName: "OPUS LA",
    });
    expect(result.serviceAreaStatus).toBe("likely_serves_target");
    expect(result.verificationConfidence).toBe("medium");
  });

  it("classifies as unverified when no address/coordinates/website evidence exists at all", async () => {
    const result = await verifyCandidateServiceArea({
      candidate: { address: null, website: null, phone: null, coordinates: null },
      targetZip: "90027",
      targetBuildingName: "OPUS LA",
    });
    expect(result.serviceAreaStatus).toBe("unverified");
    expect(result.verificationConfidence).toBe("low");
    expect(result.verificationSource).toBe("not_checked");
  });

  it("a website fetch failure produces a safe unverified-leaning result, never a crash", async () => {
    const result = await verifyCandidateServiceArea({
      candidate: { address: "1 Far Ave, Bakersfield, CA 93301, USA", website: "https://example.com", phone: "555-1234", coordinates: null },
      targetZip: "90027",
      targetBuildingName: "OPUS LA",
      fetchFn: mockFetch("", { ok: false, status: 500 }),
    });
    expect(result.websiteChecked).toBe(false);
    expect(result.serviceAreaReasons.some(r => r.includes("could not be checked"))).toBe(true);
  });

  it("detects an email address from a mailto link", async () => {
    const result = await verifyCandidateServiceArea({
      candidate: { address: "1 Main St, Los Angeles, CA 90027, USA", website: "https://example.com", phone: null, coordinates: null },
      targetZip: "90027",
      targetBuildingName: "OPUS LA",
      fetchFn: mockFetch('<html><a href="mailto:hello@example.com">Email us</a></html>'),
    });
    expect(result.emailAddressesFound).toContain("hello@example.com");
    expect(result.contactRoute).toBe("email_available");
    expect(result.outreachReadiness).toBe("email_ready");
  });

  it("detects an email address from plain visible text", async () => {
    const result = await verifyCandidateServiceArea({
      candidate: { address: "1 Main St, Los Angeles, CA 90027, USA", website: "https://example.com", phone: null, coordinates: null },
      targetZip: "90027",
      targetBuildingName: "OPUS LA",
      fetchFn: mockFetch("<html><body>Reach us at hello@example.com any time.</body></html>"),
    });
    expect(result.emailAddressesFound).toContain("hello@example.com");
  });

  it("detects a phone number from the Google Places candidate field", async () => {
    const result = await verifyCandidateServiceArea({
      candidate: { address: null, website: null, phone: "(555) 123-4567", coordinates: null },
      targetZip: "90027",
      targetBuildingName: "OPUS LA",
    });
    expect(result.phoneFound).toBe(true);
    expect(result.contactRoute).toBe("phone_available");
    expect(result.outreachReadiness).toBe("sms_or_call_required");
  });

  it("contact route is unknown / not_outreach_ready with no email, form, or phone", async () => {
    const result = await verifyCandidateServiceArea({
      candidate: { address: null, website: "https://example.com", phone: null, coordinates: null },
      targetZip: "90027",
      targetBuildingName: "OPUS LA",
      fetchFn: mockFetch("<html><body>Welcome to our site.</body></html>"),
    });
    expect(result.contactRoute).toBe("unknown");
    expect(result.outreachReadiness).toBe("not_outreach_ready");
  });

  it("never invokes a form-submission method -- only ever reads page text", async () => {
    let methodCalled: string | null = null;
    const spyFetch = (async (_url: string, init?: RequestInit) => {
      if (init?.method && init.method !== "GET") methodCalled = init.method;
      return { ok: true, status: 200, text: async () => "<html></html>", body: null } as unknown as Response;
    }) as unknown as typeof fetch;
    await verifyCandidateServiceArea({
      candidate: { address: null, website: "https://example.com", phone: null, coordinates: null },
      targetZip: "90027",
      targetBuildingName: "OPUS LA",
      fetchFn: spyFetch,
    });
    expect(methodCalled).toBeNull();
  });
});
