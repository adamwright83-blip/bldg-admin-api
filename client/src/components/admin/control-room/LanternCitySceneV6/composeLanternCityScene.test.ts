import { describe, it, expect } from "vitest";
import { composeLanternCityScene, overlaps } from "./composeLanternCityScene";
import { DEFAULT_CONTROLS } from "./sceneTypes";
import { CANONICAL_BUILDING_GEOGRAPHY } from "@shared/canonicalGeography";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";
import {
  LANTERN_TERRITORIES,
  territoryCenter,
} from "@shared/lanternTerritories";
import type { GeographicCustomer } from "../customerGeography";
function customer(
  id: string,
  latitude: number,
  longitude: number,
  state: "active" | "dimming" | "dark" = "active",
  address: string | null = null
): GeographicCustomer {
  return {
    identityKey: id,
    displayName: id,
    phone: null,
    cadence: { state, daysSinceLastOrder: state === "active" ? 1 : 45 },
    location: {
      latitude,
      longitude,
      ...projectLatLngToLanternAtlas({ latitude, longitude }),
      canonicalAddress: address,
    },
  };
}
function fixture() {
  const customers: GeographicCustomer[] = [];
  for (const [id, count] of [
    ["opus_la", 9],
    ["century_park_east", 6],
  ] as const) {
    const geo = CANONICAL_BUILDING_GEOGRAPHY[id];
    for (let i = 0; i < count; i++)
      customers.push(
        customer(
          `${id}:${i}`,
          geo.latitude,
          geo.longitude,
          "active",
          geo.address
        )
      );
  }
  for (const id of [
    "beverly-hills",
    "los-feliz",
    "silver-lake",
    "east-hollywood",
    "downtown",
  ]) {
    const geo = territoryCenter(LANTERN_TERRITORIES.find(t => t.id === id)!);
    customers.push(customer(id, geo.latitude, geo.longitude));
  }
  return customers;
}
const compose = (
  customers: GeographicCustomer[] = [],
  width = 1920,
  height = 1080
) =>
  composeLanternCityScene({
    customers,
    atlasReady: true,
    viewport: { width, height },
  });
