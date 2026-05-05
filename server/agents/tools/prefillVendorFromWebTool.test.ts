import { afterEach, describe, expect, it, vi } from "vitest";
import { prefillVendorFromWebTool } from "./prefillVendorFromWebTool";

describe("prefillVendorFromWebTool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches website HTML and returns structured extraction status", async () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">{"@type":"LocalBusiness","name":"Laundry Farm","telephone":"323-555-0101"}</script>
        </head>
        <body>
          <h1>Laundry Farm</h1>
          <p>Wash & Fold $2.50/lb</p>
          <p>Dress Shirt $6</p>
          <p>Hours: Weekdays 9 to 5</p>
        </body>
      </html>
    `;
    const fetchMock = vi.fn().mockResolvedValue(new Response(html, { status: 200, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await prefillVendorFromWebTool.execute({ sourceUrl: "https://laundry.farm/" }, {
      tenantId: "default",
      agentType: "vendor_agent",
      actorType: "ai_agent",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://laundry.farm/", expect.any(Object));
    expect(result.output).toMatchObject({
      ok: true,
      sourceUrl: "https://laundry.farm/",
      extractionStatus: "success",
      businessName: "Laundry Farm",
    });
    expect(result.output.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ serviceName: "Wash & Fold", basePriceCents: 250 }),
      expect.objectContaining({ serviceName: "Dress Shirt", basePriceCents: 600 }),
    ]));
  });

  it("returns failed status instead of silently succeeding when extraction fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html><body></body></html>", { status: 200 })));

    const result = await prefillVendorFromWebTool.execute({ sourceUrl: "https://empty.example/" }, {
      tenantId: "default",
      agentType: "vendor_agent",
      actorType: "ai_agent",
    });

    expect(result.output).toMatchObject({
      ok: false,
      sourceUrl: "https://empty.example/",
      extractionStatus: "failed",
      services: [],
    });
    expect(result.output.warnings).toContain("No visible service pricing was extracted.");
  });
});
