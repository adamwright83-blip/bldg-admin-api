/* LEGACY DAYFORGE COMPATIBILITY: disposable historical SQL names only; current product is JOYSTICK. */
import { test, expect, type Page, type Route } from "@playwright/test";
import { cleanupOwner, database, login, provisionOwner, type TestOwner } from "../real/helpers";
import { resolveCanonicalOperatorIdentity } from "../../server/agents/persistentOperator/identity";

/**
 * OPEN COMMS session cancellation. Every async continuation of a comms session (server
 * reply, microphone start, Claire's voice ending) must be dropped once that session has
 * ended or been replaced. The real server answers; only timing is controlled here.
 */

const COMMS = "**/api/trpc/system.weeklyMission.deskComms**";

// Deterministic microphone, recorder and browser voice: the test decides when each one
// finishes. The microphone is a real audio signal whose loudness the test sets.
const stubs = () => {
  const w = window as any;
  w.__mic = { mode: "deny", streams: [] as MediaStream[], release: null as null | (() => void), gain: null as GainNode | null };
  const signal = () => {
    const ctx = new AudioContext();
    const tone = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const out = ctx.createMediaStreamDestination();
    tone.connect(gain).connect(out);
    tone.start();
    w.__mic.gain = gain;
    w.__mic.streams.push(out.stream);
    return out.stream;
  };
  w.__mic.loud = (on: boolean) => (w.__mic.gain!.gain.value = on ? 0.8 : 0);
  navigator.mediaDevices.getUserMedia = () =>
    new Promise<MediaStream>((resolve, reject) => {
      if (w.__mic.mode === "deny") return reject(new DOMException("Denied by the test", "NotAllowedError"));
      if (w.__mic.mode === "grant") return resolve(signal());
      w.__mic.release = () => resolve(signal());
    });
  // A recorder whose stop event the test can hold back, as a slow real encoder would.
  w.__rec = {
    all: [] as any[],
    held: [] as Array<() => void>,
    hold: false,
    recording: () => w.__rec.all.filter((r: any) => r.state === "recording").length,
    flush: () => w.__rec.held.splice(0).forEach((fire: () => void) => fire()),
  };
  class TestRecorder {
    static isTypeSupported = () => true;
    state = "inactive";
    mimeType = "audio/webm";
    onstop: ((e: Event) => void) | null = null;
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    constructor() {
      w.__rec.all.push(this);
    }
    start() {
      this.state = "recording";
    }
    stop() {
      if (this.state === "inactive") return;
      this.state = "inactive";
      const fire = () => {
        this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
        this.onstop?.(new Event("stop"));
      };
      if (w.__rec.hold) w.__rec.held.push(fire);
      else setTimeout(fire, 0);
    }
  }
  w.MediaRecorder = TestRecorder;
  w.__speech = { spoken: [] as SpeechSynthesisUtterance[], pending: [] as SpeechSynthesisUtterance[] };
  const end = (u: SpeechSynthesisUtterance) => u.onend?.(new Event("end") as SpeechSynthesisEvent);
  window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => {
    w.__speech.spoken.push(u);
    w.__speech.pending.push(u);
  };
  // Like a real browser, cancelling fires the utterance's end callback.
  window.speechSynthesis.cancel = () => w.__speech.pending.splice(0).forEach(end);
  w.__speech.finish = () => w.__speech.pending.splice(0).forEach(end);
};

type Gate = { release: () => void; requests: number };
/** Holds the deskComms requests the predicate selects until release(); the rest pass. */
async function gateComms(page: Page, hold: (n: number, body: string) => boolean): Promise<Gate> {
  let release!: () => void;
  const opened = new Promise<void>(r => (release = r));
  const gate: Gate = { release: () => release(), requests: 0 };
  await page.route(COMMS, async (route: Route) => {
    gate.requests += 1;
    if (hold(gate.requests, route.request().postData() ?? "")) await opened;
    await route.continue();
  });
  return gate;
}

