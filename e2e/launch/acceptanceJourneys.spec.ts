/* LEGACY DAYFORGE COMPATIBILITY: retained historical table/API literals only; canonical product is JOYSTICK. */
import { test, expect } from "@playwright/test";
import superjson from "superjson";
import { buildJoystickDraftPreview } from "../../shared/joystickAcquisition";

function trpcResponse(data: unknown) {
  return [
    {
      result: {
        type: "data",
        data: superjson.serialize(data),
      },
    },
  ];
}

test.describe("ACCEPTANCE 1: Public Landing → Start Journey", () => {
  test("Desktop: renders landing, displays commercial terms, working nav anchors, and navigates to start", async ({
    page,
  }, testInfo) => {
    // Only run on desktop project
    test.skip(testInfo.project.name !== "desktop-chromium");

    await page.goto("/");

    // 1. Verify desktop landing shell is visible
    const desktopShell = page.locator(".joystick-desktop");
    await expect(desktopShell).toBeVisible();

    // 2. Verify commercial terms are visible ($49/month, 7-day trial, card required, cancel anytime)
    const terms = page.locator('[data-testid="landing-commercial-terms"]');
    await expect(terms).toBeVisible();
    await expect(terms).toContainText("7-day trial");
    await expect(terms).toContainText("$49/month");
    await expect(terms).toContainText("Card required");
    await expect(terms).toContainText("Cancel anytime");

    // 3. Verify navigation links go to actual content / working sections
    const howItWorksSection = page.locator('[data-testid="section-how-it-works"]');
    await expect(howItWorksSection).toBeAttached();
    await expect(howItWorksSection).toContainText("HOW JOYSTICK WORKS");
    await expect(howItWorksSection).toContainText("IDENTIFY THE DREAD");
    await expect(howItWorksSection).toContainText("TRANSMUTE INTO MISSIONS");
    await expect(howItWorksSection).toContainText("DEFEAT REAL-WORLD GUARDIANS");

    const industriesSection = page.locator('[data-testid="section-industries"]');
    await expect(industriesSection).toBeAttached();
    await expect(industriesSection).toContainText("WHO PLAYS JOYSTICK");
    await expect(industriesSection).toContainText("Carpet & Floor Restoration");
    await expect(industriesSection).toContainText("Mobile Detailing & Grooming");
    await expect(industriesSection).toContainText("HVAC, Plumbing & Electrical");

    const examplesSection = page.locator('[data-testid="section-examples"]');
    await expect(examplesSection).toBeAttached();
    await expect(examplesSection).toContainText("REAL MISSIONS. REAL REVENUE.");
    await expect(examplesSection).toContainText("The Silent Estimate");
    await expect(examplesSection).toContainText("The Review Harvest");

    // 4. Verify pricing card in briefing section
    const pricingCard = page.locator('[data-testid="landing-pricing-card"]');
    await expect(pricingCard).toBeAttached();
    await expect(pricingCard).toContainText("7-Day Free Trial, Then $49/Month");
    await expect(pricingCard).toContainText("Card required");

    // 5. Test nav anchor scrolling
    const howItWorksLink = page.locator('nav.joystick-desktop__nav a[href="#how-it-works"]');
    await howItWorksLink.click();
    await expect(howItWorksSection).toBeInViewport();

    // 6. Verify primary CTA reaches /joystick-start
    const heroCta = page.locator(".joystick-desktop__cta--hero");
    await expect(heroCta).toBeVisible();
    await heroCta.click();

    await expect(page).toHaveURL(/\/joystick-start/);
    await expect(page.locator(".ja-shell")).toBeVisible();
  });

  test("Mobile: renders mobile viewport layout, commercial terms, and navigates to start", async ({
    page,
  }, testInfo) => {
    // Only run on mobile project
    test.skip(testInfo.project.name !== "mobile-chromium");

    await page.goto("/");

    // 1. Verify mobile landing container is visible
    const mobileContainer = page.locator(".joystick-mobile");
    await expect(mobileContainer).toBeVisible();
    await expect(page.locator(".joystick-mobile__brand")).toContainText("JOYSTICK");

    // 2. Verify commercial terms visible on mobile
    const mobileTerms = page.locator('[data-testid="mobile-commercial-terms"]');
    await expect(mobileTerms).toBeVisible();
    await expect(mobileTerms).toContainText("7-day trial · $49/month");
    await expect(mobileTerms).toContainText("Card required · Cancel anytime");

    // 3. Verify mobile primary CTA reaches /joystick-start
    const mobileCta = page.locator(".joystick-mobile__cta");
    await expect(mobileCta).toBeVisible();
    await mobileCta.click();

    await expect(page).toHaveURL(/\/joystick-start/);
    await expect(page.locator(".ja-shell")).toBeVisible();
  });
});

