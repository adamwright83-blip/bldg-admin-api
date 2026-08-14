import { expect, test, type Page } from "@playwright/test";

// These permanent gates intentionally drive the complete physical traversal,
// arcade encounter, authoritative action, refetch, and projection chain. A
// cold single-core CI runner can take longer than Playwright's 30s default
// without any individual readiness assertion failing.
test.describe.configure({ timeout: 90_000 });

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

type ListenerSnapshot = Record<string, number> & {
  pixiTicker: number;
  populationBehaviorCallback: number;
  corridorTransitionCallback: number;
  audioLifecycleBinding: number;
};
type FixtureProof = {
  fixture: "CALL" | "VISIT" | "FOLLOW_UP" | "RECOVER";
  writes: Array<{ kind: string; missionId: number; requestId: string }>;
  refetches: number;
  projectedState: string;
};

async function installPermanentGateProbe(page: Page) {
  await page.addInitScript(() => {
    window.__GOLDLINE_DETERMINISTIC_ENCOUNTERS__ = true;
    window.localStorage.setItem(
      "goldline:checkpoint:v2:goldline-e2e",
      JSON.stringify({
        corridorId: "corridor_01",
        progress: 0.21,
        lateral: 0,
        branch: "intel",
        savedAt: "2026-08-12T00:00:00.000Z",
      })
    );

    const counts = new Map<string, number>();
    const registrations = new WeakMap<
      EventTarget,
      Map<string, Set<EventListenerOrEventListenerObject>>
    >();
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const measured = new Set([
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
      "visibilitychange",
      "focus",
      "pageshow",
      "blur",
      "pagehide",
      "resize",
      "orientationchange",
      "scroll",
    ]);
    const keyFor = (target: EventTarget, type: string): string | null => {
      if (!measured.has(type)) return null;
      if (target === window.visualViewport) return `visualViewport:${type}`;
      if (target === window) return `window:${type}`;
      if (target === document) return `document:${type}`;
      if (type.startsWith("pointer")) return `pointer:${type}`;
      return null;
    };
    const change = (key: string | null, delta: number) => {
      if (!key) return;
      counts.set(key, (counts.get(key) ?? 0) + delta);
    };
    EventTarget.prototype.addEventListener = function (
      type,
      listener,
      options
    ) {
      const capture =
        typeof options === "boolean" ? options : Boolean(options?.capture);
      const registrationKey = `${type}:${capture ? "capture" : "bubble"}`;
      let targetRegistrations = registrations.get(this);
      if (!targetRegistrations) {
        targetRegistrations = new Map();
        registrations.set(this, targetRegistrations);
      }
      let listeners = targetRegistrations.get(registrationKey);
      if (!listeners) {
        listeners = new Set();
        targetRegistrations.set(registrationKey, listeners);
      }
      if (listener && !listeners.has(listener)) {
        listeners.add(listener);
        change(keyFor(this, type), 1);
      }
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (
      type,
      listener,
      options
    ) {
      const capture =
        typeof options === "boolean" ? options : Boolean(options?.capture);
      const registrationKey = `${type}:${capture ? "capture" : "bubble"}`;
      const listeners = registrations.get(this)?.get(registrationKey);
      if (listener && listeners?.delete(listener)) {
        change(keyFor(this, type), -1);
      }
      return originalRemove.call(this, type, listener, options);
    };

    const lifecycleCounts = new Map<string, number>();
    window.__GOLDLINE_LIFECYCLE_PROBE__ = {
      update: (kind, delta) => {
        lifecycleCounts.set(kind, (lifecycleCounts.get(kind) ?? 0) + delta);
      },
    };
    Object.defineProperty(window, "__GOLDLINE_LISTENER_PROBE__", {
      configurable: true,
      value: {
        snapshot: () => ({
          ...Object.fromEntries(counts.entries()),
          pixiTicker: lifecycleCounts.get("pixiTicker") ?? 0,
          populationBehaviorCallback:
            lifecycleCounts.get("populationBehaviorCallback") ?? 0,
          corridorTransitionCallback:
            lifecycleCounts.get("corridorTransitionCallback") ?? 0,
          audioLifecycleBinding:
            lifecycleCounts.get("audioLifecycleBinding") ?? 0,
        }),
      },
    });
  });
}

async function login(page: Page, fixture: FixtureProof["fixture"]) {
  await installPermanentGateProbe(page);
  // First-entry explainer only shows once per player identity (see
  // onboardingProgress.ts) and would otherwise intercept pointer events
  // for every test that doesn't care about it.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "goldline:onboarding:v1",
      JSON.stringify(["first_entry_explained"])
    );
  });
  const response = await page.request.post("/api/auth/login", {
    data: { password: DRIVER_PASSWORD, role: "driver" },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto(`/driver?goldlineFixture=${fixture}`);
  await expect(page.getByTestId("goldline-shell")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("canvas.goldline-game-canvas")).toHaveCount(1);
  await expect
    .poll(async () => (await listenerSnapshot(page)).pixiTicker)
    .toBe(1);
}

async function listenerSnapshot(page: Page): Promise<ListenerSnapshot> {
  return page.evaluate(() => {
    const probe = (
      window as unknown as {
        __GOLDLINE_LISTENER_PROBE__: { snapshot: () => ListenerSnapshot };
      }
    ).__GOLDLINE_LISTENER_PROBE__;
    return probe.snapshot();
  });
}

async function stableListenerSnapshot(page: Page): Promise<ListenerSnapshot> {
  let previous = await listenerSnapshot(page);
  let matchingSamples = 0;

  for (let sample = 0; sample < 24; sample += 1) {
    await page.waitForTimeout(250);
    const current = await listenerSnapshot(page);
    if (JSON.stringify(current) === JSON.stringify(previous)) {
      matchingSamples += 1;
      if (matchingSamples === 4) return current;
    } else {
      previous = current;
      matchingSamples = 0;
    }
  }

  throw new Error("Goldline listener registration baseline did not settle");
}

async function fixtureProof(page: Page): Promise<FixtureProof> {
  return page.evaluate(() => {
    const proof = (
      window as unknown as { __GOLDLINE_BUSINESS_FIXTURE__?: FixtureProof }
    ).__GOLDLINE_BUSINESS_FIXTURE__;
    if (!proof) throw new Error("Goldline business fixture proof is missing");
    return structuredClone(proof);
  });
}

async function moveForwardUntil(page: Page, action: string) {
  const actionButton = page
    .locator(".context-actions button")
    .filter({ hasText: action });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await actionButton.isVisible().catch(() => false)) return;
    const box = await page.getByTestId("goldline-joystick").boundingBox();
    if (!box) throw new Error("Goldline joystick is unavailable");
    await page.mouse.move(box.x + box.width / 2, box.y + 4);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
  }
  await expect(actionButton).toBeVisible();
}

