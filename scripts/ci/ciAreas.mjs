/**
 * The CI areas a pull request can need, and what makes each one run.
 * scripts/ci/ciScopes.mjs reads this table; .github/workflows/ci.yml has one job per `job`;
 * docs/ci/CI_SCOPES.md explains it for people.
 *
 * An area runs when a changed file
 *   - matches one of its `paths` (globs, GitHub paths-filter syntax) or is its own workflow file;
 *   - is imported, directly or through other files, by one of its tests or scripts. Those roots are
 *     read from the area's workflow (every repo path, package script and Playwright testDir it names)
 *     plus any extra `roots` listed here;
 *   - belongs to a shared layer the area `uses`: the database schema and migrations, the server core,
 *     or the client shell (LAYERS below).
 * Anything in FULL_REGRESSION runs every area.
 *
 * Paths for areas that used to have a pull_request paths filter are that filter, unchanged.
 * When you add a suite, add its area here and its job to ci.yml; ciScopes.test.mjs checks they agree.
 */

/** Never reach a compiler, a test or a browser. Docs still pass the nomenclature and spoiler guards. */
export const NO_CODE = ["docs/**", "artifacts/**", "screenshots/**", "**/*.md"];

/**
 * Dependencies, compiler and test-runner configuration, and ci.yml itself: run everything.
 * The selection rules (scripts/ci/ci*.mjs) are proven by their own tests, which the scope job runs on
 * every pull request, and by the nightly run, which selects everything whatever the rules say.
 */
export const FULL_REGRESSION = [
  "package.json",
  "pnpm-lock.yaml",
  "patches/**",
  ".npmrc",
  ".nvmrc",
  "tsconfig.json",
  "tsconfig.node.json",
  "vitest.config.ts",
  "vitest.integration.config.ts",
  ".github/workflows/ci.yml",
];

/** Shared layers. An area lists the ones it depends on in `uses`. */
export const LAYERS = {
  // Every suite that migrates a disposable MySQL from scratch depends on these.
  database: [
    "drizzle/**",
    "drizzle.config.ts",
    "scripts/migrate.mjs",
    "server/legacy/dayforge/release/applyReleaseMigrations.ts",
  ],
  // Server boot, request context, authentication cookies and the tRPC root.
  server: ["server/_core/**", "server/routers.ts", "server/db.ts"],
  // What every browser page loads before its own code.
  client: [
    "client/index.html",
    "client/src/App.tsx",
    "client/src/main.tsx",
    "client/src/index.css",
    "client/src/_core/**",
    "client/src/contexts/**",
    "client/src/hostRouting/**",
    "vite.config.ts",
  ],
};

// Sign-in, sessions and accounts.
const AUTH = [
  "server/joystickAccount/**",
  "shared/joystickAccount*",
  "client/src/pages/account/**",
  "server/firstTenMinutes/oauthRoutes.ts",
  "server/saas/saasAuth*",
  "server/identity/**",
  "server/legacy/dayforge/security/**",
  "server/legacyDayforgeSecurity/**",
  "server/auth*",
];

// Money: SaaS subscriptions, card intake, marketplace payments, paid-order authority.
const PAYMENTS = [
  "server/**/*[Pp]ayment*",
  "server/**/*[Ss]tripe*",
  "server/**/*[Bb]illing*",
  "server/marketplacePayments/**",
  "server/domains/payment/**",
  "server/money/**",
  "shared/**/*[Pp]ayment*",
  "shared/**/*[Ss]tripe*",
  "shared/**/*[Bb]illing*",
  "client/src/**/*[Ss]tripe*",
  "client/src/**/*[Bb]illing*",
];

// Which tenant a request, a row or a worker belongs to.
const TENANCY = [
  "server/saas/**",
  "server/platform/tenancy/**",
  "server/platform/authority/**",
  "server/team/**",
  "shared/**/*[Tt]enant*",
];

// Fast Goldline smoke: the deterministic proof world every browser entry boots.
const PROOF_WORLD = [
  "e2e/goldline-smoke/**",
  "playwright.goldline-smoke.config.ts",
  "scripts/goldline-living-world-proof-seed.ts",
  "scripts/goldline-proof-server.sh",
  ".github/goldline-fast-smoke-matrix.json",
  "scripts/ci/goldlineSmokeScope.mjs",
];