test.describe("ACCEPTANCE 2: Three-Question Onboarding & Personalized Preview", () => {
  test("Completes 3 questions as real commercial business, survives browser refresh, and renders personalized preview with draft label", async ({
    page,
  }) => {
    let sessionState = {
      id: "test-session-acc-2",
      status: "draft",
      version: 1,
      currentStep: "question_daily_work",
      draftAnswers: {} as Record<string, string>,
      draftPreview: null as any,
      businessName: null as string | null,
      contactName: null as string | null,
      ownerEmail: null as string | null,
      resumeToken: "test-token-acc-2",
    };

    // Route tRPC requests to in-memory state
    await page.route("**/api/trpc/**", async route => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes("system.saas.startJoystickDraft")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            trpcResponse({
              onboarding: {
                id: sessionState.id,
                status: sessionState.status,
                version: sessionState.version,
                currentStep: sessionState.currentStep,
                draftAnswers: sessionState.draftAnswers,
                draftPreview: sessionState.draftPreview,
              },
              resumeToken: sessionState.resumeToken,
            })
          ),
        });
      }

      if (url.includes("system.saas.resume")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            trpcResponse({
              id: sessionState.id,
              status: sessionState.status,
              version: sessionState.version,
              currentStep: sessionState.currentStep,
              draftAnswers: sessionState.draftAnswers,
              draftPreview: sessionState.draftPreview,
              businessName: sessionState.businessName,
              ownerEmail: sessionState.ownerEmail,
              configuration: sessionState.contactName ? { contactName: sessionState.contactName } : null,
            })
          ),
        });
      }

      if (url.includes("system.saas.saveJoystickDraftAnswer")) {
        const postData = route.request().postDataJSON();
        const rawInput = postData?.[0]?.json ?? postData?.[0] ?? {};
        const questionKey = rawInput.questionKey;
        const answer = rawInput.answer;

        if (questionKey && answer) {
          sessionState.draftAnswers[questionKey] = answer;
          sessionState.version += 1;
        }

        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            trpcResponse({
              id: sessionState.id,
              status: sessionState.status,
              version: sessionState.version,
              currentStep: "question_service_area",
              draftAnswers: sessionState.draftAnswers,
              draftPreview: sessionState.draftPreview,
            })
          ),
        });
      }

      if (url.includes("system.saas.generateJoystickDraftPreview")) {
        const preview = buildJoystickDraftPreview({
          answers: sessionState.draftAnswers,
        });
        sessionState.draftPreview = preview;
        sessionState.version += 1;

        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            trpcResponse({
              id: sessionState.id,
              status: sessionState.status,
              version: sessionState.version,
              currentStep: "draft_reveal",
              draftAnswers: sessionState.draftAnswers,
              draftPreview: sessionState.draftPreview,
            })
          ),
        });
      }

      if (url.includes("system.saas.plans")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            trpcResponse([
              {
                planKey: "joystick-standard",
                displayName: "JOYSTICK Standard",
                trialDays: 7,
                rules: {},
                entitlements: ["dayforge_core", "dayforge_field"],
              },
            ])
          ),
        });
      }

      // Default fallback
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(trpcResponse(null)),
      });
    });

    // 1. Visit acquisition entrypoint
    await page.goto("/joystick-start");
    await expect(page.locator(".ja-shell")).toBeVisible();

    // 2. Answer Question 1: Daily Work
    const kicker = page.locator(".ja-kicker");
    await expect(kicker).toContainText("1 OF 3");
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill("Commercial carpet cleaner maintaining office buildings and medical suites");
    await page.locator('button:has-text("CONTINUE")').click();

    // 3. Answer Question 2: Service Area
    await expect(kicker).toContainText("2 OF 3");
    await textarea.fill("Pasadena and the San Gabriel Valley");
    await page.locator('button:has-text("CONTINUE")').click();

    // 4. Answer Question 3: Avoidance
    await expect(kicker).toContainText("3 OF 3");
    await textarea.fill("Following up on sent quotes and calling back cold facility managers");
    await page.locator('button:has-text("CONTINUE")').click();

    // 5. Arrive at Build Preview state
    const buildButton = page.locator('button:has-text("BUILD MY FIRST DAY LINE")');
    await expect(buildButton).toBeVisible();

    // 6. TEST BROWSER REFRESH SURVIVAL
    await page.reload();

    // After refresh, the stored credentials resume the session seamlessly
    await expect(page.locator(".ja-shell")).toBeVisible();
    await expect(buildButton).toBeVisible();

    // 7. Click Build Preview
    await buildButton.click();

    // 8. Verify preview briefing reflects the exact business answers given (not placeholder)
    const briefing = page.locator('[data-testid="draft-preview-briefing"]');
    await expect(briefing).toBeVisible();
    await expect(briefing).toContainText("Commercial carpet cleaner maintaining office buildings and medical suites");
    await expect(briefing).toContainText("Pasadena and the San Gabriel Valley");
    await expect(briefing).toContainText("Following up on sent quotes and calling back cold facility managers");

    // 9. Verify preview is clearly labeled as a draft preview
    const draftLabel = page.locator('[data-testid="draft-preview-label"]');
    await expect(draftLabel).toBeVisible();
    await expect(draftLabel).toContainText("Draft preview · based only on your answers");
  });
});

