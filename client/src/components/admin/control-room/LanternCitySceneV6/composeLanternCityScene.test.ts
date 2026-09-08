import { describe, it, expect } from "vitest";
import {
  composeLanternCityScene,
  overlaps,
  territoryStateText,
} from "./composeLanternCityScene";
import { DEFAULT_CONTROLS } from "./sceneTypes";
import { SCENE_ART } from "./sceneAssets";
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
    // Scene-level acceptance stays BLOCKED regardless of which individual
    // territory plates happen to have pilot art wired — a plate has a src
    // only when SCENE_ART actually supplies one for that territory/state.
    expect(
      scene.plates.every(
        p => (p.src === null) === !SCENE_ART.territories[p.territoryId]?.[p.state]
      )
    ).toBe(true);
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
  it("anchors a single-address lantern to the real customer location, not the territory centroid", () => {
    const geo = territoryCenter(
      LANTERN_TERRITORIES.find(t => t.id === "silver-lake")!
    );
    // Offset the real customer slightly away from the territory center
    // (small enough to stay inside the territory) so the two anchors are
    // distinguishable.
    const offset = { latitude: geo.latitude + 0.0015, longitude: geo.longitude };
    const c = customer(
      "one-address",
      offset.latitude,
      offset.longitude,
      "active",
      "1 Real Street"
    );
    const object = compose([c]).objects.find(
      o => o.territoryId === "silver-lake"
    )!;
    expect(object.kind).toBe("lantern");
    const expected = projectLatLngToLanternAtlas(offset);
    expect(object.worldAnchor.x).toBeCloseTo(expected.x, 6);
    expect(object.worldAnchor.y).toBeCloseTo(expected.y, 6);
    const territoryAnchor = projectLatLngToLanternAtlas(geo);
    expect(object.worldAnchor.y).not.toBeCloseTo(territoryAnchor.y, 6);
  });
  it("anchors a multi-address lantern to a real centroid of its source clusters, not the territory centroid", () => {
    const geo = territoryCenter(
      LANTERN_TERRITORIES.find(t => t.id === "mid-city")!
    );
    const a = customer(
      "address-a",
      geo.latitude + 0.0015,
      geo.longitude,
      "active",
      "100 Test Avenue"
    );
    const b = customer(
      "address-b",
      geo.latitude - 0.0015,
      geo.longitude,
      "active",
      "200 Test Avenue"
    );
    const object = compose([a, b]).objects.find(
      o => o.territoryId === "mid-city"
    )!;
    expect(object.sourceClusters).toHaveLength(2);
    // The centroid of two equally-weighted, symmetric real addresses lands
    // back on the shared longitude midpoint — a derived truth, not the
    // territory's own centroid coordinate, and not either single source
    // anchor by itself.
    const territoryAnchor = projectLatLngToLanternAtlas(geo);
    expect(object.worldAnchor.y).toBeCloseTo(territoryAnchor.y, 2);
    expect(object.sourceAnchors).toHaveLength(2);
    expect(object.worldAnchor.y).not.toBeCloseTo(
      object.sourceAnchors[0]!.y,
      6
    );
    expect(object.worldAnchor.y).not.toBeCloseTo(
      object.sourceAnchors[1]!.y,
      6
    );
  });
  it("a lantern's status text describes only its own object count, never the whole territory total", () => {
    // Regression for the count lie: when a stronghold and an unrelated
    // address share a territory, the secondary lantern must report its own
    // remaining cluster (1), never truth.customers.length for the whole
    // territory (10, which includes the stronghold's 9).
    const text = territoryStateText({
      totalCustomers: 10,
      guarded: false,
      state: "healthy",
      objectCustomerCount: 1,
    });
    expect(text).toContain("1 customer");
    expect(text).not.toContain("10");
  });
  it.each([
    [1920, 1080],
    [1440, 900],
    [1280, 900],
  ])(
    "describes a secondary lantern by its own remaining cluster, never the whole territory count, at %ix%i",
    (width, height) => {
    const geo = CANONICAL_BUILDING_GEOGRAPHY.opus_la;
    const strongholdCustomers = Array.from({ length: 9 }, (_, i) =>
      customer(`opus:${i}`, geo.latitude, geo.longitude, "active", geo.address)
    );
    const unrelated = customer(
      "unrelated-koreatown",
      geo.latitude + 0.002,
      geo.longitude,
      "active",
      "1 Somewhere Else Ave"
    );
    const scene = compose([...strongholdCustomers, unrelated], width, height);
    const tower = scene.objects.find(o => o.id === "opus_la")!;
    expect(tower.cluster!.total).toBe(9);
    const truth = scene.truth.find(
      t => t.occupancy.territory.id === "koreatown"
    )!;
    expect(truth.customers).toHaveLength(10);
    // Koreatown's authored lanternSlots give the secondary lantern
    // somewhere to land instead of being suppressed by the tower sitting
    // on the shared primary anchor.
    const secondary = scene.objects.find(
      o => o.territoryId === "koreatown" && o.kind === "lantern"
    )!;
    expect(secondary).toBeDefined();
    expect(secondary.cluster!.total).toBe(1);
    expect(secondary.status).toContain("1 customer");
    expect(secondary.status).not.toContain("10 customer");
    expect(
      scene.objects.some(
        other => other !== secondary && overlaps(other.bounds, secondary.bounds)
      )
    ).toBe(false);
    expect(
      scene.exclusions.some(zone => overlaps(zone, secondary.bounds))
    ).toBe(false);
    expect(
      scene.suppressed.some(s => s.id === "territory:koreatown")
    ).toBe(false);
    }
  );
  it("does not turn every conquered zero-customer territory into infestation", () => {
    const scene = composeLanternCityScene({
      customers: [],
      atlasReady: true,
      viewport: { width: 1440, height: 900 },
      conqueredTerritoryIds: new Set(["downtown"]),
    });
    const downtown = scene.truth.find(
      t => t.occupancy.territory.id === "downtown"
    )!;
    // Downtown has no authored `emptyEnvironment: "infested"` skin and is
    // not lost ground, so a bare conquest must not manufacture vermin.
    expect(downtown.occupancy.conquered).toBe(true);
    expect(downtown.environment).toBe("locked");
  });
  it("still infests authored empty districts even when they are not conquered", () => {
    const scene = compose();
    const midCity = scene.truth.find(
      t => t.occupancy.territory.id === "mid-city"
    )!;
    expect(midCity.occupancy.conquered).toBe(false);
    expect(midCity.environment).toBe("infested");
  });
});
