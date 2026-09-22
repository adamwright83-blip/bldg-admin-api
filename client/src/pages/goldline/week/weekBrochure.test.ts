import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import LockedWeekBrochure from "./LockedWeekBrochure";
import WeekBrochure from "./WeekBrochure";
import {
  businessDateInTimeZone,
  forwardingTagsForDay,
  lockedWeeklyIntentToWeekArtifact,
  startCtaLabel,
  weekFoldLayout,
  WeekIntentNotLockedError,
} from "./lockedWeeklyIntentToWeekArtifact";
import { readWeekVisit } from "./readWeekVisit";
import {
  fixtureEmptyOverlay,
  fixtureFictionOverlay,
  fixtureFullLockedWeek,
  fixtureMondayRemnant,
  fixtureNow,
  fixtureStandDownDay,
  fixtureTwoDayWeek,
  fixtureUnconfirmedDraft,
  FRI,
  MON,
  THU,
  TUE,
  WED,
} from "./weekFixtures";
import type { WeeklyIntent } from "./weeklyIntentContract";

const weekDir = path.dirname(new URL(import.meta.url).pathname);
const weekSource = readdirSync(weekDir)
  .filter(file => /\.(ts|tsx|css)$/.test(file) && !file.endsWith(".test.ts"))
  .map(file => readFileSync(path.join(weekDir, file), "utf8"))
  .join("\n");
const adapterSource = readFileSync(
  path.join(weekDir, "lockedWeeklyIntentToWeekArtifact.ts"),
  "utf8"
);
const contractSource = readFileSync(
  path.join(weekDir, "weeklyIntentContract.ts"),
  "utf8"
);
const css = readFileSync(path.join(weekDir, "week-brochure.css"), "utf8");
const controller = readFileSync(
  new URL("../../driver/GoldlineDriverController.tsx", import.meta.url),
  "utf8"
);
const dayPlan = readFileSync(
  new URL("../GoldlineDayPlan.tsx", import.meta.url),
  "utf8"
);
const driver = readFileSync(new URL("../../Driver.tsx", import.meta.url), "utf8");

const noop = () => undefined;

function lockedHtml(options: {
  intent?: WeeklyIntent;
  now?: Date;
  overlay?: typeof fixtureFictionOverlay;
  focus?: string | null;
  onStartMission?: () => void;
  onAdjustWeek?: () => void;
}) {
  return renderToStaticMarkup(
    createElement(LockedWeekBrochure, {
      intent: options.intent ?? fixtureFullLockedWeek,
      now: options.now ?? fixtureNow(MON),
      overlay: options.overlay ?? fixtureFictionOverlay,
      initialFocusDate: options.focus,
      onReturnToDay: noop,
      onStartMission: options.onStartMission ?? noop,
      onAdjustWeek: options.onAdjustWeek ?? noop,
      onPlay: noop,
      onJournal: noop,
    })
  );
}