async function reachPhysicalEncounter(page: Page) {
  // JUMP/CLIMB/VAULT were removed as unsupported traversal gates (no
  // visible world geometry backed them — see RouteCorridor.ts). Ordinary
  // free movement up to the fortress-gate's real, always-visible geometry
  // replaces the old obstacle-clicking sequence.
  await moveForwardUntil(page, "INTERACT");
  await page
    .locator(".context-actions button")
    .filter({ hasText: "INTERACT" })
    .click();
  await expect(page.locator(".encounter, .anchor-encounter")).toBeVisible();
}

async function resolveAnchorPerfectly(page: Page) {
  const ability = page.locator(".ability-loadout button").filter({
    hasText: "NO-RISK TRIAL",
  });
  const weakPoint = page.getByRole("button", {
    name: /Weak point — tap or flick selected ability here/i,
  });
  await ability.click();
  await weakPoint.click({ force: true });
  await ability.click();
  await weakPoint.click({ force: true });
  await expect(page.locator(".business-resolution-gate")).toBeVisible();
}

async function resolveGatekeeperPerfectly(page: Page) {
  const weapon = page.locator(".armory-weapon-main").first();
  await expect(weapon).toBeVisible();
  await weapon.click();
  const originNode = page.locator(".gate-origin");
  const timingGateNode = page.locator(".gate-node").nth(1);
  await expect(originNode).toBeVisible();
  await expect(timingGateNode).toBeVisible();
  const origin = await originNode.boundingBox();
  const timingGate = await timingGateNode.boundingBox();
  if (!origin || !timingGate)
    throw new Error("Gatekeeper route is unavailable");
  await page.mouse.move(
    origin.x + origin.width / 2,
    origin.y + origin.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    timingGate.x + timingGate.width / 2,
    timingGate.y + timingGate.height / 2,
    { steps: 8 }
  );
  await page.mouse.up();
  await expect(page.locator(".business-resolution-gate")).toBeVisible();
}

