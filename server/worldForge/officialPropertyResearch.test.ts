import { describe, expect, it } from "vitest";
import { assertPublicResearchUrl, extractOfficialPropertyFacts } from "./officialPropertyResearch";

describe("official property research safety", () => {
  it("blocks private network targets", async () => {
    await expect(assertPublicResearchUrl("http://localhost/admin")).rejects.toThrow("private_target");
    await expect(assertPublicResearchUrl("https://internal.example", async () => [{ address: "10.0.0.4", family: 4 }] as never)).rejects.toThrow("private_target");
  });

  it("retains concise source-backed evidence instead of page bodies", () => {
    const facts = extractOfficialPropertyFacts({
      sourceUrl: "https://property.example/amenities",
      html: "<html><script>missile launcher</script><body><h1>Amenities</h1><p>Our rooftop pool and resident lounge overlook Los Angeles.</p></body></html>",
    });
    expect(facts.map(item => item.value.toLowerCase())).toEqual(["rooftop pool", "resident lounge"]);
    expect(JSON.stringify(facts)).not.toContain("missile launcher");
    expect(facts.every(item => item.sourceUrl === "https://property.example/amenities")).toBe(true);
  });
});
