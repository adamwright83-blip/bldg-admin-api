/* LEGACY DAYFORGE COMPATIBILITY: retained historical literals only; not current architecture. */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

const authState = vi.hoisted(() => ({
  user: null as { role?: string; openId?: string } | null,
  loading: false,
  isAuthenticated: false,
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => authState,
}));

const kingdomState = vi.hoisted(() => ({
  data: [] as Array<{ kingdomId: string; lanternCityStatus: string }>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { me: { invalidate: async () => undefined } } }),
    system: {
      saas: {
        me: {
          useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
        },
      },
      goldlineKingdoms: {
        list: {
          useQuery: () => ({ data: kingdomState.data, isLoading: false, isError: false }),
        },
      },
    },
  },
}));

vi.mock("@/pages/GoldlineChapterHost", async () => {
  const { createElement: h } = await import("react");
  return { default: () => h("p", null, "CHAPTER HOST MOUNTED") };
});

import { CustomerHostApp } from "./CustomerHostApp";
import { JoystickApiHostRefused, WwwGojoystickRedirect } from "./JoystickHostFrames";
import { PreservedLaundryHost } from "./PreservedLaundryHost";
import { TenantProvider } from "@/hooks/useTenant";
import JoystickLanding from "@/pages/JoystickLanding";

function setLocation(url: string) {
  const parsed = new URL(url);
  vi.stubGlobal("window", {
    location: {
      hostname: parsed.hostname,
      host: parsed.host,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
      href: parsed.href,
      replace: vi.fn(),
      assign: vi.fn(),
    },
    matchMedia: () => ({ matches: false, addListener() {}, removeListener() {} }),
  });
}

describe("JOYSTICK host render contract", () => {
  beforeEach(() => {
    authState.user = null;
    authState.loading = false;
    authState.isAuthenticated = false;
  });

  it("renders the approved marketing page on the apex", () => {
    setLocation("https://gojoystick.com/");
    const html = renderToStaticMarkup(createElement(JoystickLanding));
    expect(html).toContain('data-testid="joystick-marketing"');
    expect(html).not.toContain("Admin Sign In");
    expect(html).not.toContain("Loading your Laundry Butler account");
  });

  it("renders the customer sign-in, not the admin shell, on app.gojoystick.com", () => {
    setLocation("https://app.gojoystick.com/");
    const html = renderToStaticMarkup(createElement(CustomerHostApp));
    expect(html).toContain("Sign in");
    expect(html).toContain("JOYSTICK");
    expect(html).not.toContain("Admin Sign In");
    expect(html).not.toContain("Driver Sign In");
    expect(html).not.toContain('data-testid="joystick-marketing"');
  });

  it("renders player, Claire, and Lantern City entrances as customer sign-in, not the admin shell", () => {
    for (const path of ["/play", "/claire", "/growth/lantern-city"]) {
      setLocation(`https://app.gojoystick.com${path}`);
      const html = renderToStaticMarkup(createElement(CustomerHostApp));
      expect(html).toContain("Sign in");
      expect(html).not.toContain("Admin Sign In");
      expect(html).not.toContain("does not serve the control room");
    }
  });

  it("applies the admin host's kingdom-unlock check to the customer-host chapter", async () => {
    setLocation("https://app.gojoystick.com/goldline-chapter");
    authState.user = { role: "user", openId: "tenant-operator" };
    authState.isAuthenticated = true;
    kingdomState.data = [{ kingdomId: "kingdom-2-the-last-valet", lanternCityStatus: "available" }];
    // The first render starts the lazy chapter host; once resolved it renders synchronously.
    let unlocked = renderToStaticMarkup(createElement(CustomerHostApp));
    for (let attempt = 0; attempt < 50 && !unlocked.includes("CHAPTER HOST MOUNTED"); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
      unlocked = renderToStaticMarkup(createElement(CustomerHostApp));
    }
    expect(unlocked).toContain("CHAPTER HOST MOUNTED");

    kingdomState.data = [{ kingdomId: "kingdom-2-the-last-valet", lanternCityStatus: "locked" }];
    expect(renderToStaticMarkup(createElement(CustomerHostApp))).not.toContain("CHAPTER HOST MOUNTED");
    kingdomState.data = [];
    expect(renderToStaticMarkup(createElement(CustomerHostApp))).not.toContain("CHAPTER HOST MOUNTED");
  });

  it("refuses the control room on the customer host", () => {
    setLocation("https://app.gojoystick.com/home");
    const home = renderToStaticMarkup(createElement(CustomerHostApp));
    expect(home).toContain("does not serve the control room");
    expect(home).not.toContain("Admin Sign In");

    setLocation("https://app.gojoystick.com/admin");
    authState.user = { role: "admin", openId: "admin-owner" };
    authState.isAuthenticated = true;
    const admin = renderToStaticMarkup(createElement(CustomerHostApp));
    expect(admin).toContain("does not serve the control room");
    expect(admin).not.toContain("Admin Sign In");
  });

  it("keeps laundry hosts off the JOYSTICK marketing and admin shells", () => {
    setLocation("https://laundrybutler.bldg.chat/");
    // App mounts this host inside TenantProvider. The public homepage reads the brand from that context.
    const butler = renderToStaticMarkup(
      createElement(TenantProvider, null, createElement(PreservedLaundryHost))
    );
    expect(butler).toContain("Laundry Butler");
    expect(butler).not.toContain('data-testid="joystick-marketing"');
    expect(butler).not.toContain("Admin Sign In");
    expect(butler).not.toContain("does not serve the control room");
  });

  it("names the API host as an API and redirects www without rendering marketing", () => {
    const api = renderToStaticMarkup(createElement(JoystickApiHostRefused));
    expect(api).toContain("JOYSTICK API");
    expect(api).not.toContain('data-testid="joystick-marketing"');
    expect(api).not.toContain("Admin Sign In");

    setLocation("https://www.gojoystick.com/play?x=1");
    const www = renderToStaticMarkup(createElement(WwwGojoystickRedirect));
    expect(www).toContain("Redirecting to gojoystick.com");
    expect(www).not.toContain('data-testid="joystick-marketing"');
  });
});
