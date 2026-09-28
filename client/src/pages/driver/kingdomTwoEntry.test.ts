import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
  Kingdom Two's entry on the Driver. driver.bldg.chat serves only "/" (App.tsx redirects every other
  path home), and /goldline-chapter is an admin-gated route, so a link to it bounced players straight
  back to their day. The chapter is mounted as a Driver scene instead.
*/
const controller = readFileSync(new URL("./GoldlineDriverController.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const host = readFileSync(new URL("../GoldlineChapterHost.tsx", import.meta.url), "utf8");

describe("Kingdom Two entry on the Driver", () => {
  it("opens the chapter as a scene, never by navigating to the admin route", () => {
    const handler = controller.slice(controller.indexOf("onEnterChapter={"), controller.indexOf("campaignRunCard={"));
    expect(handler).toContain('setDriverScene("chapter")');
    expect(controller).not.toMatch(/location\.(href|assign)[^;\n]*goldline-chapter/);
  });

  it("renders the chapter host in the chapter scene, with the way back to the day", () => {
    const scene = controller.slice(controller.indexOf('if (driverScene === "chapter")'));
    expect(scene.slice(0, 400)).toContain("<GoldlineChapterHost />");
    expect(scene.slice(0, 400)).toContain("{returnToDay}");
  });

  it("still keeps the driver host to its one product URL (the fix does not widen it)", () => {
    const driverBlock = app.slice(app.indexOf("if (isDriverHost) {"), app.indexOf("if (isBoreslayHost &&"));
    expect(driverBlock).not.toContain("goldline-chapter");
  });

  it("refreshes the kingdoms as soon as an outcome is recorded, so the fifth result shows Kingdom 2 at once", () => {
    const mutation = controller.slice(controller.indexOf("const recordDay1Outcome ="), controller.indexOf("const recordDay1Outcome =") + 400);
    expect(mutation).toContain("onSuccess");
    expect(mutation).toContain("goldlineKingdoms.list.invalidate()");
  });

  it("flushes chapter progress when the scene unmounts, and never re-adopts an older checkpoint over it", () => {
    const cleanup = host.slice(host.indexOf("return()=>{"), host.indexOf("},[seeded,state.error]);"));
    expect(cleanup).toContain("pushLocal(true");
    expect(cleanup).toContain("UNSYNCED_KEY");
    expect(host).toContain("goldlineChapterState.get.setData");
    const mount = host.slice(host.indexOf("if(state.isLoading)return;"), host.indexOf("setSeeded(true);"));
    expect(mount.indexOf("keepUnsyncedLocal")).toBeGreaterThan(-1);
    expect(mount.indexOf("keepUnsyncedLocal")).toBeLessThan(mount.indexOf("adopt(state.data.state"));
  });
});