describe("V6 truthful scene composition", () => {
  it("produces no customer light in an empty city", () => {
    const scene = compose();
    expect(scene.objects.filter(o => o.kind === "lantern")).toEqual([]);
    expect(scene.objects.filter(o => o.cluster)).toEqual([]);
  });
  it("preserves geographic anchors, customer records and stronghold counts", () => {
    const customers = fixture();
    const snapshot = JSON.stringify(customers);
    const scene = compose(customers);
    for (const id of ["opus_la", "century_park_east"] as const) {
      const object = scene.objects.find(o => o.id === id)!;
      expect(object).toBeDefined();
      expect(object.cluster!.total).toBe(id === "opus_la" ? 9 : 6);
      expect(object.worldAnchor).toEqual(
        projectLatLngToLanternAtlas(CANONICAL_BUILDING_GEOGRAPHY[id])
      );
      expect(object.displayAnchor).not.toEqual(object.worldAnchor);
      expect(object.cluster!.customers.every(c => customers.includes(c))).toBe(
        true
      );
    }
    expect(JSON.stringify(customers)).toBe(snapshot);
  });
  it.each([
    [1920, 1080],
    [1440, 900],
    [1280, 900],
  ])(
    "reserves HUD and prevents object collisions at %ix%i",
    (width, height) => {
      const scene = compose(fixture(), width, height);
      expect(scene.objects.filter(o => o.kind === "stronghold")).toHaveLength(
        2
      );
      for (const object of scene.objects) {
        expect(scene.exclusions.some(r => overlaps(r, object.bounds))).toBe(
          false
        );
        expect(
          scene.objects.some(
            other => other !== object && overlaps(other.bounds, object.bounds)
          )
        ).toBe(false);
        expect(object.labelBounds.x).toBeGreaterThanOrEqual(object.bounds.x);
        expect(
          object.labelBounds.y + object.labelBounds.height
        ).toBeLessThanOrEqual(object.bounds.y + object.bounds.height);
      }
    }
  );
  it("uses existing infestation assets for empty authored districts without erasing guarded truth", () => {
    const scene = compose();
    for (const id of ["mid-city", "west-hollywood"]) {
      const truth = scene.truth.find(t => t.occupancy.territory.id === id)!;
      expect(truth.environment).toBe("infested");
      expect(truth.customers).toHaveLength(0);
      expect(
        scene.objects.find(o => o.territoryId === id)?.cluster
      ).toBeUndefined();
      expect(
        scene.props.some(
          p => p.territoryId === id && p.src.endsWith("rat-hero.png")
        )
      ).toBe(true);
    }
    expect(
      scene.truth.find(t => t.occupancy.territory.id === "west-hollywood")!
        .occupancy.guarded
    ).toBe(true);
  });
  it("changes state from current records and never uses screenshot values", () => {
    const geo = territoryCenter(
      LANTERN_TERRITORIES.find(t => t.id === "mid-city")!
    );
    const c = customer("first-order", geo.latitude, geo.longitude);
    expect(
      compose([c]).truth.find(t => t.occupancy.territory.id === "mid-city")!
        .environment
    ).toBe("healthy");
    const dormant = Array.from({ length: 5 }, (_, i) =>
      customer(`quiet:${i}`, geo.latitude, geo.longitude, "dark")
    );
    expect(
      compose(dormant).truth.find(t => t.occupancy.territory.id === "mid-city")!
        .state
    ).toBe("closed_construction");
  });
  it("does not manufacture territory states while data is unavailable", () => {
    const scene = composeLanternCityScene({
      customers: [],
      atlasReady: false,
      viewport: { width: 1440, height: 900 },
    });
    expect(scene.objects).toEqual([]);
    expect(scene.truth).toEqual([]);
  });
  it("keeps state evidence stable when visibility controls change", () => {
    const customers = fixture();
    const scene = composeLanternCityScene({
      customers,
      atlasReady: true,
      viewport: { width: 1920, height: 1080 },
      controls: { ...DEFAULT_CONTROLS, lanterns: false, labels: false },
    });
    expect(scene.truth).toEqual(compose(customers).truth);
    expect(scene.objects.filter(o => o.kind === "lantern")).toEqual([]);
    expect(scene.artStatus).toBe("BLOCKED ON ART");
    expect(scene.plates.every(p => p.src === null)).toBe(true);
  });
  it("hiding labels preserves the world positions for the art acceptance test", () => {
    const customers = fixture();
    const visible = compose(customers);
    const hidden = composeLanternCityScene({
      customers,
      atlasReady: true,
      viewport: { width: 1920, height: 1080 },
      controls: { ...DEFAULT_CONTROLS, labels: false },
    });
    expect(hidden.objects.map(o => [o.id, o.bounds])).toEqual(
      visible.objects.map(o => [o.id, o.bounds])
    );
  });
  it("a prospect never changes its occupied territory into a locked environment", () => {
    const geo = territoryCenter(
      LANTERN_TERRITORIES.find(t => t.id === "mid-city")!
    );
    const scene = composeLanternCityScene({
      customers: [customer("occupied", geo.latitude, geo.longitude)],
      atlasReady: true,
      viewport: { width: 1920, height: 1080 },
      controls: { ...DEFAULT_CONTROLS, opportunities: true },
      prospects: [
        {
          id: 1,
          name: "Real prospect",
          latitude: geo.latitude,
          longitude: geo.longitude,
          worldAnchor: projectLatLngToLanternAtlas(geo),
        },
      ],
    });
    expect(
      scene.truth.find(t => t.occupancy.territory.id === "mid-city")!
        .environment
    ).toBe("healthy");
    expect(
      scene.objects
        .filter(o => o.prospectId === 1)
        .every(o => o.environment === "healthy")
    ).toBe(true);
  });
  it("retains physical address clusters beneath a neighborhood overview aggregate", () => {
    const geo = territoryCenter(
      LANTERN_TERRITORIES.find(t => t.id === "mid-city")!
    );
    const customers = [
      customer(
        "address-a",
        geo.latitude,
        geo.longitude,
        "active",
        "100 Test Avenue"
      ),
      customer(
        "address-b",
        geo.latitude + 0.0001,
        geo.longitude,
        "active",
        "200 Test Avenue"
      ),
    ];
    const object = compose(customers).objects.find(
      o => o.territoryId === "mid-city"
    )!;
    expect(object.cluster!.total).toBe(2);
    expect(object.sourceClusters).toHaveLength(2);
    expect(object.sourceClusters!.map(c => c.customers[0])).toEqual(customers);
    expect(object.sourceClusters!.map(c => c.canonicalAddress)).toEqual([
      "100 Test Avenue",
      "200 Test Avenue",
    ]);
  });
  it("has deterministic layout, including suppression", () => {
    expect(compose(fixture(), 1280, 900)).toEqual(
      compose(fixture(), 1280, 900)
    );
  });
});
