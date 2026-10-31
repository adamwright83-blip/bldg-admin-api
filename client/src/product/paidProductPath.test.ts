import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
const customerHost = fs.readFileSync(
  path.join(root, "client/src/hostRouting/CustomerHostApp.tsx"),
  "utf8"
);
const chapterGate = fs.readFileSync(
  path.join(root, "client/src/components/goldline/TenantUnlockedChapterGate.tsx"),
  "utf8"
);
const productShell = fs.readFileSync(
  path.join(root, "client/src/product/ProductShell.tsx"),
  "utf8"
);
const world = fs.readFileSync(
  path.join(root, "client/src/product/JoystickWorld.tsx"),
  "utf8"
);
const atlasRouter = fs.readFileSync(
  path.join(root, "server/geography/geographicTruthRouter.ts"),
  "utf8"
);
const islands = fs.readFileSync(
  path.join(
    root,
    "client/src/components/admin/control-room/LanternCityIslands/LanternCityIslands.tsx"
  ),
  "utf8"
);

describe("paid JOYSTICK product path", () => {
  it("lets commercial members reach the canonical world, play surface, and unlocked chapter", () => {
    expect(app).toContain('"/play"');
    expect(app).toContain('"/growth/lantern-city"');
    expect(app).toContain('"/goldline-chapter"');
    expect(app).toContain("<JoystickWorldRoute />");
    expect(app).toContain("<DriverMembershipGate>");
    expect(app).toContain("<TenantOperatorGate>");
    expect(app).toContain('me.data?.membership.role === "field"');
    expect(chapterGate).toContain('kingdom.kingdomId === "kingdom-2-the-last-valet"');
    expect(chapterGate).toContain('kingdom.lanternCityStatus !== "locked"');
    expect(app).toContain('<TenantUnlockedChapterGate locked={<Redirect to="/play" />}>');
    expect(app).toContain("<JoystickChapterRoute />");
  });

  it("gates the customer-host chapter with the same kingdom-unlock check as the admin host", () => {
    const view = customerHost.slice(customerHost.indexOf('view === "customer-chapter"'));
    const branch = view.slice(0, view.indexOf("if (view ===", 1));
    expect(branch).toContain("<CustomerOperatorGate>");
    expect(branch).toContain('<TenantUnlockedChapterGate locked={<CustomerReplace to="/play" />}>');
    expect(branch.indexOf("<TenantUnlockedChapterGate")).toBeLessThan(
      branch.indexOf("<GoldlineChapterHost />")
    );
  });

  it("retires the duplicate HQ/FIELD entry points in favor of World and Play", () => {
    expect(productShell).toContain('navigate(mobile || !canUseHq ? "/play" : "/growth/lantern-city"');
    expect(productShell).toContain('navigate("/play", { replace: true })');
    expect(productShell).toContain('navigate(canUseHq ? "/growth/lantern-city" : "/play"');
    expect(productShell).toContain('href="/play"');
    expect(productShell).toContain('href="/growth/lantern-city"');
  });

  it("uses a tenant-scoped geographic atlas without exposing cross-tenant targeting", () => {
    expect(atlasRouter).toContain("myAtlas: legacyDayforgeTenantOperatorProcedure");
    expect(atlasRouter).toContain("getGeographicTruth({ tenantId: ctx.tenantId })");
    expect(islands).toContain("geographicTruth.myAtlas.useQuery");
    expect(world).toContain("showUtilityDock={false}");
  });
});
