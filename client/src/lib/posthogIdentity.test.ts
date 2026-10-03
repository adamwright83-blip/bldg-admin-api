import { describe, expect, it } from "vitest";
import { decidePosthogIdentity } from "./posthogIdentity";

const operator = {
  openId: "operator-1",
  email: "ada@example.com",
  name: "Ada",
  role: "admin",
  tenantId: "goldline",
};

describe("decidePosthogIdentity", () => {
  it("stays anonymous while auth is unresolved and before login", () => {
    expect(
      decidePosthogIdentity({
        loading: true,
        visualTest: false,
        user: null,
        identifiedOpenId: null,
      })
    ).toEqual({ type: "noop" });
    expect(
      decidePosthogIdentity({
        loading: false,
        visualTest: false,
        user: null,
        identifiedOpenId: null,
      })
    ).toEqual({ type: "noop" });
  });

  it("identifies once per openId and does not repeat it", () => {
    const first = decidePosthogIdentity({
      loading: false,
      visualTest: false,
      user: operator,
      identifiedOpenId: null,
    });
    expect(first).toMatchObject({ type: "identify", openId: "operator-1" });
    expect(
      decidePosthogIdentity({
        loading: false,
        visualTest: false,
        user: operator,
        identifiedOpenId: "operator-1",
      })
    ).toEqual({ type: "noop" });
  });

  it("resets before identifying a different operator", () => {
    expect(
      decidePosthogIdentity({
        loading: false,
        visualTest: false,
        user: operator,
        identifiedOpenId: "operator-0",
      }).type
    ).toBe("reset-then-identify");
  });

  it("resets on logout and never identifies the visual-test user", () => {
    expect(
      decidePosthogIdentity({
        loading: false,
        visualTest: false,
        user: null,
        identifiedOpenId: "operator-1",
      })
    ).toEqual({ type: "reset" });
    expect(
      decidePosthogIdentity({
        loading: false,
        visualTest: true,
        user: { openId: "visual-test", name: "Admin Preview", email: null, role: "admin" },
        identifiedOpenId: null,
      })
    ).toEqual({ type: "noop" });
    expect(
      decidePosthogIdentity({
        loading: false,
        visualTest: false,
        user: { openId: "visual-test", name: "Admin Preview", email: null, role: "admin" },
        identifiedOpenId: "operator-1",
      })
    ).toEqual({ type: "reset" });
  });
});
