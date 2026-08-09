import { chromium } from "@playwright/test";

const pv = (value, provenance = "verified") => ({
  value,
  provenance,
  sourceReference: "visual-verification-fixture",
  asOf: "2026-08-09T08:00:00.000Z",
});

function asset({
  id,
  name,
  kind = "residential",
  health = "healthy",
  value = 0,
  due = 0,
  stage = null,
  annual = 0,
  realized = 0,
}) {
  return {
    id,
    kind,
    displayName: name,
    identityKey: `fixture:${id}`,
    property: {
      address: null,
      unit: null,
      buildingSlug: null,
      latitude: null,
      longitude: null,
      geoStatus: "unresolved",
    },
    contact: { phone: null, email: null },
    service: {
      orderCount: 1,
      completedCount: 1,
      lastServiceAt: "2026-08-08T20:00:00.000Z",
      recurring: false,
      serviceTypes: ["wash_fold"],
    },
    lifetimeValue: pv(value),
    outstandingReceivables: pv(due),
    averageOrderValue: pv(value),
    health,
    healthReason:
      health === "at_risk"
        ? "Verified follow-up is overdue"
        : "Verified recent activity",
    recovery: { status: null, interventionId: null },
    commercial:
      kind === "commercial"
        ? {
            accountId: Number(id.replace(/\D/g, "")) || 1,
            stage,
            estimatedAnnualValue: pv(annual),
            approvedValue: pv(0),
            realizedRevenue: pv(realized),
          }
        : null,
    nextAction: null,
    timeline: [],
    dataQuality: {
      status: "complete",
      warnings: [],
      sources: ["visual-verification-fixture"],
    },
  };
}

const customers = [
  asset({ id: "r1", name: "Hillside Residence", value: 94000 }),
  asset({
    id: "r2",
    name: "Marina Household",
    value: 61200,
    due: 1200,
    health: "watch",
  }),
  asset({
    id: "r3",
    name: "Westview Customer",
    value: 48500,
    health: "at_risk",
  }),
  asset({ id: "r4", name: "Lakeside Residence", value: 39700 }),
  asset({ id: "r5", name: "Downtown Household", value: 31600 }),
];

const commercial = [
  asset({
    id: "c1",
    name: "The Maybourne Beverly Hills",
    kind: "commercial",
    stage: "proposal",
    annual: 4200000,
    realized: 84000,
  }),
  asset({
    id: "c2",
    name: "The Louise Los Feliz",
    kind: "commercial",
    stage: "contact_made",
    annual: 1800000,
    realized: 0,
    health: "at_risk",
  }),
  asset({
    id: "c3",
    name: "Ridge Apartments",
    kind: "commercial",
    stage: "new_lead",
    annual: 900000,
    realized: 0,
  }),
];

const point = (entry, kind) => ({
  id: entry.id,
  kind,
  name: entry.displayName,
  latitude: null,
  longitude: null,
  geoStatus: "unresolved",
  state: kind === "commercial" ? entry.commercial.stage : entry.health,
  value: entry.lifetimeValue,
  detailPath: `/product/customer/${entry.id}`,
  sourceReference: "visual-verification-fixture",
  customerAsset: entry,
});

const world = {
  generatedAt: "2026-08-09T08:00:00.000Z",
  business: {
    tenantId: "laundry-butler",
    name: "Laundry Butler",
    brandName: "Laundry Butler",
    stage: "SOLO",
    primaryColor: "#1769aa",
  },
  hq: {
    id: "hq",
    kind: "hq",
    name: "Laundry Butler HQ",
    latitude: null,
    longitude: null,
    geoStatus: "unresolved",
    state: "active",
    value: null,
    detailPath: null,
    sourceReference: "visual-verification-fixture",
    customerAsset: null,
  },
  properties: customers.map(entry => point(entry, "customer")),
  commercialAssets: commercial.map(entry => point(entry, "commercial")),
  territorySignals: [],
  openThreats: [
    {
      id: "t1",
      type: "follow_up",
      title: "Follow-up overdue",
      sourceReference: "visual-verification-fixture",
      severity: "urgent",
    },
    {
      id: "t2",
      type: "receivable",
      title: "Payment due",
      sourceReference: "visual-verification-fixture",
      severity: "watch",
    },
    {
      id: "t3",
      type: "commercial",
      title: "Commercial relationship at risk",
      sourceReference: "visual-verification-fixture",
      severity: "urgent",
    },
    {
      id: "t4",
      type: "follow_up",
      title: "Follow-up needed",
      sourceReference: "visual-verification-fixture",
      severity: "watch",
    },
    {
      id: "t5",
      type: "retention",
      title: "Relationship is cooling",
      sourceReference: "visual-verification-fixture",
      severity: "watch",
    },
  ],
  growthSignals: [
    {
      id: "g1",
      title: "First hire conditions are approaching",
      value: pv(1),
      sourceReference: "visual-verification-fixture",
    },
  ],
  financialSummary: {
    collectedRevenue: pv(338500),
    realizedCommercialRevenue: pv(84000),
    receivables: pv(1200),
  },
  capabilities: [],
  teamSummary: { activeNonOwnerMembers: 0, ownerIndependentRevenue: pv(0) },
  recentChanges: [
    {
      id: "e1",
      occurredAt: "2026-08-09T07:00:00.000Z",
      title: "Payment collected",
      sourceReference: "visual-verification-fixture",
      verificationClass: "VERIFIED",
    },
    {
      id: "e2",
      occurredAt: "2026-08-09T06:00:00.000Z",
      title: "Commercial walk in logged",
      sourceReference: "visual-verification-fixture",
      verificationClass: "ATTESTED",
    },
  ],
  dataQuality: {
    status: "complete",
    warnings: [],
    sources: ["orders", "payments", "commercial_accounts"],
  },
};

