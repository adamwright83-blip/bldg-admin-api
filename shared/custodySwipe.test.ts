import { describe, expect, it } from "vitest";
import { isCarouselTap, resolveCarouselSwipe } from "./custodySwipe";

describe("resolveCarouselSwipe", () => {
  it("advances on a deliberate horizontal drag", () => {
    expect(
      resolveCarouselSwipe({ deltaX: 40, deltaY: 6, elapsedMs: 180 })
    ).toBe("next");
    expect(
      resolveCarouselSwipe({ deltaX: -40, deltaY: 6, elapsedMs: 180 })
    ).toBe("prev");
  });

  it("advances on a quick horizontal flick", () => {
    expect(
      resolveCarouselSwipe({ deltaX: 18, deltaY: 4, elapsedMs: 40 })
    ).toBe("next");
  });

  it("ignores mostly vertical movement", () => {
    expect(
      resolveCarouselSwipe({ deltaX: 12, deltaY: 48, elapsedMs: 120 })
    ).toBeNull();
  });

  it("ignores tiny movement", () => {
    expect(
      resolveCarouselSwipe({ deltaX: 8, deltaY: 2, elapsedMs: 200 })
    ).toBeNull();
  });
});

describe("isCarouselTap", () => {
  it("treats small movement as a tap", () => {
    expect(isCarouselTap(4, 3)).toBe(true);
    expect(isCarouselTap(20, 0)).toBe(false);
  });
});