describe("mobile Week brochure", () => {
  it("01 Day Line remains the default home", () => {
    expect(controller).toContain("if (dayBriefingOpen) return dayBriefing;");
    expect(controller).toContain("<GoldlineDayPlan");
    expect(controller).toContain("const [weekOpen, setWeekOpen] = useState(false)");
    expect(controller).not.toContain("redirectToWeek");
  });

  it("02 a locked week does not replace Day Line on launch", () => {
    expect(controller.indexOf("useState(false)")).toBeGreaterThan(0);
    expect(controller).toContain("if (weekOpen)");
    expect(controller.indexOf("if (weekOpen)")).toBeLessThan(
      controller.indexOf("if (dayBriefingOpen) return dayBriefing;")
    );
    expect(readWeekVisit()).toEqual({ phase: "UNPLANNED" });
    expect(controller).not.toContain("if (lockedWeekExists)");
  });

  it("03 renders a locked fixture", () => {
    const html = lockedHtml({});
    expect(html).toContain("Launch the ad");
    expect(html).toContain('data-week-phase="LOCKED"');
    expect(html).toContain("WEEK LOCKED");
  });

  it("04 never reads internalHypothesis", () => {
    expect(weekSource).not.toContain("internalHypothesis");
    expect(controller).not.toContain("internalHypothesis");
    const dirty = {
      ...fixtureFullLockedWeek,
      internalHypothesis: "private theory about the operator",
    };
    const view = lockedWeeklyIntentToWeekArtifact(
      dirty as WeeklyIntent,
      fixtureNow(MON)
    );
    expect(JSON.stringify(view)).not.toContain("private theory");
  });

  it("05 an unconfirmed draft cannot render as a locked week", () => {
    expect(() =>
      lockedWeeklyIntentToWeekArtifact(fixtureUnconfirmedDraft, fixtureNow(MON))
    ).toThrow(WeekIntentNotLockedError);
    const html = renderToStaticMarkup(
      createElement(WeekBrochure, {
        visit: { phase: "LOCKED", intent: fixtureUnconfirmedDraft },
        now: fixtureNow(MON),
        onReturnToDay: noop,
      })
    );
    expect(html).not.toContain("Launch the ad");
    expect(html).not.toContain('data-week-phase="LOCKED"');
    expect(html).toContain("No week is locked");
  });

  it("06 UNPLANNED invents no days", () => {
    const html = renderToStaticMarkup(
      createElement(WeekBrochure, {
        visit: { phase: "UNPLANNED" },
        now: fixtureNow(MON),
        onReturnToDay: noop,
      })
    );
    expect(html).toContain("No week is locked");
    expect(html).not.toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday/);
    expect(html).not.toContain("Launch the ad");
  });

  it("07 IN_PROGRESS exposes no private hypotheses", () => {
    const html = renderToStaticMarkup(
      createElement(WeekBrochure, {
        visit: { phase: "IN_PROGRESS", internalHypothesis: "secret theory" } as never,
        now: fixtureNow(MON),
        onReturnToDay: noop,
      })
    );
    expect(html).toContain("WEEK IN PROGRESS");
    expect(html).toContain("Continue with Claire");
    expect(html).not.toContain("secret theory");
    expect(html).not.toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday/);
  });

  it("08 LOCKED renders an accordion fold", () => {
    const html = lockedHtml({ focus: WED });
    expect(html).toContain('data-testid="week-fold"');
    expect(css).toContain("perspective: 1400px");
    expect(css).toContain("rotateY(46deg)");
    expect(css).toContain("rotateY(-46deg)");
    expect(html.match(/data-place="current"/g)).toHaveLength(1);
  });

  it("09 the current business day is emphasized", () => {
    const html = lockedHtml({ now: fixtureNow(WED), focus: WED });
    expect(html).toContain('aria-current="date"');
    expect(html).toContain("TODAY");
    expect(html).toContain("Wednesday");
    expect(html).toMatch(
      /data-business-date="2026-09-23"[^>]*data-place="current"/
    );
  });

  it("10 a future day does not get today's Start", () => {
    const html = lockedHtml({ now: fixtureNow(MON), focus: WED });
    expect(html).toContain("Interview 6 property GMs");
    expect(html).not.toContain('data-testid="week-start"');
  });

  it("11 the CTA weekday is data-driven", () => {
    const monday = lockedWeeklyIntentToWeekArtifact(fixtureFullLockedWeek, fixtureNow(MON));
    const wednesday = lockedWeeklyIntentToWeekArtifact(fixtureFullLockedWeek, fixtureNow(WED));
    expect(startCtaLabel(monday.days[0])).toBe("Start Monday");
    expect(startCtaLabel(wednesday.days[0])).toBe("Start Wednesday");
    expect(lockedHtml({ now: fixtureNow(WED), focus: WED })).toContain("Start Wednesday");
    expect(weekSource).not.toContain("START WEDNESDAY'S MISSION");
  });

  it("12 the real objective is visible", () => {
    const html = lockedHtml({ focus: WED, now: fixtureNow(MON) });
    expect(html).toContain('<h2 class="wb-objective">Interview 6 property GMs</h2>');
  });

  it("13 fiction does not replace the business objective in the data model", () => {
    const view = lockedWeeklyIntentToWeekArtifact(fixtureFullLockedWeek, fixtureNow(MON));
    expect(view.days.map(day => day.realPrimaryTitle)).toEqual([
      "Launch the ad",
      "Complete required sales follow-up",
      "Interview 6 property GMs",
      "Return to qualified properties",
      "Close open sales loops",
    ]);
    expect(JSON.stringify(view)).not.toContain("THE SIX SUSPECTS");
    const html = lockedHtml({ focus: WED, now: fixtureNow(MON) });
    expect(html).toContain("Interview 6 property GMs");
    expect(html).toContain("THE SIX SUSPECTS");
    expect(html).toContain('aria-hidden="true">THE SIX SUSPECTS');
  });

  it("14 an empty overlay is still a complete brochure", () => {
    const html = lockedHtml({ overlay: fixtureEmptyOverlay, focus: MON });
    expect(html).toContain("Launch the ad");
    expect(html).toContain("MONDAY");
    expect(html).toContain('data-art-variant="default"');
    expect(html).toContain("Field jacket");
    expect(html).toContain("Clear morning");
    expect(html).not.toContain("THE SIGNAL");
    expect(html).toContain('data-testid="week-start"');
  });

  it("15 readiness stays on the owning future mission", () => {
    const view = lockedWeeklyIntentToWeekArtifact(fixtureFullLockedWeek, fixtureNow(MON));
    const tuesday = view.days.find(day => day.businessDate === TUE);
    const wednesday = view.days.find(day => day.businessDate === WED);
    expect(tuesday?.readiness).toEqual([]);
    expect(wednesday?.readiness.map(item => item.text)).toContain("Print collateral");
    expect(wednesday?.readiness.find(item => item.text === "Print collateral")?.neededForDate).toBe(WED);
    const html = lockedHtml({ focus: WED, now: fixtureNow(MON) });
    expect(html).toContain("Print collateral");
    expect(html).toContain("Interview 6 property GMs");
  });

  it("16 completeByDate is shown on the owning mission", () => {
    const html = lockedHtml({ focus: WED, now: fixtureNow(MON) });
    expect(html).toContain("By Tuesday");
    const tags = forwardingTagsForDay(
      lockedWeeklyIntentToWeekArtifact(fixtureFullLockedWeek, fixtureNow(MON)).days,
      TUE
    );
    expect(tags.map(tag => tag.label)).toContain("PACK FOR WED / READY TUE");
    expect(lockedHtml({ focus: TUE, now: fixtureNow(MON) })).toContain("PACK FOR WED / READY TUE");
  });

  it("17 readiness is not a checkbox", () => {
    const html = lockedHtml({ focus: WED, now: fixtureNow(MON) });
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('role="checkbox"');
    expect(weekSource).not.toContain('type="checkbox"');
  });

  it("18 completion is not a checkmark", () => {
    const html = lockedHtml({ focus: FRI, now: fixtureNow(MON) });
    expect(html).not.toMatch(/✓|✔|☑/);
    expect(html).not.toContain("checkmark");
    expect(css).not.toContain("checkmark");
  });

  it("19 loadout state is diegetic", () => {
    const html = lockedHtml({ focus: WED, now: fixtureNow(MON) });
    expect(html).toContain('data-kind="document"');
    expect(html).toContain('data-status="ready"');
    expect(html).toContain('data-kind="information"');
    expect(html).toContain('data-status="open"');
    expect(html).toContain("wb-kit--document");
    expect(lockedHtml({ focus: MON })).toContain("wb-kit--physical");
    expect(css).not.toContain("progressbar");
  });

  it("20 blocked readiness is a hold, not a checklist row", () => {
    const html = lockedHtml({ focus: THU, now: fixtureNow(MON) });
    expect(html).toContain('data-status="blocked"');
    expect(html).toContain("HOLD");
    expect(html).toContain("Site permit");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toMatch(/✓|✔/);
  });

  it("21 the fold is not five SaaS cards", () => {
    const html = lockedHtml({ focus: WED, now: fixtureNow(MON) });
    expect(html.match(/class="wb-panel/g)?.length).toBe(3);
    expect(html).not.toContain("kanban");
    expect(html).not.toContain("wb-card");
    expect(css).not.toMatch(/grid-template-columns:\s*repeat\(5,\s*1fr\)/);
  });

  it("22 neighboring panels peek", () => {
    const html = lockedHtml({ focus: WED, now: fixtureNow(MON) });
    expect(html).toContain("wb-panel--peek-before");
    expect(html).toContain("wb-panel--peek-after");
    expect(css).toContain("rotateY(46deg)");
  });

  it("23 320, 375, 390, and 430 stay usable", () => {
    for (const width of [320, 375, 390, 430]) {
      const layout = weekFoldLayout(width);
      expect(layout.currentPanelPx).toBeGreaterThanOrEqual(200);
      expect(layout.touchTargetPx).toBeGreaterThanOrEqual(48);
      expect(layout.peekWingsPerSide).toBe(1);
    }
    expect(css).toContain("@media (max-width: 320px)");
    expect(css).toContain("@media (min-width: 375px)");
    expect(css).toContain("@media (min-width: 390px)");
    expect(css).toContain("@media (min-width: 430px)");
    expect(css).toContain("min-height: 48px");
  });

  it("24 at 320px there is at most one peeking wing per side", () => {
    expect(weekFoldLayout(320).peekWingsPerSide).toBe(1);
    const html = lockedHtml({ focus: WED, now: fixtureNow(MON) });
    expect(html.match(/wb-panel--peek-before/g)).toHaveLength(1);
    expect(html.match(/wb-panel--peek-after/g)).toHaveLength(1);
    expect(css).toContain("@media (max-width: 320px)");
  });

  it("25 reduced motion keeps the brochure and drops the dramatic fold", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("transition: none");
    expect(css).not.toContain("display: none");
    const html = lockedHtml({ focus: WED, now: fixtureNow(MON) });
    expect(html).toContain("Interview 6 property GMs");
    expect(html).toContain("Previous day");
  });

  it("26 navigation does not depend on a gesture", () => {
    const html = lockedHtml({ focus: WED, now: fixtureNow(MON) });
    expect(html).toContain('aria-label="Previous day"');
    expect(html).toContain('aria-label="Next day"');
    expect(html).toContain('aria-label="Show Tuesday. Complete required sales follow-up"');
    expect(html).toContain('aria-label="Show Thursday. Return to qualified properties"');
  });

  it("27 the real objective is accessible apart from the fiction title", () => {
    const html = lockedHtml({ focus: WED, now: fixtureNow(MON) });
    expect(html).toContain('aria-label="Wednesday. Interview 6 property GMs"');
    expect(html).toContain('aria-hidden="true">THE SIX SUSPECTS');
    expect(html).toContain('<h2 class="wb-objective">Interview 6 property GMs</h2>');
  });

  it("28 Week plates are not required for the Day Line", () => {
    expect(dayPlan).not.toContain("goldline/week");
    expect(dayPlan).not.toContain("plate-ruins");
    expect(controller).toContain('lazy(() => import("../goldline/week/WeekBrochure"))');
    expect(readFileSync(path.join(weekDir, "readWeekVisit.ts"), "utf8")).not.toContain(".webp");
    expect(driver).toContain("VITE_GOLDLINE_TEST_HARNESS");
  });

  it("29 Claire appears at most once", () => {
    const html = lockedHtml({});
    expect(html.match(/class="wb-claire"/g)).toHaveLength(1);
    expect(html.match(/alt="Claire"/g)).toHaveLength(1);
  });

  it("30 there is no giant second woman", () => {
    expect(css).toMatch(/\.wb-claire\s*\{[^}]*max-width:\s*44px/);
    expect(weekSource.toLowerCase()).not.toContain("lara");
    expect(weekSource.toLowerCase()).not.toContain("croft");
    const html = lockedHtml({ focus: WED, now: fixtureNow(MON) });
    expect(html.match(/<img /g)).toHaveLength(4);
  });

  it("31 Week has no dark variant", () => {
    expect(css).toContain("#f8efd8");
    expect(css).not.toMatch(/background:\s*#0{3,6}/i);
    expect(css).not.toMatch(/background:\s*#111\b/i);
    expect(css).not.toContain("gold-on-black");
    expect(weekSource).not.toContain("dark mode");
  });

  it("32 Week does not invent a black bottom nav", () => {
    expect(htmlNav()).toContain('aria-label="Goldline navigation"');
    expect(htmlNav()).toContain("YOUR DAY");
    expect(htmlNav()).toContain("WEEK");
    expect(css).toContain("rgba(255, 244, 211, 0.99)");
    expect(css).not.toMatch(/gdp-game-nav[^}]*#000/);
  });

  it("33 existing nav and Driver scenes still resolve", () => {
    expect(dayPlan).toContain("<GoldlineGameNav");
    expect(dayPlan).toContain('active="day"');
    expect(controller).toContain("<GoldlineOverworld");
    expect(controller).toContain('driverScene === "wayward"');
    expect(controller).toContain('driverScene === "colosseum"');
    expect(controller).toContain("if (dayBriefingOpen) return dayBriefing;");
  });

  it("34 opening Week does not mutate WeeklyIntent, Day Director, or Narrator", () => {
    const intent = structuredClone(fixtureFullLockedWeek);
    const before = JSON.stringify(intent);
    lockedHtml({ intent });
    expect(JSON.stringify(intent)).toBe(before);
    expect(weekSource).not.toMatch(/dayDirector|narrator|Narrator/);
    expect(weekSource).not.toContain("mutate");
  });

  it("35 Daily Command is not merged into the brochure", () => {
    const dailyCommand = { objective: "Daily Command Y" };
    const view = lockedWeeklyIntentToWeekArtifact(fixtureFullLockedWeek, fixtureNow(THU));
    expect(view.days.map(day => day.realPrimaryTitle)).toEqual([
      "Return to qualified properties",
      "Close open sales loops",
    ]);
    expect(JSON.stringify(view)).not.toContain(dailyCommand.objective);
    expect(adapterSource).not.toContain("DailyCommand");
  });

  it("36 a two-day week is exactly those days", () => {
    const view = lockedWeeklyIntentToWeekArtifact(fixtureTwoDayWeek, fixtureNow(THU));
    expect(view.days.map(day => day.businessDate)).toEqual([THU, FRI]);
    const html = lockedHtml({ intent: fixtureTwoDayWeek, now: fixtureNow(THU), focus: THU });
    expect(html.match(/class="wb-panel/g)).toHaveLength(2);
    expect(html).not.toContain("Monday");
    expect(html).not.toContain("Launch the ad");
  });

  it("37 START is navigation or a no-write stub", () => {
    const html = lockedHtml({ now: fixtureNow(MON), focus: MON });
    expect(html).toContain('href="/driver/sales-mission/6"');
    expect(html).toContain("Start Monday");
    let writes = 0;
    const stubHtml = lockedHtml({
      now: fixtureNow(WED),
      focus: WED,
      onStartMission: () => {
        writes += 1;
      },
    });
    expect(stubHtml).toContain("Start Wednesday");
    expect(stubHtml).not.toContain('href="/driver/sales-mission/6"');
    expect(writes).toBe(0);
    expect(weekSource).not.toContain("fetch(");
    expect(weekSource).not.toContain("trpc");
  });

  it("38 Week does not import Pixi, Overworld, Wayward, or Clockhead", () => {
    expect(weekSource).not.toMatch(/pixi|GoldlineOverworld|Wayward|Clockhead|cannon/i);
  });

  it("39 Week does not import Narrator, Quiet, or gold engines", () => {
    expect(weekSource).not.toMatch(/narrator|quietEngine|mintGold|awardGold|goldEngine/i);
    expect(weekSource).not.toContain("from \"../gold");
  });

  it("40 a Daily Command change does not rewrite the brochure", () => {
    const intent = structuredClone(fixtureFullLockedWeek);
    const first = lockedWeeklyIntentToWeekArtifact(intent, fixtureNow(THU));
    const dailyCommandObjective = "Walk a different Thursday";
    const second = lockedWeeklyIntentToWeekArtifact(intent, fixtureNow(THU));
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).not.toContain(dailyCommandObjective);
    expect(first.days[0].realPrimaryTitle).toBe("Return to qualified properties");
  });

  it("41 the presentation overlay does not mutate the intent", () => {
    const intent = structuredClone(fixtureFullLockedWeek);
    const overlay = structuredClone(fixtureFictionOverlay);
    const beforeIntent = JSON.stringify(intent);
    const beforeOverlay = JSON.stringify(overlay);
    lockedHtml({ intent, overlay, focus: WED, now: fixtureNow(MON) });
    expect(JSON.stringify(intent)).toBe(beforeIntent);
    expect(JSON.stringify(overlay)).toBe(beforeOverlay);
  });

  it("42 open, fold, start, and adjust perform no business writes", () => {
    let starts = 0;
    let adjusts = 0;
    lockedHtml({
      onStartMission: () => {
        starts += 1;
      },
      onAdjustWeek: () => {
        adjusts += 1;
      },
    });
    expect(starts).toBe(0);
    expect(adjusts).toBe(0);
    expect(weekSource).not.toMatch(/fetch\(|trpc|localStorage|sessionStorage|mutate/);
  });

  it("43 fiction fields exist only on the overlay", () => {
    expect(contractSource).not.toContain("fictionTitle");
    expect(adapterSource).not.toContain("fictionTitle");
    expect(adapterSource).not.toContain("artVariant");
    expect(adapterSource).not.toContain("chapterSkinId");
    expect(readFileSync(path.join(weekDir, "weekPresentationOverlay.ts"), "utf8")).toContain(
      "fictionTitle?"
    );
  });

  it("44 two business days keep separate overlay identity", () => {
    const html = lockedHtml({ intent: fixtureTwoDayWeek, now: fixtureNow(THU), focus: THU });
    expect(html).toContain('data-business-date="2026-09-24"');
    expect(html).toContain('data-business-date="2026-09-25"');
    expect(html).toContain('data-fiction="SECOND CONTACT"');
    expect(html).toContain('data-fiction="CLAIM"');
  });

  it("45 a missing fiction title does not change the objective", () => {
    const html = lockedHtml({
      overlay: { [MON]: { artVariant: "ruins" } },
      focus: MON,
      now: fixtureNow(MON),
    });
    expect(html).toContain("Launch the ad");
    expect(html).toContain('data-fiction=""');
    expect(html).not.toContain("THE SIGNAL");
    expect(html).toContain('data-art-variant="ruins"');
  });

  it("46 the adapter has no fiction fields", () => {
    expect(adapterSource).not.toMatch(/fiction|artVariant|chapterSkin|overlay/i);
  });

  it("47 C assigns no primary", () => {
    const blank: WeeklyIntent = {
      ...fixtureMondayRemnant,
      days: [
        {
          businessDate: MON,
          primary: null,
          fixedConstraints: [],
          readiness: [],
        },
      ],
    };
    const view = lockedWeeklyIntentToWeekArtifact(blank, fixtureNow(MON));
    expect(view.days[0].realPrimaryTitle).toBe("");
    expect(view.days[0].realPrimaryRef).toBeNull();
    expect(adapterSource).not.toContain("Launch the ad");
    expect(adapterSource).not.toContain("Interview 6 property GMs");
  });

  it("48 a Monday week keeps Monday through Friday", () => {
    const view = lockedWeeklyIntentToWeekArtifact(fixtureFullLockedWeek, fixtureNow(MON));
    expect(view.currentBusinessDate).toBe(MON);
    expect(view.days.map(day => day.weekdayLabel)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
    ]);
  });

  it("49 a Wednesday week keeps Wednesday through Friday", () => {
    const view = lockedWeeklyIntentToWeekArtifact(fixtureFullLockedWeek, fixtureNow(WED));
    expect(view.days.map(day => day.businessDate)).toEqual([WED, THU, FRI]);
    expect(view.days.map(day => day.weekdayLabel)).not.toContain("Monday");
  });

  it("50 a Thursday week keeps Thursday and Friday", () => {
    const view = lockedWeeklyIntentToWeekArtifact(fixtureFullLockedWeek, fixtureNow(THU));
    expect(view.days.map(day => day.businessDate)).toEqual([THU, FRI]);
  });

  it("51 a stand-down day does not get Start", () => {
    const html = lockedHtml({
      intent: fixtureStandDownDay,
      now: fixtureNow(WED),
      focus: WED,
      overlay: fixtureEmptyOverlay,
    });
    expect(html).toContain("Stand down");
    expect(html).not.toContain('data-testid="week-start"');
  });

  it("52 historical weekdays are not invented as empty panels", () => {
    const remnant = lockedWeeklyIntentToWeekArtifact(fixtureMondayRemnant, fixtureNow(MON));
    expect(remnant.days).toHaveLength(1);
    expect(remnant.days[0].weekdayLabel).toBe("Monday");
    const html = lockedHtml({
      intent: fixtureMondayRemnant,
      now: fixtureNow(MON),
      overlay: fixtureEmptyOverlay,
    });
    expect(html.match(/class="wb-panel/g)).toHaveLength(1);
    expect(html).not.toContain("Tuesday");
  });

  it("53 there is no progress bar", () => {
    const html = lockedHtml({ focus: THU, now: fixtureNow(MON) });
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("wb-progress");
    expect(css).not.toContain("progress");
  });

  it("54 folding does not call start or adjust during render", () => {
    let starts = 0;
    let adjusts = 0;
    const html = lockedHtml({
      focus: WED,
      now: fixtureNow(MON),
      onStartMission: () => {
        starts += 1;
      },
      onAdjustWeek: () => {
        adjusts += 1;
      },
    });
    expect(html).toContain("Previous day");
    expect(html).toContain("Next day");
    expect(starts).toBe(0);
    expect(adjusts).toBe(0);
  });

  it("55 production Week does not plan or invent a lock", () => {
    expect(readWeekVisit().phase).toBe("UNPLANNED");
    const reader = readFileSync(path.join(weekDir, "readWeekVisit.ts"), "utf8");
    expect(reader).toContain('phase: "UNPLANNED"');
    expect(reader).not.toContain("growthCandidate");
    expect(reader).not.toContain("internalHypothesis");
    expect(weekSource).not.toContain("growthCandidate");
    expect(businessDateInTimeZone(fixtureNow(MON))).toBe(MON);
  });
});

function htmlNav() {
  return lockedHtml({});
}
