import { describe, expect, it } from "vitest";
import {
  fitGoldlineWorldEventIdempotencyKey,
  GOLDLINE_WORLD_EVENT_IDEMPOTENCY_MAX,
} from "./worldEventStore";

describe("goldline world event idempotency keys", () => {
  it("keeps short keys unchanged", () => {
    expect(fitGoldlineWorldEventIdempotencyKey("campaign-published:default:campaign:default:2026-09-01:v1")).toBe(
      "campaign-published:default:campaign:default:2026-09-01:v1"
    );
  });

  it("fits a four-member territory publish key into varchar(191)", () => {
    const key =
      "territory-published:default:territory:default:visit_hunt:44444444-4444-4444-8444-444444444441,44444444-4444-4444-8444-444444444442,44444444-4444-4444-8444-444444444443,44444444-4444-4444-8444-444444444444:1";
    expect(key.length).toBeGreaterThan(GOLDLINE_WORLD_EVENT_IDEMPOTENCY_MAX);
    const fitted = fitGoldlineWorldEventIdempotencyKey(key);
    expect(fitted.length).toBeLessThanOrEqual(GOLDLINE_WORLD_EVENT_IDEMPOTENCY_MAX);
    expect(fitted).toBe(fitGoldlineWorldEventIdempotencyKey(key));
  });
});
