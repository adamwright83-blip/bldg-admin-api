import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const controller = readFileSync(
  new URL("./GoldlineDriverController.tsx", import.meta.url),
  "utf8"
);
const city = readFileSync(
  new URL(
    "../../components/admin/control-room/LanternCitySceneV6/LanternCityScene.tsx",
    import.meta.url
  ),
  "utf8"
);

describe("Lantern City gameplay handoff", () => {
  it("carries operation identity, binding, existing host, and surface", () => {
    for (const key of [
      "lanternOperation",
      "lanternChapter",
      "lanternBinding",
      "lanternHost",
      "lanternSurface",
    ])
      expect(city).toContain(key);
  });
  it("consumes the launch and mounts the requested existing gameplay host", () => {
    expect(controller).toContain('get("lanternHost")');
    expect(controller).toContain(
      "useState<ExistingGameplayHost | null>(launchHost)"
    );
    expect(controller).toContain('launchSurface !== "overland"');
    expect(controller).toContain(
      "requestedGameplayHost={requestedGameplayHost}"
    );
    expect(controller).toContain("data-lantern-operation-id");
    expect(controller).toContain("data-lantern-rendered-host");
  });
});
