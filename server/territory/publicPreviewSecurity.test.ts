import { describe, expect, it } from "vitest";
import {
  createPublicPreviewToken,
  hashPublicPreviewFingerprint,
  hashPublicPreviewToken,
  hashesMatch,
  readPublicPreviewBearerToken,
  resolvePublicPreviewClientIp,
} from "./publicPreviewSecurity";

const SECRET = "a".repeat(64);

describe("public territory preview security", () => {
  it("issues opaque tokens and stores only a deterministic keyed digest", () => {
    const first = createPublicPreviewToken(SECRET);
    const second = createPublicPreviewToken(SECRET);
    expect(first.token).toMatch(/^dfpv_[A-Za-z0-9_-]{40,}$/);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(hashPublicPreviewToken(first.token, SECRET));
    expect(first.tokenHash).not.toContain(first.token);
    expect(hashesMatch(first.tokenHash, hashPublicPreviewToken(first.token, SECRET))).toBe(true);
  });

  it("uses keyed, normalized IP fingerprints", () => {
    expect(hashPublicPreviewFingerprint(" 203.0.113.9 ", SECRET)).toBe(
      hashPublicPreviewFingerprint("203.0.113.9", SECRET)
    );
    expect(hashPublicPreviewFingerprint("203.0.113.9", SECRET)).not.toBe(
      hashPublicPreviewFingerprint("203.0.113.10", SECRET)
    );
  });

  it("does not trust a forwarded address when Express trust proxy is disabled", () => {
    const req = {
      app: { get: () => false },
      ip: "198.51.100.22",
      socket: { remoteAddress: "127.0.0.1" },
    };
    expect(resolvePublicPreviewClientIp(req as never)).toBe("127.0.0.1");
  });

  it("uses Express' validated req.ip only after trust proxy is configured", () => {
    const req = {
      app: { get: () => 1 },
      ip: "198.51.100.22",
      socket: { remoteAddress: "127.0.0.1" },
    };
    expect(resolvePublicPreviewClientIp(req as never)).toBe("198.51.100.22");
  });

  it("accepts explicit or Authorization bearer preview tokens", () => {
    expect(
      readPublicPreviewBearerToken({
        explicitToken: "explicit",
        authorization: "Bearer ignored",
      })
    ).toBe("explicit");
    expect(
      readPublicPreviewBearerToken({ authorization: "Bearer header-token" })
    ).toBe("header-token");
    expect(readPublicPreviewBearerToken({ authorization: "Basic no" })).toBeNull();
  });
});