/**
 * @typedef {object} Area
 * @property {string} id         Unique. Shown in the scope summary.
 * @property {string} job        The ci.yml job that runs it. Several areas may share one job.
 * @property {string} workflow   The reusable workflow that job calls.
 * @property {string} title
 * @property {string} [guards]   What a failure here means; shown in the summary and in CI_SCOPES.md.
 * @property {Array<keyof typeof LAYERS>} [uses]
 * @property {string[]} [paths]
 * @property {string[]} [exclude]  Files that never match `paths` (they can still be imported by a root).
 * @property {string[]} [roots]  Extra roots beyond what the workflow names.
 * @property {number} [importDepth]  How far imports are followed from the roots (default 2). 0: a root itself
 *   or `paths`, tests included. Every area that had a pull_request paths filter starts at 0, so it runs at
 *   least as often as before and no more, until someone widens it on purpose.
 * @property {string} [rootsFromJob]  Read roots from this one job of the workflow only.
 * @property {string} [smokeEntry]    Fast Goldline browser entry (matrix `name`) this area selects.
 * @property {boolean} [smokeContracts]  Selects the fast-contracts job of Fast Goldline smoke.
 */

/** @type {Area[]} */
export const AREAS = [
  // ── High-risk gates: accounts, payments, tenants, migrations ────────────────────────────────
  {
    id: "launch-exam",
    job: "launch-exam",
    workflow: "saas-launch-exam.yml",
    title: "JOYSTICK SaaS launch exam",
    guards: "fresh sign-up, sign-in, paid plan, two tenants side by side, real browser + MySQL",
    uses: ["database", "server", "client"],
    paths: [...AUTH, ...PAYMENTS, ...TENANCY, "e2e/real/**", "playwright.real.config.ts", "vite.real.config.ts"],
  },
  {
    id: "billing",
    job: "billing",
    workflow: "saas-billing-lifecycle.yml",
    title: "SaaS billing lifecycle",
    guards: "entitlements and the full Stripe subscription lifecycle on MySQL",
    uses: ["database"],
    paths: ["server/saas/**", ...PAYMENTS],
  },
  {
    id: "intake-http",
    job: "intake-http",
    workflow: "unit-suite.yml",
    title: "Resident order intake over HTTP",
    guards: "POST /api/intake/from-bldg, the resident app's order path, with card refs",
    uses: ["database", "server"],
    paths: [...PAYMENTS, "server/residentIntake*", "server/intake*", "server/residentPaymentMethods*"],
    roots: ["server/residentIntake.ts", "server/domains/orders/orderLifecycleService.ts"],
    rootsFromJob: "intake-http",
  },
  {
    id: "tenant-boundary",
    job: "tenant-boundary",
    workflow: "saas-tenant-boundary.yml",
    title: "SaaS tenant boundary",
    guards: "tenant identity, hostile cross-tenant routers, transcript privacy, order write convergence",
    uses: ["database", "server"],
    paths: [...TENANCY, ...AUTH],
  },
  {
    id: "tenant-lifecycle",
    job: "tenant-lifecycle",
    workflow: "saas-tenant-lifecycle.yml",
    title: "SaaS tenant lifecycle",
    guards: "tenant admission, export, safe deletion, protected tenants",
    uses: ["database"],
    paths: [...TENANCY],
  },
  {
    id: "plan-cogs",
    job: "plan-cogs",
    workflow: "saas-plan-cogs.yml",
    title: "SaaS plan COGS",
    guards: "plan-aware tenant cost isolation",
    uses: ["database"],
    paths: ["server/saas/**"],
  },
  {
    id: "schema-release",
    job: "schema-release",
    workflow: "saas-schema-release.yml",
    title: "Schema release: migrations, build and production boot",
    guards: "migrate.mjs on an empty database, drift repair, idempotency, pnpm build, pnpm start",
    uses: ["database", "server", "client"],
    // Any runtime code can break the production build or boot. Tests cannot.
    paths: [
      "server/**",
      "shared/**",
      "client/src/**",
      "extensions/**",
      "scripts/package-gumballpals.mjs",
      "scripts/schema-*.mjs",
      "vite.real.config.ts",
    ],
    exclude: ["**/*.test.{ts,tsx,mjs}", "**/*.spec.{ts,tsx}"],
  },
  {
    id: "procurement",
    job: "procurement",
    workflow: "procurement-durable-worker.yml",
    title: "Procurement durable worker",
    guards: "worker loop and workflow stores on MySQL",
    paths: ["server/procurement/**", "procurement/**"],
  },
  {
    id: "story",
    job: "story",
    workflow: "story-infrastructure.yml",
    title: "Story tables on real MySQL",
    guards: "story engine, tenant isolation of story state, a played season and its rollback",
    uses: ["database"],
    paths: ["server/story/**", "shared/story*", "scripts/story/**"],
  },

  // ── Core contracts and the whole-product release journey ───────────────────────────────────
  {
    id: "goldline-contracts",
    job: "goldline-smoke",
    workflow: "goldline-fast-smoke.yml",
    rootsFromJob: "fast-contracts",
    smokeContracts: true,
    title: "Fast Goldline contracts",
    guards: "platform authority, payment admission, order ownership, resident agent tools, Claire, Daphne, Mitch, migrations twice, ops-task MySQL",
    uses: ["database", "server"],
    paths: [...PAYMENTS, "server/agents/tools/**", "server/agents/s2sEndpoint.ts", "server/agents/permissions.ts"],
  },
  {
    id: "legacy-release",
    job: "legacy-release",
    workflow: "legacy-dayforge-compatibility-release.yml",
    title: "Legacy compatibility release journey",
    guards: "release contracts, sequential migrations, production-service journey, public preview on desktop and mobile",
    uses: ["database", "server", "client"],
    paths: [
      "server/legacy/**",
      "shared/legacyDayforge*",
      "client/src/legacy-dayforge-flagship-main.tsx",
      "client/src/pages/LegacyDayforge*",
      "client/src/pages/legacy-dayforge-flagship/**",
      "tsconfig.legacy-dayforge-release.json",
      "scripts/legacy-dayforge-*",
    ],
  },

  // ── Gameplay ────────────────────────────────────────────────────────────────────────────────
  {
    id: "smoke-world",
    job: "goldline-smoke",
    workflow: "goldline-fast-smoke.yml",
    rootsFromJob: "fast-browser",
    smokeEntry: "fast-smoke-world",
    title: "Fast Goldline smoke: driver world, Lantern City mount, operator, cozy outreach",
    uses: ["database", "server", "client"],
    paths: [
      ...PROOF_WORLD,
      "client/src/pages/Driver.tsx",
      "client/src/pages/driver/**",
      "client/src/pages/AdminHostApp.tsx",
      "client/src/pages/operator/**",
      "client/src/components/admin/control-room/LanternCitySceneV6/**",
      "client/src/game/**",
      "server/composition/**",
      "server/experience/**",
      "server/field/**",
      "server/agents/operatorRepresentative/**",
    ],
  },
  {
    id: "smoke-territories",
    job: "goldline-smoke",
    workflow: "goldline-fast-smoke.yml",
    rootsFromJob: "fast-browser",
    smokeEntry: "fast-smoke-territories",
    title: "Fast Goldline smoke: territories and guardians",
    uses: ["database", "server", "client"],
    paths: [...PROOF_WORLD, "client/src/pages/GuardianRosterPage.tsx", "client/src/pages/AdminHostApp.tsx", "server/territory/**"],
  },
  {
    id: "smoke-campaign",
    job: "goldline-smoke",
    workflow: "goldline-fast-smoke.yml",
    rootsFromJob: "fast-browser",
    smokeEntry: "fast-smoke-campaign",
    title: "Fast Goldline smoke: campaign and its mutation",
    uses: ["database", "server", "client"],
    paths: [...PROOF_WORLD, "client/src/pages/AdminHostApp.tsx", "shared/goldlineCampaign*", "server/campaignRuns/**", "server/campaignLibrary/**"],
  },
  {
    id: "smoke-beverly-hills",
    job: "goldline-smoke",
    workflow: "goldline-fast-smoke.yml",
    rootsFromJob: "fast-browser",
    smokeEntry: "fast-smoke-beverly-hills",
    title: "Fast Goldline smoke: Beverly Hills",
    uses: ["database", "server", "client"],
    paths: [...PROOF_WORLD, "client/src/pages/goldline/beverlyHills*/**", "shared/beverlyHills*", "server/experience/lanternCity/beverlyHills*", "e2e/beverly-hills-2d/playthrough.ts"],
  },
  {
    id: "smoke-century-park-east",
    job: "goldline-smoke",
    workflow: "goldline-fast-smoke.yml",
    rootsFromJob: "fast-browser",
    smokeEntry: "fast-smoke-century-park-east",
    title: "Fast Goldline smoke: Century Park East",
    uses: ["database", "server", "client"],
    paths: [...PROOF_WORLD, "client/src/pages/goldline/centuryParkEast3d/**"],
  },
  {
    id: "smoke-channel-382",
    job: "goldline-smoke",
    workflow: "goldline-fast-smoke.yml",
    rootsFromJob: "fast-browser",
    smokeEntry: "fast-smoke-channel-382",
    title: "Fast Goldline smoke: CHANNEL 382",
    uses: ["database", "server", "client"],
    paths: [...PROOF_WORLD, "client/src/pages/goldline/channel382/**"],
  },
  {
    id: "goldline-mobile",
    importDepth: 0,
    job: "goldline-mobile",
    workflow: "goldline-mobile-regression.yml",
    title: "Goldline mobile regression",
    paths: [
      "client/src/game/**",
      "client/src/pages/driver/GoldlineDriverController.tsx",
      "client/src/pages/Driver.tsx",
      "client/src/pages/goldline/**",
      "public/goldline/dayline-v2/**",
      "client/public/goldline/dayline-v2",
      "playwright.dayline-art.config.ts",
      "client/src/components/driver/**",
      "client/src/components/admin/control-room/**",
      "server/commercialMissions/driverSalesMotivationService.ts",
      "server/commercialMissions/driverSalesJournalResilience.test.ts",
      "server/experience/goldline/driver/**",
      "server/experience/lanternCity/businessOverview/**",
      "server/composition/driverGameWorldRouter.ts",
      "server/capabilities/expansionScoutCapability.ts",
      "server/armory/armoryWeaponService.ts",
      "server/armory/armoryRouter.ts",
      "server/armory/armoryEvolution.integration.test.ts",
      "server/salesIntel/driverSafeSalesIntel*",
      "server/field/**",
      "server/experience/**",
      "server/composition/goldlineWorldRouter.ts",
      "server/platform/persistence/**",
      "server/integrations/googleMaps/**",
      "server/legacy/dayforge/release/legacyDayforgeReleaseJourney.integration.test.ts",
      "server/openChannel/**",
      "server/impactSignals/**",
      "shared/localTargetRun.ts",
      "shared/localTargetRun.test.ts",
      "shared/impactSignal.ts",
      "shared/impactSignal.test.ts",
      "shared/goldlineProgression.ts",
      "shared/goldlineProgression.test.ts",
      "shared/goldlineArcade*",
      "shared/goldlineCamera*",
      "shared/goldlineCustomerWindows*",
      "shared/goldlineFuturePressure*",
      "shared/goldlineObligations*",
      "shared/goldlineTemporal*",
      "shared/driverSafeSalesIntel.ts",
      "client/public/goldline.webmanifest",
      "client/public/goldline-sw.js",
      "client/public/assets/goldline/**",
      "e2e/goldline/**",
      "e2e/goldline-smoke/**",
      "playwright.goldline.config.ts",
      "playwright.goldline-smoke.config.ts",
      "scripts/checkGoldlineBundleBudget.mjs",
      "scripts/verifyPlayableGoldline.mjs",
      "scripts/verifyGoldlineFirstPlayGate.mjs",
      "scripts/verifyGoldlineObjectiveHierarchyGate.mjs",
      "scripts/verifyGoldlineTrueTouch.mjs",
      "scripts/verifyGoldlineLocalTargetRunGate.mjs",
      "scripts/verifyGoldlineOpenChannelExpedition.mjs",
      "scripts/verifyGoldlineFieldIntel.mjs",
      "scripts/verifyGoldlineExternalOrder.mjs",
      "scripts/capture-goldline-closure.mjs",
      "scripts/measure-goldline-performance.mjs",
      "scripts/goldlineLocalProofTarget.mjs",
      ".github/workflows/goldline-fast-smoke.yml",
    ],
  },
  {
    id: "beverly-hills-2d",
    importDepth: 0,
    job: "beverly-hills-2d",
    workflow: "beverly-hills-2d.yml",
    title: "Beverly Hills 2D adventure",
    paths: [
      "client/src/pages/goldline/beverlyHills2d/**",
      "e2e/beverly-hills-2d/**",
      "playwright.beverly-hills.config.ts",
      "shared/beverlyHills*",
      "server/experience/lanternCity/beverlyHills*",
      "client/src/pages/AdminHostApp.tsx",
      "client/src/components/admin/**",
      "client/src/lib/**",
      "client/src/_core/**",
      "client/src/hooks/**",
      "client/src/contexts/**",
      "client/src/App.tsx",
      "client/src/main.tsx",
      "client/src/index.css",
      "client/index.html",
      "vite.config.ts",
      "tsconfig*.json",
    ],
  },

  // ── Claire, Daphne, Mitch, President and integrations ───────────────────────────────────────
  {
    id: "claire-analysis",
    importDepth: 0,
    job: "claire-analysis",
    workflow: "claire-analysis.yml",
    title: "Claire analysis: bounded evidence",
    paths: [
      "server/analytics/**",
      "server/claire/**",
      "server/strategy/**",
      "server/_core/llm*",
      "server/domains/orders/orderHistoryReadService.ts",
      "scripts/claire-analysis-*",
    ],
  },
  {
    id: "claire-sales-truth",
    importDepth: 0,
    job: "claire-sales-truth",
    workflow: "claire-sales-truth.yml",
    title: "Claire sales truth",
    paths: [
      "server/analytics/**",
      "server/integrations/cleancloud/**",
      "server/claire/**",
      "server/geography/customerOrderTruth*",
      "client/src/pages/goldline/ClaireDesk.tsx",
      "drizzle/0116_claire_sales_reconciliation.sql",
      "scripts/claire-sales-*",
      "scripts/migrate.mjs",
    ],
  },
  {
    id: "claire-strategic-preparation",
    importDepth: 0,
    job: "claire-strategic-preparation",
    workflow: "claire-strategic-preparation.yml",
    title: "Claire strategic preparation: connected journey and authenticated app",
    paths: [
      "server/strategy/**",
      "server/agents/persistentOperator/**",
      "server/claire/**",
      "server/planning/**",
      "shared/strategic*",
      "shared/operatingMandate*",
      "shared/claireRoleFeedback.ts",
      "client/src/App.tsx",
      "e2e/claire-acceptance/**",
      "shared/daphneMissionPresentation*",
      "shared/dayDirector.ts",
      "shared/goldlineDayLine.ts",
      "shared/missionDirector.ts",
      "server/agents/daphne/missionFollowUp.ts",
      "server/planning/dayDirector/**",
      "client/src/pages/driver/GoldlineDriverController.tsx",
      "client/src/pages/driver/goldlineDayPlanModel.ts",
      "client/src/pages/goldline/GoldlineDayPlan.tsx",
      "playwright.claire-acceptance.config.ts",
      "client/src/pages/goldline/Claire*",
      "drizzle/0128_claire_strategic_preparation.sql",
      "scripts/migrate.mjs",
    ],
  },
  {
    id: "daphne-v2-acceptance",
    importDepth: 0,
    job: "daphne-v2-acceptance",
    workflow: "daphne-v2-acceptance.yml",
    title: "Daphne V2 durable two-call acceptance",
    paths: ["server/agents/daphne/**", "server/claire/**"],
  },
  {
    id: "mission-director-cost",
    importDepth: 0,
    job: "mission-director-cost",
    workflow: "mission-director-cost.yml",
    title: "Mission Director explanation cost",
    paths: ["server/planning/missionDirector/**"],
  },
  {
    id: "cleancloud-intake-pilot",
    importDepth: 0,
    job: "cleancloud-intake-pilot",
    workflow: "cleancloud-intake-pilot.yml",
    title: "CleanCloud intake pilot",
    paths: [
      "shared/cleancloudIntake*",
      "server/integrations/cleancloud/intake/**",
      "extensions/gumballpals/**",
      "client/src/components/CleancloudIntakePanel.tsx",
      "e2e/cleancloud-intake/**",
    ],
  },
  {
    id: "cleancloud-late-sales",
    importDepth: 0,
    job: "cleancloud-late-sales",
    workflow: "cleancloud-late-sales.yml",
    title: "CleanCloud late sales recovery",
    paths: [
      "server/integrations/cleancloud/browserSync/cleancloudDirectSync.ts",
      "server/integrations/cleancloud/browserSync/lateSalesRecovery.mysql.integration.test.ts",
      "server/integrations/cleancloud/cleancloudPaidEvidence.ts",
      "server/analytics/paidOrderLedger.ts",
      "docs/verification/CLEANCLOUD_LATE_SALES.md",
    ],
  },
  {
    id: "google-integrations",
    importDepth: 0,
    job: "google-integrations",
    workflow: "google-integrations.yml",
    title: "Google integrations",
    paths: [
      "server/google/**",
      "server/geography/googleGeocoder*",
      "server/integrations/gmail/**",
      "server/integrations/googleMaps/**",
      "server/integrations/cleancloud/browserSync/gmailVerification.ts",
      "server/claire/prototype/tools.ts",
      "shared/googleCapabilities.ts",
      "shared/opportunityPressure*",
      "drizzle/0158_*",
      "drizzle/0159_*",
      "scripts/migrate.mjs",
    ],
  },
  {
    id: "mitch-event-driven",
    importDepth: 0,
    job: "mitch-event-driven",
    workflow: "mitch-event-driven.yml",
    title: "Mitch event-driven producer",
    paths: [
      "server/mitch/**",
      "shared/mitch*.ts",
      "drizzle/0111_mitch_producer_events.sql",
      "e2e/boreslay/**",
      "scripts/migrate.mjs",
      "scripts/mitch-github-agent.ts",
      "tsconfig.mitch-agent.json",
      ".github/workflows/mitch-claude-executor.yml",
      ".github/workflows/mitch-independent-reviewer.yml",
    ],
  },
  {
    id: "president-stage1",
    importDepth: 0,
    job: "president-stage1",
    workflow: "president-stage1.yml",
    title: "President Stage 1",
    paths: [
      "server/president/**",
      "client/src/pages/PresidentPage.*",
      "client/src/App.tsx",
      "e2e/president/**",
      "playwright.president.config.ts",
      "shared/presidentContracts.ts",
      "shared/presidentIntelligence.ts",
      "shared/presidentOperatingSystem.ts",
      ".agents/skills/president/**",
      "docs/JOYSTICK-SAAS-LAUNCH-OPS.md",
      "scripts/president-stage1-witness.ts",
      "drizzle/0109_president_stage1.sql",
      "drizzle/0113_president_intelligence.sql",
      "drizzle/0114_president_operating_system.sql",
      "scripts/president-migrate.mjs",
    ],
  },
  {
    id: "sales-intel-teaching-review",
    importDepth: 0,
    job: "sales-intel-teaching-review",
    workflow: "sales-intel-teaching-review.yml",
    title: "Sales intel teaching stays human-gated",
    paths: [
      "server/salesIntel/salesIntelTeachingReExtraction.ts",
      "server/salesIntel/salesIntelTeachingReExtraction.integration.test.ts",
      "server/salesIntel/salesIntelTeachingStore.ts",
      "shared/salesIntelTeaching.ts",
      "drizzle/**",
    ],
  },
];

/**
 * Suites that still trigger themselves on pull_request and are not yet behind merge-gate.
 * first-ten-minutes waits for the sign-up pull request (#812), which edits that workflow, to merge.
 * The scope summary still says when one of these would apply.
 */
export const STANDALONE = [
  {
    id: "first-ten-minutes",
    workflow: "first-ten-minutes.yml",
    title: "First ten minutes (sign-up and onboarding), on its own pull_request trigger",
  },
];