async function resolveGhostPerfectly(page: Page) {
  const weapon = page.locator(".armory-weapon-main").first();
  await expect(weapon).toBeVisible();
  await weapon.click();
  const signalField = page.locator(".signal-field");
  await expect(signalField).toBeVisible();
  const field = await signalField.boundingBox();
  if (!field) throw new Error("Ghost signal field is unavailable");
  await page.mouse.move(field.x + field.width / 2, field.y + field.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1_850);
  await page.mouse.up();
  await expect(page.locator(".business-resolution-gate")).toBeVisible();
}

async function openBusinessAction(page: Page) {
  const action = page.locator(".business-resolution-gate button");
  await expect(action).toBeVisible();
  await action.click();
  await expect(
    page.locator(".goldline-action-surface, .real-action-bridge")
  ).toBeVisible();
}

function expectStableRequestId(proof: FixtureProof) {
  expect(proof.writes.length).toBeGreaterThan(0);
  expect(new Set(proof.writes.map(write => write.requestId)).size).toBe(1);
}

async function expectControlRestored(page: Page, before: ListenerSnapshot) {
  await expect(page.getByTestId("goldline-world")).toHaveAttribute(
    "data-game-view",
    "explore"
  );
  await expect(page.getByTestId("goldline-joystick")).toBeVisible();
  for (const key of [
    "document:visibilitychange",
    "window:focus",
    "window:pageshow",
    "window:blur",
    "window:pagehide",
  ]) {
    await expect
      .poll(async () => (await listenerSnapshot(page))[key] ?? 0, {
        message: `${key} must not accumulate`,
      })
      .toBe(before[key] ?? 0);
  }
}

test("CALL drives the full chain but a perfect arcade result cannot capture", async ({
  page,
}) => {
  await login(page, "CALL");
  const listenersBefore = await listenerSnapshot(page);
  await reachPhysicalEncounter(page);
  await resolveAnchorPerfectly(page);

  expect((await fixtureProof(page)).projectedState).toBe("active");
  expect((await fixtureProof(page)).writes).toEqual([]);

  await openBusinessAction(page);
  await page.locator("select").selectOption("visit_booked");
  await page.locator("textarea").fill("Real call reached the decision maker.");
  await page.getByRole("button", { name: "RECORD CALL RESULT" }).click();

  await expectControlRestored(page, listenersBefore);
  const proof = await fixtureProof(page);
  expect(proof.writes.map(write => write.kind)).toEqual(["CALL_ATTEMPT"]);
  expect(proof.refetches).toBeGreaterThanOrEqual(1);
  expect(proof.projectedState).toBe("active");
  expectStableRequestId(proof);
});

test("VISIT requires preparation, departure, arrival, and an authoritative outcome", async ({
  page,
}) => {
  await login(page, "VISIT");
  const listenersBefore = await listenerSnapshot(page);
  await reachPhysicalEncounter(page);
  await resolveGatekeeperPerfectly(page);
  await openBusinessAction(page);

  await page.getByRole("button", { name: /PREPARE VISIT/ }).click();
  await page.getByRole("button", { name: /DEPART/ }).click();
  await expect(page.getByRole("button", { name: /ARRIVED/ })).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new PageTransitionEvent("pageshow"));
    window.dispatchEvent(new Event("focus"));
  });
  expect((await fixtureProof(page)).writes.map(write => write.kind)).toEqual([
    "FIELD_PREPARE",
    "FIELD_DEPART",
  ]);

  await page.getByRole("button", { name: /ARRIVED/ }).click();
  await page.locator("select").selectOption("won");
  await page
    .locator("textarea")
    .fill("Real field visit produced a signed result.");
  await page.getByRole("button", { name: "RECORD VISIT RESULT" }).click();

  await expectControlRestored(page, listenersBefore);
  const proof = await fixtureProof(page);
  expect(proof.writes.map(write => write.kind)).toEqual([
    "FIELD_PREPARE",
    "FIELD_DEPART",
    "FIELD_ARRIVE",
    "FIELD_OUTCOME",
  ]);
  expect(proof.refetches).toBeGreaterThanOrEqual(5);
  expect(proof.projectedState).toBe("captured");
  expectStableRequestId(proof);
});

