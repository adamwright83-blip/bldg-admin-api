import React, { createElement } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";

const islands = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
vi.mock("@/components/admin/control-room/LanternCityIslands/LanternCityIslands", () => ({
  default: (props: Record<string, unknown>) => {
    islands.props.push(props);
    return null;
  },
}));

import JoystickWorld from "./JoystickWorld";

/** Renders the world with its lazy Lantern City board resolved (prerender waits for Suspense). */
async function renderWorld(): Promise<string> {
  const { prelude } = await prerenderToNodeStream(
    createElement(Router, { ssrPath: "/growth/lantern-city" }, createElement(JoystickWorld))
  );
  let html = "";
  for await (const chunk of prelude) html += chunk.toString();
  return html;
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  islands.props = [];
});

describe("tenant JOYSTICK world", () => {
  it("links the tenant to Claire's desk from the top actions", async () => {
    const html = await renderWorld();
    const actions = html.slice(html.indexOf('class="cc-top-actions"'));
    expect(actions).toMatch(/<a href="\/claire" class="cc-button">Claire<\/a>/);
    // the existing top actions stay where they were
    expect(actions).toContain('href="/product/customers"');
    expect(actions).toContain('href="/product/money"');
    expect(actions).toContain('href="/billing"');
  });

  it("turns off the platform-admin-only places on the tenant's island board", async () => {
    await renderWorld();
    expect(islands.props.length).toBeGreaterThan(0);
    for (const props of islands.props) {
      expect(props.platformScenes).toBe(false);
      expect(props.showUtilityDock).toBe(false);
    }
  });
});
