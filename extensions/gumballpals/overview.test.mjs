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
    textContent: options.textContent ?? text,
    childNodes: text ? [textNode(text)] : [],
    children,
    nextElementSibling: options.next ?? null,
    getClientRects: () => (options.hidden ? [] : [1]),
    click() {
      options.onClick?.();
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
  return [node, ...node.children.flatMap(walk)];
}

function install(metrics) {
  globalThis.location = { origin: "https://cleancloudapp.com", pathname: "/store" };
  globalThis.getComputedStyle = () => ({ visibility: "visible" });
  globalThis.document = {
    title: "Goldline Laundry | CleanCloud",
    querySelector(selector) {
      if (selector === "#metricsContainer") return metrics;
      return null;
    },
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
  const permissionCheck = sync.indexOf("chrome.permissions.contains");
  const permissionRequest = sync.indexOf("chrome.permissions.request");
  assert.ok(manifest.optional_host_permissions.includes("<all_urls>"));
  assert.ok(permissionRequest !== -1 && permissionRequest < permissionCheck);
  assert.ok(permissionCheck !== -1 && permissionCheck < capture);
  assert.ok(permissionRequest < capture);
  assert.ok(guard !== -1 && capture !== -1 && guard < capture);
  assert.match(sync, /if \(scheduled\) return false/);
  assert.match(sync, /Dashboard screenshot permission is required/);
  assert.match(sync, /recordWitness/);
});
