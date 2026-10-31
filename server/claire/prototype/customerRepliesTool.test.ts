import { describe, expect, it } from "vitest";
import { CLAIRE_FIRST_CHAPTER_TOOLS, CLAIRE_PROTOTYPE_TOOLS, executeTool, type ToolContext } from "./tools";

const ctx = { tenantId: "t1", timeZone: "America/Los_Angeles", now: () => new Date("2026-10-31T19:00:00Z") } as unknown as ToolContext;

describe("Claire can read who wrote back, and never mistakes not watching for no replies", () => {
  it("offers the read on calls, read-only, and not in the first-ten page's single tool", () => {
    const tool = CLAIRE_PROTOTYPE_TOOLS.find(t => t.name === "read_customer_replies");
    expect(tool?.description).toContain("never call it a booking, a sale or a new customer");
    expect(tool?.description).toContain("never say nobody has written back");
    expect(CLAIRE_FIRST_CHAPTER_TOOLS.map(t => t.name)).toEqual(["read_first_chapter"]);
  });

  it("with reply detection off, says it isn't watching instead of returning an empty answer", async () => {
    delete process.env.GMAIL_REPLY_DETECTION;
    const result = await executeTool(ctx, "read_customer_replies", {});
    expect(result.wrote).toBe(false);
    expect(result.output).toMatchObject({ watching: "off", replies: [] });
  });
});