const recording = (page: Page) => page.evaluate(() => (window as any).__rec.recording() as number);
const micMode = (page: Page, mode: "deny" | "hold" | "grant") => page.addInitScript(m => ((window as any).__mic.mode = m), mode);
const phase = (page: Page) => page.getByTestId("open-comms-phase");

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

const claireLines = (page: Page) => page.getByTestId("open-comms-log").locator(".cd-line-claire");
const spokenCount = (page: Page) => page.evaluate(() => (window as any).__speech.spoken.length as number);

async function openDesk(owner: TestOwner, page: Page) {
  await login(page, owner);
  await page.goto("/claire", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("open-comms-button")).toBeVisible();
}

test.describe("OPEN COMMS cancellation", () => {
  let owner: TestOwner;
  test.beforeEach(async () => {
    owner = await provisionOwner("Claire open comms cancellation");
    const db = await database();
    try {
      await db.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,'persistent_operator','manual',true)", [owner.tenantId]);
    } finally {
      await db.end();
    }
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId: owner.tenantId, source: { type: "open_id", value: owner.openId }, subsystem: "acceptance.fixture" });
    if (!resolved.ok) throw new Error("Fixture owner unavailable");
  });
  test.afterEach(async () => {
    await cleanupOwner(owner).catch(() => undefined);
  });

  test("ending while Claire is answering keeps comms closed when her reply arrives", async ({ page }) => {
    await page.addInitScript(stubs);
    const gate = await gateComms(page, (_n, body) => body.includes("Hold this turn"));
    await openDesk(owner, page);
    await page.getByTestId("open-comms-button").click();
    await expect(claireLines(page)).toHaveCount(1);
    await page.evaluate(() => (window as any).__speech.finish());
    await page.getByTestId("open-comms-input").fill("Hold this turn: add the van inspection.");
    await page.getByTestId("open-comms-input").press("Enter");
    await expect(page.getByTestId("open-comms-phase")).toHaveAttribute("data-phase", "processing");
    await page.getByTestId("open-comms-end").click();
    await expect(page.getByTestId("open-comms-button")).toBeVisible();

    const late = page.waitForResponse(r => r.url().includes("deskComms") && (r.request().postData() ?? "").includes("Hold this turn"));
    gate.release();
    await late;
    await page.waitForTimeout(750);
    await expect(page.getByTestId("open-comms-button")).toBeVisible();
    await expect(page.getByTestId("open-comms-phase")).toHaveCount(0);
    await expect(claireLines(page)).toHaveCount(1);
    expect(await spokenCount(page)).toBe(1);
  });

  test("a reply from an ended session never appears in the reopened one", async ({ page }) => {
    await page.addInitScript(stubs);
    const gate = await gateComms(page, n => n === 1);
    await openDesk(owner, page);
    await page.getByTestId("open-comms-button").click();
    await expect(page.getByTestId("open-comms-phase")).toHaveAttribute("data-phase", "connecting");
    await page.getByTestId("open-comms-end").click();
    await expect(page.getByTestId("open-comms-button")).toBeVisible();

    await page.getByTestId("open-comms-button").click();
    await expect(claireLines(page)).toHaveCount(1);
    await page.evaluate(() => (window as any).__speech.finish());
    await expect(page.getByTestId("open-comms-phase")).toHaveAttribute("data-phase", "listening");

    const late = page.waitForResponse(r => r.url().includes("deskComms"));
    gate.release();
    await late;
    await page.waitForTimeout(750);
    await expect(claireLines(page)).toHaveCount(1);
    await expect(page.getByTestId("open-comms-phase")).toHaveAttribute("data-phase", "listening");
    expect(await spokenCount(page)).toBe(1);
    expect(gate.requests).toBe(2);
  });

  test("ending while the microphone starts releases it and opens nothing", async ({ page }) => {
    await page.addInitScript(stubs);
    await micMode(page, "hold");
    const gate = await gateComms(page, () => false);
    await openDesk(owner, page);
    await page.getByTestId("open-comms-button").click();
    await expect(page.getByTestId("open-comms-phase")).toHaveAttribute("data-phase", "connecting");
    await page.getByTestId("open-comms-end").click();
    await expect(page.getByTestId("open-comms-button")).toBeVisible();

    await page.evaluate(() => (window as any).__mic.release());
    await page.waitForTimeout(750);
    await expect(page.getByTestId("open-comms-button")).toBeVisible();
    expect(gate.requests).toBe(0);
    expect(
      await page.evaluate(() =>
        ((window as any).__mic.streams as MediaStream[]).flatMap(s => s.getTracks()).every(t => t.readyState === "ended")
      )
    ).toBe(true);
  });

  test("Claire's voice finishing after End does not reopen the line", async ({ page }) => {
    await page.addInitScript(stubs);
    await openDesk(owner, page);
    await page.getByTestId("open-comms-button").click();
    await expect(claireLines(page)).toHaveCount(1);
    await expect(page.getByTestId("open-comms-phase")).toHaveAttribute("data-phase", "speaking");
    await page.getByTestId("open-comms-end").click();
    await expect(page.getByTestId("open-comms-button")).toBeVisible();
    // A late end/error callback from the cancelled utterance.
    await page.evaluate(() => {
      const u = (window as any).__speech.spoken[0] as SpeechSynthesisUtterance;
      u.onend?.(new Event("end") as SpeechSynthesisEvent);
      u.onerror?.(new Event("error") as SpeechSynthesisErrorEvent);
    });
    await page.waitForTimeout(500);
    await expect(page.getByTestId("open-comms-button")).toBeVisible();
    await expect(page.getByTestId("open-comms-phase")).toHaveCount(0);
  });

  test("an ended session's late recorder stop cannot cancel the new session's microphone", async ({ page }) => {
    await page.addInitScript(stubs);
    await micMode(page, "grant");
    await openDesk(owner, page);
    await page.getByTestId("open-comms-button").click();
    await expect(claireLines(page)).toHaveCount(1);
    await page.evaluate(() => (window as any).__speech.finish());
    await expect(phase(page)).toHaveAttribute("data-phase", "listening");
    expect(await recording(page)).toBe(1);

    // End while recording; the old recorder's stop event arrives only after the new session listens.
    await page.evaluate(() => ((window as any).__rec.hold = true));
    await page.getByTestId("open-comms-end").click();
    await expect(page.getByTestId("open-comms-button")).toBeVisible();
    await page.evaluate(() => ((window as any).__rec.hold = false));
    await page.getByTestId("open-comms-button").click();
    await expect(claireLines(page)).toHaveCount(1);
    await page.evaluate(() => (window as any).__speech.finish());
    await expect(phase(page)).toHaveAttribute("data-phase", "listening");
    await page.evaluate(() => (window as any).__rec.flush());

    // The new session still hears the operator.
    await page.evaluate(() => (window as any).__mic.loud(true));
    await expect(phase(page)).toHaveAttribute("data-phase", "hearing");
    expect(await recording(page)).toBe(1);
  });

  test("Interrupt starts exactly one listener", async ({ page }) => {
    await page.addInitScript(stubs);
    await micMode(page, "grant");
    await openDesk(owner, page);
    await page.getByTestId("open-comms-button").click();
    await expect(phase(page)).toHaveAttribute("data-phase", "speaking");
    await page.getByTestId("open-comms-interrupt").click();
    await expect(phase(page)).toHaveAttribute("data-phase", "listening");
    await page.waitForTimeout(300);
    expect(await recording(page)).toBe(1);
    await page.evaluate(() => (window as any).__mic.loud(true));
    await expect(phase(page)).toHaveAttribute("data-phase", "hearing");
    expect(await recording(page)).toBe(1);
  });

  test("speaking over Claire (barge-in) starts exactly one listener", async ({ page }) => {
    await page.addInitScript(stubs);
    await micMode(page, "grant");
    await openDesk(owner, page);
    await page.getByTestId("open-comms-button").click();
    await expect(phase(page)).toHaveAttribute("data-phase", "speaking");
    await page.evaluate(() => (window as any).__mic.loud(true));
    await expect(phase(page)).toHaveAttribute("data-phase", "hearing");
    await page.waitForTimeout(300);
    expect(await recording(page)).toBe(1);
  });
});
