import test from "node:test";
import assert from "node:assert/strict";
import { prepareSource } from "./browser.js";

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
