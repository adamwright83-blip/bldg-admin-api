import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readMetricsOverview, assertCleanCloudScreenshotTarget } from "./browser.js";

function textNode(text) {
  return { nodeType: 3, textContent: text };
}

function element(text, options = {}) {
  const children = options.children ?? [];
  const node = {
    tag: options.tag ?? "div",
    style: options.style ?? {},
    parentElement: options.parentElement ?? null,
    textContent: options.textContent ?? text,
    childNodes: text ? [textNode(text)] : [],
    children,
    nextElementSibling: options.next ?? null,
    getClientRects: () => (options.hidden ? [] : [1]),
    getBoundingClientRect: () => ({
      top: options.top ?? 100,
      bottom: options.bottom ?? 120,
      left: options.left ?? 10,
      right: options.right ?? 300,
    }),
    scrollIntoView() {
      options.onScroll?.();
    },
    click() {
      options.onClick?.();
    },
    contains(other) {
      return other === node || node.children.some(child => child.contains?.(other));
    },
    querySelectorAll(selector) {
      const all = walk(node);
      if (selector === "*") return all;
      if (selector === "a, button") return all.filter(item => item.tag === "a" || item.tag === "button");
      return [];
    },
  };
  return node;
}

function walk(node) {
  for (const child of node.children) {
    if (!child.parentElement) child.parentElement = node;
  }
  return [node, ...node.children.flatMap(walk)];
}

function install(metrics, options = {}) {
  walk(metrics);
  globalThis.location = { origin: "https://cleancloudapp.com", pathname: "/store" };
  globalThis.getComputedStyle = node => ({
    visibility: "visible",
    overflow: "visible",
    overflowX: "visible",
    overflowY: "visible",
    ...(node?.style ?? {}),
  });
  globalThis.window = { innerHeight: 800, innerWidth: 1200 };
  globalThis.document = {
    title: "Goldline Laundry | CleanCloud",
    querySelector(selector) {
      if (selector === "#metricsContainer") return metrics;
      return null;
    },
    ...(options.elementFromPoint
      ? { elementFromPoint: options.elementFromPoint }
      : {}),
    ...(options.elementsFromPoint
      ? { elementsFromPoint: options.elementsFromPoint }
      : {}),
  };
}

test("reads exact overview labels and the requested period", async () => {
  const sales = element("Sales", { next: element("$3,126.32") });
  const revenue = element("Revenue", { next: element("$2,984.10") });
  const orders = element("Orders", { next: element("41") });
  const range = element("", {
    textContent: "September 1, 2026 – September 27, 2026",
    children: [],
  });
  const comparison = element("", {
    textContent: "August 1, 2026 – August 31, 2026",
    children: [],
  });
  const metrics = element("", {
    textContent: "Overview",
    children: [range, comparison, sales, revenue, orders],
  });
  install(metrics);
  const result = await readMetricsOverview({ from: "2026-09-01", to: "2026-09-27" });
  assert.equal(result.ok, true);
  assert.equal(result.value.storeLabel, "Goldline Laundry");
  assert.equal(result.value.rangeText, "September 1, 2026 – September 27, 2026");
  assert.equal(result.value.comparisonText, null);
  assert.deepEqual(result.value.fields, [
    { label: "Sales", valueText: "$3,126.32" },
    { label: "Revenue", valueText: "$2,984.10" },
    { label: "Orders", valueText: "41" },
  ]);
});

test("withholds comparison totals when their period is not directly bound", async () => {
  const metrics = element("", {
    textContent: "Overview",
    children: [
      element("", { textContent: "September 1, 2026 – September 27, 2026" }),
      element("", { textContent: "August 1, 2026 – August 31, 2026" }),
      element("Sales", { next: element("$3,126.32") }),
      element("Revenue", { next: element("$2,984.10") }),
      element("Orders", { next: element("41") }),
      element("Comparison Sales", { next: element("$2,000.00") }),
      element("Comparison Revenue", { next: element("$1,847.80") }),
      element("Comparison Orders", { next: element("33") }),
    ],
  });
  install(metrics);
  const result = await readMetricsOverview({ from: "2026-09-01", to: "2026-09-27" });
  assert.equal(result.ok, true);
  assert.equal(result.value.comparisonText, null);
  assert.equal(
    result.value.fields.some(field => field.label.startsWith("Comparison ")),
    false
  );
});