test("FOLLOW_UP only resolves after the linked authoritative completion", async ({
  page,
}) => {
  await login(page, "FOLLOW_UP");
  const listenersBefore = await listenerSnapshot(page);
  await reachPhysicalEncounter(page);
  await resolveGhostPerfectly(page);
  await openBusinessAction(page);

  await page.locator('input[type="datetime-local"]').fill("2026-08-20T10:30");
  expect((await fixtureProof(page)).writes).toEqual([]);
  await page.getByRole("button", { name: "RECORD FOLLOW-UP COMPLETE" }).click();

  await expectControlRestored(page, listenersBefore);
  const proof = await fixtureProof(page);
  expect(proof.writes.map(write => write.kind)).toEqual(["FOLLOW_UP_COMPLETE"]);
  expect(proof.refetches).toBeGreaterThanOrEqual(1);
  expect(proof.projectedState).toBe("contested");
  expectStableRequestId(proof);
});

test("RECOVER becomes active only after authoritative recovery persistence", async ({
  page,
}) => {
  await login(page, "RECOVER");
  const listenersBefore = await listenerSnapshot(page);
  await reachPhysicalEncounter(page);
  await resolveGhostPerfectly(page);
  await openBusinessAction(page);

  expect((await fixtureProof(page)).projectedState).toBe("recovery_available");
  await page.getByRole("button", { name: "RECOVER", exact: true }).click();

  await expectControlRestored(page, listenersBefore);
  const proof = await fixtureProof(page);
  expect(proof.writes.map(write => write.kind)).toEqual(["RECOVER"]);
  expect(proof.refetches).toBeGreaterThanOrEqual(1);
  expect(proof.projectedState).toBe("recovery_active");
  expect(proof.projectedState).not.toBe("captured");
  expectStableRequestId(proof);
});

test("five mount cycles retain exact ticker, pointer, viewport, and resume listener counts", async ({
  page,
}) => {
  await login(page, "CALL");
  const expected = await stableListenerSnapshot(page);
  expect(expected.pixiTicker).toBe(1);
  expect(expected.populationBehaviorCallback).toBe(1);
  expect(expected.corridorTransitionCallback).toBe(1);
  expect(expected.audioLifecycleBinding).toBe(1);

  for (let cycle = 0; cycle < 4; cycle += 1) {
    await page.getByTestId("goldline-fixture-toggle-world").evaluate(node => {
      (node as HTMLButtonElement).click();
    });
    await expect(page.locator("canvas.goldline-game-canvas")).toHaveCount(0);
    expect((await listenerSnapshot(page)).pixiTicker).toBe(0);
    expect((await listenerSnapshot(page)).populationBehaviorCallback).toBe(0);
    expect((await listenerSnapshot(page)).corridorTransitionCallback).toBe(0);
    expect((await listenerSnapshot(page)).audioLifecycleBinding).toBe(0);

    await page.getByTestId("goldline-fixture-toggle-world").evaluate(node => {
      (node as HTMLButtonElement).click();
    });
    await expect(page.locator("canvas.goldline-game-canvas")).toHaveCount(1);
    expect((await stableListenerSnapshot(page)).pixiTicker).toBe(1);
  }

  const final = await stableListenerSnapshot(page);
  console.log(`[goldline-lifecycle] ${JSON.stringify(final)}`);
  expect(final).toEqual(expected);
  expect(final.pixiTicker).toBe(1);
  expect(final.populationBehaviorCallback).toBe(1);
  expect(final.corridorTransitionCallback).toBe(1);
  expect(final.audioLifecycleBinding).toBe(1);
  expect(await page.locator("canvas.goldline-game-canvas").count()).toBe(1);
});
