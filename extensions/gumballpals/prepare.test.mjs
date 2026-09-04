import test from "node:test";
import assert from "node:assert/strict";
import { prepareSource } from "./browser.js";
import { execFileSync } from "node:child_process";

test("preserves user-confirmed date selection; no display confirmation wait", () => {
  const baseline = execFileSync("git", ["show", "e3bf592:extensions/gumballpals/browser.js"], { encoding: "utf8" });
  const selection = source => source.slice(source.indexOf("const dateInput ="), source.indexOf("await pickDate(range.to);") + "await pickDate(range.to);".length).replaceAll("0.1.6", "0.1.2");
  const current = prepareSource.toString();
  assert.ok(selection(current).length > 1000);
  assert.equal(selection(current), selection(baseline));
  const after = current.slice(current.indexOf("await pickDate(range.to);") + "await pickDate(range.to);".length);
  assert.equal(after.includes("await wait"), false);
  assert.match(after, /ok: true/);
});

test("report navigation can replace the metrics root before controls load", async () => {
  const keys = ["location", "document", "getComputedStyle", "MouseEvent"];
  const previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  let root;
  const live = {
    querySelector(selector) {
      if (selector === "#submit_export_button") return {};
      if (selector === 'input[placeholder="Export Type"]') return {
        closest: () => ({ querySelector: () => ({ dispatchEvent(event) {
          assert.equal(event.type, "mousedown");
          assert.equal(event.bubbles, true);
          assert.equal(event.cancelable, true);
          throw new Error("reached live report picker");
        } }) }),
      };
      return null;
    },
  };
  root = {
    getClientRects: () => [1],
    querySelector() { throw new Error("stale metrics root used"); },
    querySelectorAll: () => [{ getClientRects: () => [1], textContent: "Data Export", click() { root = live; } }],
  };
  try {
    globalThis.location = { origin: "https://cleancloudapp.com", pathname: "/store" };
    globalThis.document = { title: "Example | CleanCloud", querySelector: () => root };
    globalThis.getComputedStyle = () => ({ visibility: "visible" });
    globalThis.MouseEvent = class { constructor(type, options) { this.type = type; Object.assign(this, options); } };
    const result = await prepareSource({ from: "2026-08-15", to: "2026-09-03" });
    assert.equal(result.error, "reached live report picker");
  } finally {
    keys.forEach((key, i) => previous[i] ? Object.defineProperty(globalThis, key, previous[i]) : delete globalThis[key]);
  }
});
