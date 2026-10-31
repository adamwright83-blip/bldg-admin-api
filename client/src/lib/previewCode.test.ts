import { describe, expect, it } from "vitest";
import { redactPreviewCode } from "./previewCode";
import { scrubProperties } from "./posthog";

describe("the first-ten preview code never reaches analytics (#783 review)", () => {
  it("is redacted from any recorded URL, wherever it sits in the query", () => {
    expect(redactPreviewCode("https://admin.bldg.chat/joystick-start?crew=a-long-random-preview-code")).toBe("https://admin.bldg.chat/joystick-start?crew=[redacted]");
    expect(redactPreviewCode("https://x.example/joystick-start?session=1&crew=secret#first-ten=a.b")).toBe("https://x.example/joystick-start?session=1&crew=[redacted]#first-ten=a.b");
    expect(redactPreviewCode("https://x.example/joystick-start?session=1")).toBe("https://x.example/joystick-start?session=1");
  });

  it("is scrubbed from PostHog event properties", () => {
    const properties: Record<string, unknown> = {
      $current_url: "https://admin.bldg.chat/joystick-start?crew=a-long-random-preview-code",
      $referrer: "https://admin.bldg.chat/x?crew=another-code",
      count: 3,
      authorization: "Bearer x",
    };
    scrubProperties(properties);
    expect(properties).toEqual({
      $current_url: "https://admin.bldg.chat/joystick-start?crew=[redacted]",
      $referrer: "https://admin.bldg.chat/x?crew=[redacted]",
      count: 3,
    });
  });
});
