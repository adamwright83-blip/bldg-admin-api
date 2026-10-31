import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryEnabled } from "../storyHome/homeModel";
import { NEXT_CHAPTER_TOMORROW_LINE } from "@/story/tomorrowLine";
import { barNavFor, StoryLane } from "./ClaireDesk";
import { WonTonight } from "../storyHome/StoryHome";

function wonTonight({
  number = 1,
  chapterCount = 3,
  answered = null,
  tomorrow,
}: { number?: number; chapterCount?: number; answered?: string | null; tomorrow?: string } = {}): StoryEnabled {
  return {
    enabled: true,
    seasonTitle: "Fixture season",
    chapterCount,
    state: "won_tonight",
    daysAway: 0,
    chapter: {
      number,
      title: "Fixture chapter",
      gameKey: "fixture.button",
      before: [{ key: "b1", text: "Fixture before-line.", still: null }],
      after: [{ key: "a1", text: "Fixture after-line.", still: null }],
      question: {
        key: "fixture.q",
        text: "Fixture question?",
        options: [
          { key: "left", text: "Fixture left" },
          { key: "right", text: "Fixture right" },
        ],
        answered,
      },
      closing: answered ? { response: "Fixture response.", tomorrow } : undefined,
    },
  };
}

const lane = (tonight: StoryEnabled) =>
  renderToStaticMarkup(createElement(StoryLane, { tonight, playing: false, onPlay: () => {}, onAnswered: () => {} }));

describe("Claire's desk: a won chapter's question", () => {
  it("is answered on the desk, not sent to a Home a tenant never reaches", () => {
    const html = lane(wonTonight());
    expect(html).not.toContain("Answer it on Home");
    expect(html).toContain("ONE QUESTION LEFT");
    expect(html).toContain("Fixture question?");
    expect(html).toContain("Fixture left");
    expect(html).toContain("Fixture right");
    expect(html).toContain('data-state="won_tonight"');
  });

  it("once answered, the desk still reads REMEMBERED", () => {
    const html = lane(wonTonight({ answered: "left" }));
    expect(html).toContain("REMEMBERED");
    expect(html).not.toContain("Fixture question?");
  });
});

describe("after the final chapter, no next chapter is promised", () => {
  it("on the desk", () => {
    expect(lane(wonTonight({ number: 2, chapterCount: 3, answered: "left" }))).toContain(NEXT_CHAPTER_TOMORROW_LINE);
    expect(lane(wonTonight({ number: 3, chapterCount: 3, answered: "left" }))).not.toContain(NEXT_CHAPTER_TOMORROW_LINE);
    expect(lane(wonTonight({ number: 3, chapterCount: 3, answered: "left", tomorrow: "Authored ending." }))).toContain("Authored ending.");
  });

  it("on the story Home", () => {
    const won = (tonight: StoryEnabled) =>
      renderToStaticMarkup(createElement(WonTonight, { chapter: tonight.chapter!, chapterCount: tonight.chapterCount, onAnswered: () => {} }));
    expect(won(wonTonight({ number: 2, chapterCount: 3, answered: "left" }))).toContain(NEXT_CHAPTER_TOMORROW_LINE);
    const final = won(wonTonight({ number: 3, chapterCount: 3, answered: "left" }));
    expect(final).toContain("REMEMBERED");
    expect(final).not.toContain(NEXT_CHAPTER_TOMORROW_LINE);
    expect(final).not.toContain("sh-tomorrow");
  });
});

/** The admin host's tenant guard (App.tsx `isSaasCustomerSafePath`), read from its own list so the two cannot drift. */
function tenantServedOnAdminHost(pathname: string): boolean {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, "../../App.tsx"), "utf8");
  const list = source.match(/const SAAS_CUSTOMER_SAFE_PATHS = \[([\s\S]*?)\] as const;/);
  if (!list) throw new Error("SAAS_CUSTOMER_SAFE_PATHS not found in App.tsx");
  const prefixes = [...list[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/claire") return true;
  return prefixes.some(prefix =>
    prefix.endsWith("/") ? pathname.startsWith(prefix) : normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

function onHost(hostname: string) {
  vi.stubGlobal("window", { location: { hostname, pathname: "/claire", search: "" } });
}

describe("Claire's desk top bar", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("platform admins keep today's targets", () => {
    onHost("admin.bldg.chat");
    expect(barNavFor("admin").map(item => item.path)).toEqual(["/growth/lantern-city", "/customers", "/operations", "/money", "/settings"]);
  });

  it("a tenant member on the admin host gets only routes the admin host serves them", () => {
    onHost("admin.bldg.chat");
    const nav = barNavFor("user");
    expect(nav.map(item => [item.key, item.path])).toEqual([
      ["city", "/growth/lantern-city"],
      ["customers", "/product/customers"],
      ["money", "/product/money"],
      ["settings", "/billing"],
    ]);
    for (const item of nav) expect(tenantServedOnAdminHost(item.path), item.path).toBe(true);
    // the admin targets these replace are exactly the ones the guard turns away
    for (const adminPath of ["/customers", "/operations", "/money", "/settings"]) expect(tenantServedOnAdminHost(adminPath), adminPath).toBe(false);
  });

  it("on the customer host a tenant member gets the same tenant routes, each one that host serves", () => {
    onHost("app.gojoystick.com");
    expect(barNavFor("user").map(item => item.path)).toEqual(["/growth/lantern-city", "/product/customers", "/product/money", "/billing"]);
    expect(barNavFor(undefined).map(item => item.path)).toEqual(["/growth/lantern-city"]);
  });
});