const user = {
  id: 1,
  openId: "fixture-owner",
  name: "Owner",
  email: "owner@example.test",
  role: "admin",
};
const saasMe = {
  tenantId: "laundry-butler",
  membership: { role: "admin" },
  configuration: {
    tenant: { brandName: "Laundry Butler" },
    brandName: "Laundry Butler",
  },
  billing: {},
};

function dataFor(procedure) {
  if (procedure === "auth.me") return user;
  if (procedure === "system.saas.me") return saasMe;
  if (procedure === "system.businessWorld.get") return world;
  if (procedure === "system.customerAssets.list")
    return [...customers, ...commercial];
  if (procedure === "system.customerAssets.detail") return customers[0];
  if (procedure === "system.money.get") {
    return {
      collectedRevenue: pv(338500),
      receivables: pv(1200),
      grossRevenue: pv(346900),
      operatingExpenses: pv(0),
      trueNet: pv(346900),
      expansionCapital: pv(null, "unknown"),
      expansionCapitalStatus: "unknown",
      trust: { trusted: true, warnings: [] },
    };
  }
  return {};
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
});
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
page.on("console", message => {
  if (message.type() === "error") pageErrors.push(message.text());
});
await page.route("**/api/trpc/**", async route => {
  const url = new URL(route.request().url());
  const procedures = decodeURIComponent(
    url.pathname.split("/api/trpc/")[1] ?? ""
  ).split(",");
  const payload = procedures.map(procedure => ({
    result: { data: { json: dataFor(procedure) } },
  }));
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(
      url.searchParams.get("batch") === "1" ? payload : payload[0]
    ),
  });
});

await page.goto("http://127.0.0.1:5173/product/hq", {
  waitUntil: "networkidle",
});
await page.getByRole("heading", { name: "Laundry Butler World" }).waitFor();
const desktop =
  "/Users/adamwrightpfi/.codex/visualizations/2026/08/09/019fe538-2f7e-72f1-bdc1-0d86e50cfc5c/laundry-butler-world-desktop.png";
await page.screenshot({ path: desktop, fullPage: true });

const counts = {
  residential: await page.locator(".cc-property-object.residential").count(),
  commercial: await page.locator(".cc-property-object.commercial").count(),
  treasury: await page.getByText("Treasury", { exact: true }).count(),
  riskBeacons: await page.locator(".cc-property-beacon.danger").count(),
  receivables: await page.locator(".cc-stuck-money").count(),
};

await page.getByText("Treasury", { exact: true }).first().click();
await page.waitForURL("**/product/money");
const treasuryUrl = page.url();
await page.goto("http://127.0.0.1:5173/product/hq", {
  waitUntil: "networkidle",
});
await page.locator(".cc-property-object.residential").first().click();
await page.waitForURL("**/product/customer/r1");
const customerUrl = page.url();

await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:5173/product/hq", {
  waitUntil: "networkidle",
});
await page.getByRole("heading", { name: "Laundry Butler World" }).waitFor();
const mobile =
  "/Users/adamwrightpfi/.codex/visualizations/2026/08/09/019fe538-2f7e-72f1-bdc1-0d86e50cfc5c/laundry-butler-world-mobile.png";
await page.screenshot({ path: mobile, fullPage: true });
const overflow = await page.evaluate(
  () =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
);

console.log(
  JSON.stringify(
    {
      desktop,
      mobile,
      counts,
      treasuryUrl,
      customerUrl,
      mobileHorizontalOverflow: overflow,
      pageErrors,
    },
    null,
    2
  )
);
await browser.close();
