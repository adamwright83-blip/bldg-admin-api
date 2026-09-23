import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ErrorBoundary from "./ErrorBoundary";

const SECRET = "pick up the blue shirts";
const PHONE = "+13105550199";
const EMAIL = "ada@example.com";
const PATH = "/Users/adam/secret.ts";
const BASIC = "dXNlcjpwYXNz";

function mount(children: ReactNode) {
  const boundary = new ErrorBoundary({ children });
  boundary.setState = partial => {
    const update = typeof partial === "function" ? partial(boundary.state, boundary.props) : partial;
    boundary.state = { ...boundary.state, ...(update ?? {}) };
  };
  return boundary;
}

function crash(message = `smsBody: ${SECRET} ${PHONE} ${EMAIL}`): Error {
  const error = new Error(message);
  error.stack = `${error.message}\n    at Secret (${PATH}:4:2)\nBasic ${BASIC}`;
  return error;
}

describe("ErrorBoundary customer visibility", () => {
  it("renders the notice and posts a redacted report", async () => {
    const logged: unknown[][] = [];
    const fetched: Array<{ url: string; init: RequestInit }> = [];
    const originalError = console.error;
    const originalFetch = globalThis.fetch;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      fetched.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    try {
      const boundary = mount(createElement("span", null, "CHILD_MARKER"));
      const error = crash();
      boundary.setState(ErrorBoundary.getDerivedStateFromError());
      boundary.componentDidCatch(error);
      const html = renderToStaticMarkup(boundary.render());

      expect(html).toContain("Something went wrong.");
      expect(html).toContain("Reload to try again.");
      expect(html).toContain("Reload Page");
      expect(html).toContain("Reference ");
      expect(html).not.toContain("CHILD_MARKER");
      expect(html).not.toContain(SECRET);
      expect(html).not.toContain(PHONE);
      expect(html).not.toContain(EMAIL);
      expect(html).not.toContain(PATH);
      expect(html).not.toContain(BASIC);
      expect(html).not.toContain("secret.ts");

      expect(fetched).toHaveLength(1);
      expect(fetched[0].url).toBe("/api/client-fatal");
      expect(fetched[0].init.credentials).toBe("omit");
      expect(fetched[0].init.method).toBe("POST");
      const posted = String(fetched[0].init.body);
      expect(posted).not.toContain(SECRET);
      expect(posted).not.toContain(PHONE);
      expect(posted).not.toContain(EMAIL);
      expect(posted).not.toContain(BASIC);
      const record = JSON.parse(posted) as { correlationId: string };
      expect(html).toContain(record.correlationId);
      expect(JSON.stringify(logged)).not.toContain(SECRET);
      expect(JSON.stringify(logged)).not.toContain(PHONE);
    } finally {
      console.error = originalError;
      globalThis.fetch = originalFetch;
    }
  });

  it("issues a new reference when the boundary catches again and survives a failed post", async () => {
    const originalError = console.error;
    const originalFetch = globalThis.fetch;
    console.error = () => {};
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    try {
      const boundary = mount(createElement("span", null, "CHILD_MARKER"));
      boundary.setState(ErrorBoundary.getDerivedStateFromError());
      expect(() => boundary.componentDidCatch(crash())).not.toThrow();
      const first = renderToStaticMarkup(boundary.render());
      expect(() => boundary.componentDidCatch(crash("second +13105550199"))).not.toThrow();
      const second = renderToStaticMarkup(boundary.render());
      const id = /Reference ([0-9a-f-]{36})/i;
      expect(first.match(id)?.[1]).toBeTruthy();
      expect(second.match(id)?.[1]).not.toBe(first.match(id)?.[1]);
      expect(second).not.toContain("13105550199");
    } finally {
      console.error = originalError;
      globalThis.fetch = originalFetch;
    }
  });

  it("shows the notice without a reference before the report is filed", () => {
    const boundary = mount(createElement("span", null, "CHILD_MARKER"));
    boundary.setState(ErrorBoundary.getDerivedStateFromError());
    const html = renderToStaticMarkup(boundary.render());
    expect(html).toContain("Something went wrong.");
    expect(html).toContain("Reload to try again.");
    expect(html).not.toContain("Reference ");
    expect(html).not.toContain("CHILD_MARKER");
    expect(JSON.stringify(boundary.state)).not.toContain(SECRET);
  });

  it("leaves the child in place until a render error is caught", () => {
    const boundary = mount(createElement("span", null, "CHILD_MARKER"));
    const html = renderToStaticMarkup(boundary.render());
    expect(html).toContain("CHILD_MARKER");
    expect(html).not.toContain("Something went wrong.");
  });
});