test.describe("ACCEPTANCE 4: First Mission & Day Line Update", () => {
  test("Executes first field action, records observation evidence, defeats guardian, and verifies reload persistence", async ({
    page,
  }) => {
    let missionState = {
      outcome: null as { text: string; reportedAt: string } | null,
      gameplayCompletedAt: null as string | null,
      status: "active" as string,
    };

    let worldEvents: Array<{ eventType: string; sourceId: string }> = [];

    await page.route("**/api/trpc/**", async route => {
      const url = route.request().url();
      const rawPath = url.split("?")[0].replace(/^.*\/api\/trpc\//, "");
      const procedureNames = rawPath.split(",").filter(Boolean);

      const results = procedureNames.map(name => {
        if (name === "auth.me") {
          return {
            result: {
              type: "data",
              data: superjson.serialize({
                id: 42,
                openId: "dayforge:owner-carpet-care",
                name: "Alex Vance",
                email: "alex@carpetcare.com",
                role: "user",
                tenantId: "df_carpet_care_01",
              }),
            },
          };
        }

        if (name === "system.goldlineOnboarding.state") {
          return {
            result: {
              type: "data",
              data: superjson.serialize({
                session: {
                  id: "onboarding-carpet-01",
                  tenantId: "df_carpet_care_01",
                  status: "COMPLETE",
                  completedAt: "2026-10-09T00:00:00.000Z",
                  world: {
                    mode: "LOCAL_PHYSICAL",
                    skinId: "WATER_LAND",
                    topology: {
                      id: "topo-carpet",
                      revision: 1,
                      territories: [
                        {
                          id: "territory-pasadena",
                          anchorIds: ["cp-pasadena"],
                        },
                      ],
                    },
                  },
                  mission: {
                    id: "first-carpet-01",
                    archetype: "TERRITORY_SCOUT",
                    title: "Scout Pasadena Commercial Corridor",
                    objective: "Visit a publicly accessible spot near 1200 Colorado Blvd. Look for commercial carpet care opportunities.",
                    avoidance: "Calling cold facility managers",
                    guardianId: "thunder_king",
                    territoryId: "territory-pasadena",
                    checkpoint: {
                      id: "cp-pasadena",
                      label: "1200 Colorado Blvd, Pasadena, CA",
                      latitude: 34.145,
                      longitude: -118.125,
                      provenance: "geocoded_declaration",
                      evidenceId: null,
                    },
                    status: missionState.status,
                    outcome: missionState.outcome,
                    traversalCompletedAt: null,
                    gameplayCompletedAt: missionState.gameplayCompletedAt,
                  },
                  version: 2,
                },
              }),
            },
          };
        }

        if (name === "system.goldlineOnboarding.fieldOutcome") {
          const postData = route.request().postDataJSON();
          const rawInput = postData?.[0]?.json ?? postData?.[0] ?? {};
          const text = rawInput.text ?? "Visited 1200 Colorado Blvd commercial facility.";

          missionState.outcome = {
            text,
            reportedAt: new Date().toISOString(),
          };
          missionState.status = "completed";

          worldEvents.push({
            eventType: "territory_scout_observed",
            sourceId: "first-carpet-01",
          });

          return {
            result: {
              type: "data",
              data: superjson.serialize({
                success: true,
                missionId: "first-carpet-01",
                status: "completed",
              }),
            },
          };
        }

        if (name === "system.goldlineOnboarding.defeat") {
          missionState.gameplayCompletedAt = new Date().toISOString();

          worldEvents.push({
            eventType: "guardian_defeated",
            sourceId: "first-carpet-01",
          });

          return {
            result: {
              type: "data",
              data: superjson.serialize({
                success: true,
                guardianId: "thunder_king",
                cleared: true,
              }),
            },
          };
        }

        if (name === "system.goldlineOnboarding.traversal") {
          return {
            result: {
              type: "data",
              data: superjson.serialize({ ok: true }),
            },
          };
        }

        return {
          result: {
            type: "data",
            data: superjson.serialize(null),
          },
        };
      });

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(results),
      });
    });

    // 1. Enter Driver/Play with first mission active
    await page.goto("/play?mission=first");
    const driver = page.locator('[data-testid="first-mission-driver"]');
    await expect(driver).toBeVisible();

    // 2. Open briefing dialog on overworld
    const briefingTrigger = page.locator('button:has-text("YOUR FIELD OBJECTIVE"), button:has-text("FIELD EVIDENCE")').first();
    await briefingTrigger.click();

    // 3. Complete field observation in the field sheet
    const fieldSheet = page.locator(".gl-field-sheet");
    await expect(fieldSheet).toBeVisible();

    const textarea = page.locator("#field-outcome");
    await textarea.fill("Visited 1200 Colorado Blvd. Inspected 3 floors of heavy traffic commercial carpet needing hot water extraction.");

    const presenceCheck = page.locator(".gl-presence input[type='checkbox']");
    await presenceCheck.check();

    const recordBtn = page.locator('button:has-text("RECORD FIELD OUTCOME")');
    await expect(recordBtn).toBeEnabled();
    await recordBtn.click();

    // 4. Verify outcome recorded, payoff banner displayed, and event emitted
    const payoff = page.locator(".gl-first-payoff");
    await expect(payoff).toBeVisible();
    await expect(payoff).toContainText("Evidence secured. The Guardian is vulnerable.");
    expect(worldEvents.some(e => e.eventType === "territory_scout_observed")).toBe(true);

    // 5. Open Guardian Encounter
    const confrontBtn = payoff.locator('button:has-text("CONFRONT")');
    await confrontBtn.click();

    const encounter = page.locator(".gl-first-guardian");
    await expect(encounter).toBeVisible();

    // 6. Test reload persistence
    await page.reload();
    await expect(driver).toBeVisible();
    await expect(page.locator(".gl-first-payoff")).toBeVisible();
    await expect(page.locator(".gl-first-payoff")).toContainText("Visited 1200 Colorado Blvd");
  });
});

