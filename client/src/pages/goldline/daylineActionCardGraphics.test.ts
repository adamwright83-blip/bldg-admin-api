import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  DaylineWorldCompositor,
  daylineObjectSource,
} from "./DaylineWorldCompositor";
import type {
  DayPlanStop,
  DayPlanStopKind,
} from "../driver/goldlineDayPlanModel";

const stop = (kind: DayPlanStopKind, id: string): DayPlanStop => ({
  id,
  kind,
  title: `Canonical customer ${id}`,
  timeLabel: "9:00–11:00 AM",
  address: "123 Actual Street",
  source: "living_world",
  sourceLabel: "Canonical",
  sortKey: id,
  estimatedMinutes: null,
  status: "ready",
  fixed: true,
  navigationUrl: null,
  missionTarget: null,
  completedAt: null,
});
describe("illustrated mission objects", () => {
  it.each(["pickup", "sales", "dropoff", "growth", "marketing"] as const)(
    "binds canonical copy inside the %s object button",
    kind => {
      const item = stop(kind, "source-42");
      const html = renderToStaticMarkup(
        createElement(DaylineWorldCompositor, {
          stops: [item],
          onSelect: () => {},
        })
      );
      const object = html.match(
        /<button[^>]*data-action-slot-id="source-42"[\s\S]*?<\/button>/
      )?.[0];
      expect(object).toBeDefined();
      expect(object).toContain(`data-object-kind="${kind}"`);
      expect(object).toContain("gdp-plaque-art");
      expect(html).toContain("approved-reference.png");
      // Landmarks are already painted in the scene plate, not hidden duplicate PNGs.
      expect(html).not.toContain("gdp-object-landmark-ref");
      expect(object).toContain(item.title);
      expect(object).toContain(item.address);
      expect(object).toContain(item.timeLabel);
      expect(html).not.toContain("gdp-v3-inscriptions");
      expect(html).not.toContain("gdp-v3-action-entry");
    }
  );
  it("keeps four source IDs inside one sales environment, without a group-level proxy action", () => {
    const html = renderToStaticMarkup(
      createElement(DaylineWorldCompositor, {
        stops: [1, 2, 3, 4].map(i => stop("sales", `sales-${i}`)),
        onSelect: () => {},
      })
    );
    expect(html.match(/data-art-landmark="sales"/g)).toHaveLength(1);
    expect(html.match(/data-action-slot-id=/g)).toHaveLength(4);
    expect(html).not.toContain("gdp-v3-landmark-object");
  });
  it("ships distinct alpha artwork, including corrected overhead chest and puzzle", () => {
    for (const kind of ["dropoff", "marketing", "sales"] as const) {
      const file = new URL(
        `../../../../public${daylineObjectSource(kind)}`,
        import.meta.url
      );
      const artwork = readFileSync(file);
      expect(artwork.subarray(0, 4).toString()).toBe("RIFF");
      expect(artwork.subarray(8, 12).toString()).toBe("WEBP");
    }
  });
});
