/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as { openId: string; role: string } | null }));

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { me: { invalidate: async () => {} } } }),
    system: { claire: { talk: { useMutation: () => ({ isPending: false, mutateAsync: async () => ({ reply: "" }) }) } } },
  },
}));

import { ClaireComposer } from "./ClaireComposer";

function render() {
  return renderToStaticMarkup(createElement(ClaireComposer, { variant: "sheet" }));
}

describe("ClaireComposer sign-in", () => {
  beforeEach(() => {
    auth.user = null;
  });

  it("offers the JOYSTICK sign-in to a shared driver password session instead of a composer", () => {
    auth.user = { openId: "driver-primary", role: "driver" };
    const html = render();
    expect(html).toContain('data-testid="claire-composer-signin"');
    expect(html).toContain('type="email"');
    expect(html).not.toContain('data-testid="claire-composer-input"');
  });

  it("shows the composer to a member", () => {
    auth.user = { openId: "dayforge:abc", role: "driver" };
    const html = render();
    expect(html).toContain('data-testid="claire-composer-input"');
    expect(html).not.toContain('data-testid="claire-composer-signin"');
  });

  it("shows the composer to the platform admin", () => {
    auth.user = { openId: "adam-admin", role: "admin" };
    expect(render()).toContain('data-testid="claire-composer-input"');
  });
});