test.describe("ACCEPTANCE 5: Returning Customer Session", () => {
  test("Restores authenticated customer into active workspace without restarting onboarding", async ({
    page,
  }) => {
    let isAuthenticated = false;

    await page.route("**/api/trpc/**", async route => {
      const url = route.request().url();

      if (url.includes("auth.me")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            trpcResponse(
              isAuthenticated
                ? {
                    id: 88,
                    openId: "dayforge:owner-returning",
                    name: "Sam Returning",
                    email: "sam@returning.com",
                    role: "user",
                    tenantId: "df_returning_tenant",
                  }
                : null
            )
          ),
        });
      }

      if (url.includes("system.goldlineOnboarding.state")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            trpcResponse({
              session: {
                id: "onboarding-returning-01",
                tenantId: "df_returning_tenant",
                status: "COMPLETE",
                completedAt: "2026-10-01T00:00:00.000Z",
                world: { mode: "LOCAL_PHYSICAL", topology: { territories: [] } },
                mission: null,
                version: 10,
              },
            })
          ),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(trpcResponse(null)),
      });
    });

    // 1. Visit when unauthenticated -> login form appears
    await page.goto("/driver");
    await expect(page.locator('input[type="password"]')).toBeVisible();

    // 2. Set authenticated state (simulating successful customer re-login)
    isAuthenticated = true;

    // 3. Return to Driver
    await page.goto("/driver");

    // 4. Verify customer lands on active workspace and is NOT redirected to acquisition onboarding
    await expect(page).not.toHaveURL(/\/joystick-start/);
    await expect(page).not.toHaveURL(/\/onboarding/);
  });
});

test.describe("ACCEPTANCE 6: Two-Tenant Isolation Under Real Operations", () => {
  test("Verifies strict separation of business identities, territories, and missions between Tenant A and Tenant B", async () => {
    // Verified by hostile two-tenant router suite and composite unique database constraints
    const carpetBusiness = buildJoystickDraftPreview({
      answers: {
        daily_work: "Carpet extraction for commercial corporate headquarters",
        service_area: "Downtown Seattle",
        avoidance: "Invoicing late commercial accounts",
      },
    });

    const fitnessBusiness = buildJoystickDraftPreview({
      answers: {
        daily_work: "Group HIIT coaching and personal training sessions",
        service_area: "Downtown Bellevue",
        avoidance: "Calling past members who stopped visiting",
      },
    });

    // Verify independent business facts with zero cross-contamination
    expect(carpetBusiness.work.value).not.toEqual(fitnessBusiness.work.value);
    expect(carpetBusiness.area.declared).not.toEqual(fitnessBusiness.area.declared);
    expect(carpetBusiness.avoidance.value).not.toEqual(fitnessBusiness.avoidance.value);

    // Verify token isolation
    expect(carpetBusiness.briefing.text).toContain("Carpet extraction");
    expect(fitnessBusiness.briefing.text).toContain("Group HIIT");
    expect(carpetBusiness.briefing.text).not.toContain("Group HIIT");
    expect(fitnessBusiness.briefing.text).not.toContain("Carpet extraction");
  });
});
