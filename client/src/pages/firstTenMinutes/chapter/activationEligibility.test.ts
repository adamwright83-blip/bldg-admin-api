import { describe, expect, it } from "vitest";
import { activationQueryEnabled } from "./activationEligibility";

const open = {
  hasCredentials: true,
  hasDraft: false,
  portraitKept: false,
  stage: "portrait" as string | null,
};

describe("signup does not wait on a customer draft", () => {
  it("stays closed until there is a journey to attach it to", () => {
    expect(activationQueryEnabled({ ...open, hasCredentials: false, hasDraft: true, portraitKept: true })).toBe(false);
  });

  it("opens for a kept portrait with no opportunity and no draft", () => {
    expect(activationQueryEnabled({ ...open, portraitKept: true, stage: "chapter" })).toBe(true);
  });

  it("opens on the existing draft, and on the way back from checkout", () => {
    expect(activationQueryEnabled({ ...open, hasDraft: true })).toBe(true);
    expect(activationQueryEnabled({ ...open, stage: "activation" })).toBe(true);
  });

  it("stays closed while the crew is still reading", () => {
    expect(activationQueryEnabled({ ...open, stage: "crew" })).toBe(false);
    expect(activationQueryEnabled({ ...open, stage: "connect" })).toBe(false);
  });
});
