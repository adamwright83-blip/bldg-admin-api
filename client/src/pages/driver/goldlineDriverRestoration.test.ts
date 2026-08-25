import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const driver = readFileSync(new URL("../Driver.tsx", import.meta.url), "utf8");
const controller = readFileSync(
  new URL("./GoldlineDriverController.tsx", import.meta.url),
  "utf8"
);
const goldline = readFileSync(
  new URL("../goldline/GoldlineHome.tsx", import.meta.url),
  "utf8"
);
const goldlineCss = [
  readFileSync(
    new URL("../goldline/goldline-home.css", import.meta.url),
    "utf8"
  ),
  readFileSync(
    new URL("../goldline/goldline-legibility.css", import.meta.url),
    "utf8"
  ),
  readFileSync(
    new URL("../goldline/goldline-live-fix.css", import.meta.url),
    "utf8"
  ),
  readFileSync(
    new URL("../goldline/open-channel.css", import.meta.url),
    "utf8"
  ),
].join("\n");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const mission = readFileSync(
  new URL("../CommercialSalesMission.tsx", import.meta.url),
  "utf8"
);

describe("Goldline canonical driver restoration", () => {
  it("starts every fresh driver session on Overland and enters Clockhead only by scene choice", () => {
    expect(controller).toContain(
      'const INITIAL_DRIVER_SCENE: DriverScene = "overworld"'
    );
    expect(controller).toContain('useState<DriverScene>(initialDriverScene)');
    expect(controller).toContain(
      'import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1"'
    );
    expect(controller).toContain('"goldlineSceneFixture"');
    expect(controller).toContain('driverScene === "colosseum" &&');
    expect(controller).toContain(
      'onEnterGreystar={() => setDriverScene("colosseum")}'
    );
    expect(controller).toContain(
      'onEnterOperations={() => setDriverScene("game")}'
    );
    expect(controller).not.toContain("shouldAutoEnterWayward");
  });

  it("renders authenticated Driver through Goldline while preserving ProductShell routes", () => {
    expect(driver).toContain("GoldlineDriverController");
    expect(driver).toContain('role="driver"');
    expect(driver).not.toContain("ProductShell");
    expect(app).toContain('hostname === "driver.bldg.chat"');
    expect(app).toContain('path="/driver" component={Driver}');
    expect(app).toContain('path="/product/:rest*"');
    expect(app).toContain("<ProductShell />");
    expect(app).toContain('path="/driver/sales-mission/:missionId"');
  });

  it("uses FIELD Today and contextual moves without fabricating quiet-world targets", () => {
    expect(controller).toContain("trpc.system.field.today.useQuery");
    expect(controller).toContain("trpc.system.field.moves.useQuery");
    expect(controller).toContain("currentLocation:");
    expect(goldline).toContain("moves?.recommendedMoves ?? []");
    expect(goldline).toContain("callMoves.length > 0");
    expect(goldline).toContain('moves.reason !== "MOVES_AVAILABLE"');
    expect(goldline).toContain("The world stays calm");
  });

  it("accepts an eligible move through the idempotent backend contract", () => {
    expect(controller).toContain("acceptMove.mutateAsync");
    expect(controller).toContain("moveId: move.id");
    expect(controller).toContain("missionId: move.missionId");
    expect(controller).toContain("expectedVersion: move.missionVersion");
    expect(controller).toContain("requestId: crypto.randomUUID()");
    expect(controller).toContain(
      "window.location.assign(move.destinationPath)"
    );
  });

  it("uses server-owned visit-route membership and coverage in production", () => {
    expect(controller).toContain("trpc.system.field.visitRoute.useQuery");
    expect(controller).toContain(
      "trpc.system.field.startVisitRoute.useMutation"
    );
    expect(controller).toContain("authoritativeVisitRoute={visitRoute.data}");
    expect(controller).toContain("visitRoute.data?.coveredCount ?? 0");
    expect(controller).not.toContain("MARK STOP COVERED");
  });

  it("uses real order mutation and preserves the unpaid delivery guard", () => {
    expect(controller).toContain("trpc.admin.updateStatus.useMutation");
    expect(controller).toContain("canCompleteDelivery(order)");
    expect(controller).toContain('status === "collected"');
    expect(controller).toContain('status === "delivered"');
    expect(controller).toContain("QuickNewOrderSheet");
    expect(goldline).toContain('type: blocked ? "PAYMENT BLOCKED" : type');
    expect(goldline).toContain("RESOLVE PAYMENT");
  });

  it("wires real walk-in, Calendar OAuth, armory, adaptive meter, and unload", () => {
    expect(controller).toContain("<WalkInCapture");
    expect(controller).toContain("calendarComplete.useMutation");
    expect(controller).toContain("calendarStatus.invalidate()");
    expect(controller).toContain("adaptiveSalesMeter.myMeter.useQuery");
    expect(controller).toContain("system.armory.get.useQuery");
    expect(controller).toContain("system.unload.resolveDay.useMutation");
    expect(controller).toContain("<SalesJournalSheet");
    expect(goldline).toContain("dayResolution.worldDeltas.map");
  });

  it("removes simulated Goldline business state and fake action success", () => {
    expect(goldline).not.toContain("const calls =");
    expect(goldline).not.toContain("const objectives =");
    expect(goldline).not.toContain("87%");
    expect(goldline).not.toContain("ON FIRE");
    expect(goldline).not.toContain("Glacier Tech");
    expect(goldline).not.toContain("Summit Capital");
    expect(goldline).not.toContain("RIVAL IN PLAY");
    expect(goldline).not.toContain("New order saved");
    expect(goldline).not.toContain("Walk-in logged");
    expect(goldline).not.toContain("Mission built");
    expect(goldline).not.toContain("Day unloaded");
  });

  it("retains the approved mobile Goldline action strip and mission return path", () => {
    expect(goldline).toContain('className="action-bar"');
    expect(goldlineCss).toContain("env(safe-area-inset-bottom)");
    expect(goldlineCss).toContain(".goldline .action-bar");
    expect(mission).toContain('href="/driver"');
    expect(mission).toContain("Back to Goldline");
    expect(driver).not.toContain("/commercial-missions");
    expect(controller).not.toContain("/commercial-missions");
  });

  it("positions route cards and energy nodes from the same semantic world anchors", () => {
    expect(goldline).toContain("GOLDLINE_ROUTE_ANCHORS[index]");
    expect(goldline).not.toContain("stop-${index + 1}");
    expect(goldline.match(/data-route-anchor=\{anchor\.id\}/g)).toHaveLength(2);
    expect(goldline.match(/goldlineAnchorStyle\(anchor\)/g)).toHaveLength(2);
    expect(goldlineCss).toContain("--goldline-anchor-x");
    expect(goldlineCss).toContain("--goldline-anchor-y");
    expect(goldlineCss).not.toMatch(/\.goldline \.stop-[1-4]/);
  });

  it("turns a successful route mutation into visible Goldline progression", () => {
    expect(controller).toContain("utils.admin.listByDate.setData");
    expect(controller).toContain("rows?.filter(order => order.id !== orderId)");
    expect(controller).toContain("return true");
    expect(goldline).toContain("ROUTE ACTION COMPLETE");
    expect(goldline).toContain("PICKUP SECURED");
    expect(goldline).toContain('phase: "confirming"');
    expect(goldline).toContain('phase: "advancing"');
    expect(goldline).toContain("completedStopKeys.has(stop.key)");
    expect(goldline).toContain("is-route-progressing");
    expect(goldlineCss).toContain("goldline-route-confirm");
    expect(goldlineCss).toContain("goldline-avatar-advance");
    expect(goldlineCss).toContain("goldline-player-advance");
    expect(controller).toContain("system.openChannel.progress.useQuery");
    expect(controller).toContain("advanceCachedProgress");
    expect(goldline).toContain("goldline-operator-piece");
    expect(goldline).toContain("Trailblazer Operator is on board space");
    expect(goldlineCss).toContain("real movable sprite over an empty world");
    expect(goldline).toContain("goldline-world-empty.png");
    expect(goldline).toContain("trailblazer-operator.png");
  });

  it("turns a large verified gap into an editable voice-first Open Channel mission", () => {
    expect(controller).toContain("system.openChannel.current.useQuery");
    expect(controller).toContain(
      "system.openChannel.generateDraft.useMutation"
    );
    expect(controller).toContain("system.openChannel.approve.useMutation");
    expect(controller).toContain("system.openChannel.completeTask.useMutation");
    expect(controller).toContain("goldlineProgress.refetch()");
    expect(goldline).toContain("detectOpenChannelGap");
    expect(goldline).toContain("open-channel-signal");
    expect(goldline).toContain("OPEN CHANNEL");
    expect(goldline).toContain("COMPLETE BOARD SPACE");
    expect(goldline).toContain("MISSION SPACE CLEARED");
    expect(goldlineCss).toContain("open-channel-beacon");
  });
});
