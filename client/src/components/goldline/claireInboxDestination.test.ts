import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { role: string; openId: string } | null,
  items: [] as Array<Record<string, unknown>>,
  markRead: vi.fn(async () => undefined),
}));

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ system: { claire: { analysisInbox: { invalidate: async () => undefined } } } }),
    system: {
      claire: {
        analysisInbox: { useQuery: () => ({ data: state.items }) },
        markAnalysisNotificationRead: { useMutation: () => ({ mutateAsync: state.markRead }) },
      },
    },
  },
}));
// Render the portal content in place so the server renderer can see it.
vi.mock("react-dom", async importOriginal => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (node: unknown) => node,
}));

import { claireInboxDestinationOpenable } from "./claireInboxDestination";
import { ClaireAnalysisInbox } from "./ClaireAnalysisInbox";

const CALL = "/claire/calls/7f1c2a9e-0000-4000-8000-000000000001";
const GAP = "/goldline/capability-gaps/7f1c2a9e-0000-4000-8000-000000000002";

describe("Claire inbox destinations", () => {
  it("is never a link a tenant member cannot open on the customer host", () => {
    for (const href of [CALL, GAP]) {
      expect(claireInboxDestinationOpenable({ href, hostname: "app.gojoystick.com", role: "user" })).toBe(false);
    }
    expect(claireInboxDestinationOpenable({ href: "/claire", hostname: "app.gojoystick.com", role: "user" })).toBe(true);
  });

  it("follows the tenant-member redirect on the admin and default hosts", () => {
    for (const hostname of ["admin.bldg.chat", "admin.gojoystick.com", "bldg-admin-api-production.up.railway.app", "localhost"]) {
      expect(claireInboxDestinationOpenable({ href: CALL, hostname, role: "user" })).toBe(false);
      expect(claireInboxDestinationOpenable({ href: GAP, hostname, role: "user" })).toBe(false);
    }
  });

  it("keeps the driver host's analysis and capability-gap pages reachable for members", () => {
    for (const hostname of ["driver.bldg.chat", "driver.gojoystick.com"]) {
      expect(claireInboxDestinationOpenable({ href: CALL, hostname, role: "user" })).toBe(true);
      expect(claireInboxDestinationOpenable({ href: GAP, hostname, role: "user" })).toBe(true);
    }
  });

  it("leaves platform admins unchanged", () => {
    for (const hostname of ["admin.bldg.chat", "driver.bldg.chat", "localhost"]) {
      expect(claireInboxDestinationOpenable({ href: CALL, hostname, role: "admin" })).toBe(true);
    }
  });
});

describe("ClaireAnalysisInbox", () => {
  beforeEach(() => {
    state.items = [
      { id: "n1", title: "CLAIRE CALL ANALYSIS READY", body: "The Monday call went well.", ctaLabel: "VIEW ANALYSIS", href: CALL },
    ];
    vi.stubGlobal("document", {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function render(hostname: string) {
    const location = { hostname, pathname: "/play", search: "", hash: "" };
    vi.stubGlobal("window", { location });
    // wouter's Link reads the bare `location` global.
    vi.stubGlobal("location", location);
    return renderToStaticMarkup(createElement(ClaireAnalysisInbox));
  }

  it("shows a tenant member the notice without a link that would consume it", () => {
    state.user = { role: "user", openId: "tenant-operator" };
    const html = render("app.gojoystick.com");
    expect(html).toContain("The Monday call went well.");
    expect(html).toContain("Dismiss CLAIRE CALL ANALYSIS READY");
    expect(html).not.toContain(`href="${CALL}"`);
    expect(html).not.toContain("VIEW ANALYSIS</a>");
  });

  it("keeps the link for a platform admin and for a member on the driver host", () => {
    state.user = { role: "admin", openId: "platform-admin" };
    expect(render("admin.bldg.chat")).toContain(`href="${CALL}"`);
    state.user = { role: "user", openId: "tenant-operator" };
    expect(render("driver.bldg.chat")).toContain(`href="${CALL}"`);
  });
});