test("waits for Overview content after asynchronous panel navigation", async () => {
  const sales = element("Sales", { next: element("$3,126.32") });
  const revenue = element("Revenue", { next: element("$2,984.10") });
  const orders = element("Orders", { next: element("41") });
  const range = element("", {
    textContent: "September 1, 2026 – September 27, 2026",
    children: [],
  });
  let metrics;
  const overview = element("Overview", {
    tag: "button",
    onClick() {
      setTimeout(() => {
        metrics.children = [overview, range, sales, revenue, orders];
      }, 0);
    },
  });
  metrics = element("", {
    textContent: "Other metrics panel",
    children: [overview, element("Not Overview")],
  });
  install(metrics);
  const result = await readMetricsOverview({ from: "2026-09-01", to: "2026-09-27" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.fields, [
    { label: "Sales", valueText: "$3,126.32" },
    { label: "Revenue", valueText: "$2,984.10" },
    { label: "Orders", valueText: "41" },
  ]);
});

test("refuses a witness when required totals would be outside captureVisibleTab", async () => {
  const sales = element("Sales", { next: element("$3,126.32", { top: 900, bottom: 920 }) });
  const revenue = element("Revenue", { next: element("$2,984.10") });
  const orders = element("Orders", { next: element("41") });
  const range = element("", {
    textContent: "September 1, 2026 – September 27, 2026",
    children: [],
  });
  const metrics = element("", {
    textContent: "Overview",
    children: [range, sales, revenue, orders],
  });
  install(metrics);
  const result = await readMetricsOverview({ from: "2026-09-01", to: "2026-09-27" });
  assert.equal(result.ok, false);
  assert.match(result.error, /do not fit in the visible screenshot/);
});

test("refuses a witness when a sticky overlay occludes the proof block", async () => {
  const sales = element("Sales", { next: element("$3,126.32") });
  const revenue = element("Revenue", { next: element("$2,984.10") });
  const orders = element("Orders", { next: element("41") });
  const range = element("", {
    textContent: "September 1, 2026 – September 27, 2026",
    children: [],
  });
  const metrics = element("", {
    textContent: "Overview",
    children: [range, sales, revenue, orders],
  });
  const stickyHeader = element("sticky");
  install(metrics, { elementFromPoint: () => stickyHeader });
  const result = await readMetricsOverview({ from: "2026-09-01", to: "2026-09-27" });
  assert.equal(result.ok, false);
  assert.match(result.error, /clipped or covered/);
});

test("refuses a witness when an overflow ancestor clips required proof", async () => {
  const range = element("", {
    textContent: "September 1, 2026 – September 27, 2026",
    top: 90,
    bottom: 130,
    children: [],
  });
  const metrics = element("", {
    textContent: "Overview",
    top: 100,
    bottom: 400,
    style: { overflowY: "hidden" },
    children: [
      range,
      element("Sales", { next: element("$3,126.32") }),
      element("Revenue", { next: element("$2,984.10") }),
      element("Orders", { next: element("41") }),
    ],
  });
  install(metrics);
  const result = await readMetricsOverview({ from: "2026-09-01", to: "2026-09-27" });
  assert.equal(result.ok, false);
  assert.match(result.error, /clipped or covered/);
});

test("does not save an overview that is not on the requested dates", async () => {
  const metrics = element("", {
    textContent: "metrics",
    children: [
      element("", { textContent: "August 1, 2026 – August 31, 2026" }),
      element("Sales", { next: element("$1.00") }),
      element("Revenue", { next: element("$1.00") }),
      element("Orders", { next: element("1") }),
    ],
  });
  install(metrics);
  const result = await readMetricsOverview({ from: "2026-09-01", to: "2026-09-27" });
  assert.equal(result.ok, false);
  assert.match(result.error, /not on the requested dates/);
});

test("stops when Sales is duplicated", async () => {
  const metrics = element("", {
    textContent: "metrics",
    children: [
      element("", { textContent: "September 1, 2026 – September 27, 2026" }),
      element("Sales", { next: element("$1.00") }),
      element("Sales", { next: element("$2.00") }),
      element("Revenue", { next: element("$1.00") }),
      element("Orders", { next: element("1") }),
    ],
  });
  install(metrics);
  const result = await readMetricsOverview({ from: "2026-09-01", to: "2026-09-27" });
  assert.equal(result.ok, false);
  assert.match(result.error, /Sales appeared more than once/);
});

test("screenshot is refused unless the visible tab is the CleanCloud store", () => {
  assert.throws(
    () => assertCleanCloudScreenshotTarget({ url: "https://admin.bldg.chat/growth", active: true }),
    /not the signed-in CleanCloud store/
  );
  assert.throws(
    () => assertCleanCloudScreenshotTarget({ url: "https://cleancloudapp.com/store", active: false }),
    /not the visible tab/
  );
  assert.doesNotThrow(() =>
    assertCleanCloudScreenshotTarget({ url: "https://cleancloudapp.com/store", active: true })
  );
});

test("the screenshot permission is optional, user-granted, and target-guarded", () => {
  const sync = readFileSync(new URL("./sync.js", import.meta.url), "utf8");
  const manifest = JSON.parse(
    readFileSync(new URL("./manifest.json", import.meta.url), "utf8")
  );
  const guard = sync.indexOf("assertCleanCloudScreenshotTarget(visible)");
  const capture = sync.indexOf("captureVisibleTab");
  const helperStart = sync.indexOf("async function prepareDashboardCapturePermission");
  const helperEnd = sync.indexOf("async function recordDashboardWitness", helperStart);
  const helper = sync.slice(helperStart, helperEnd);
  const permissionCheck = helper.indexOf("chrome.permissions.contains");
  const permissionRequest = helper.indexOf("chrome.permissions.request");
  assert.ok(manifest.optional_host_permissions.includes("<all_urls>"));
  assert.ok(helperStart !== -1 && helperEnd > helperStart);
  assert.ok(permissionRequest !== -1 && permissionRequest < permissionCheck);
  assert.ok(permissionCheck !== -1);
  assert.ok(guard !== -1 && capture !== -1 && guard < capture);
  assert.match(helper, /if \(!scheduled\)/);
  assert.match(sync, /Dashboard screenshot permission is required/);
  assert.match(sync, /recordWitness/);
  assert.match(sync, /request\("reconcilePeriod"/);
  assert.ok(sync.indexOf('request("recordWitness"') < sync.indexOf('request("reconcilePeriod"'));
  assert.match(sync, /Economic reconciliation:/);
});
