/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import express from "express";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import {
  legacyLegacyDayforgeSaasMemberships,
  legacyLegacyDayforgeSaasTenants,
  legacyLegacyDayforgeSaasUserCredentials,
  users,
} from "../../drizzle/schema";
import {
  normalizeSaasEmail,
  normalizeSaasTenantSlug,
} from "../../shared/saasTenant";
import { getSessionCookieOptions } from "../_core/cookies";
import { isAllowedAdminOrigin } from "../_core/corsConfig";
import { sdk } from "../_core/sdk";
import { getDb } from "../db";

const DUMMY_PASSWORD_HASH = bcrypt.hashSync("legacy-dayforge-invalid-password", 12);

export function registerLegacyDayforgeSaasAuthRoute(app: express.Express) {
  app.post("/api/dayforge/auth/login", async (req, res) => {
    const origin = String(req.headers.origin ?? "");
    if (
      (origin && !isAllowedAdminOrigin(origin)) ||
      (!origin && process.env.NODE_ENV === "production")
    ) {
      return res.status(403).json({ error: "Invalid request origin" });
    }
    const slug = normalizeSaasTenantSlug(String(req.body?.slug ?? ""));
    const email = normalizeSaasEmail(String(req.body?.email ?? ""));
    const password = String(req.body?.password ?? "");
    if (
      slug.length < 3 ||
      !email ||
      password.length < 1 ||
      password.length > 128
    ) {
      return res
        .status(400)
        .json({ error: "slug, email, and password are required" });
    }
    const db = await getDb();
    if (!db)
      return res.status(503).json({ error: "Authentication is unavailable" });
    const [account] = await db
      .select({
        tenantId: legacyLegacyDayforgeSaasTenants.id,
        tenantStatus: legacyLegacyDayforgeSaasTenants.status,
        userOpenId: legacyLegacyDayforgeSaasUserCredentials.userOpenId,
        passwordHash: legacyLegacyDayforgeSaasUserCredentials.passwordHash,
        failedLoginCount: legacyLegacyDayforgeSaasUserCredentials.failedLoginCount,
        lockedUntil: legacyLegacyDayforgeSaasUserCredentials.lockedUntil,
        role: legacyLegacyDayforgeSaasMemberships.role,
        membershipActive: legacyLegacyDayforgeSaasMemberships.active,
        name: users.name,
      })
      .from(legacyLegacyDayforgeSaasTenants)
      .innerJoin(
        legacyLegacyDayforgeSaasUserCredentials,
        eq(legacyLegacyDayforgeSaasUserCredentials.tenantId, legacyLegacyDayforgeSaasTenants.id)
      )
      .innerJoin(
        legacyLegacyDayforgeSaasMemberships,
        and(
          eq(legacyLegacyDayforgeSaasMemberships.tenantId, legacyLegacyDayforgeSaasTenants.id),
          eq(
            legacyLegacyDayforgeSaasMemberships.userOpenId,
            legacyLegacyDayforgeSaasUserCredentials.userOpenId
          )
        )
      )
      .innerJoin(
        users,
        eq(users.openId, legacyLegacyDayforgeSaasUserCredentials.userOpenId)
      )
      .where(
        and(
          eq(legacyLegacyDayforgeSaasTenants.slug, slug),
          eq(legacyLegacyDayforgeSaasUserCredentials.emailNormalized, email)
        )
      )
      .limit(1);

    const genericFailure = () =>
      res.status(401).json({ error: "Invalid DayForge tenant or credentials" });
    if (!account) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return genericFailure();
    }
    if (
      !account.membershipActive ||
      account.tenantStatus === "suspended" ||
      account.tenantStatus === "canceled" ||
      (account.lockedUntil && account.lockedUntil > new Date())
    ) {
      return genericFailure();
    }
    const valid = await bcrypt.compare(password, account.passwordHash);
    if (!valid) {
      const failedLoginCount = account.failedLoginCount + 1;
      await db
        .update(legacyLegacyDayforgeSaasUserCredentials)
        .set({
          failedLoginCount,
          lockedUntil:
            failedLoginCount >= 5
              ? new Date(Date.now() + 15 * 60 * 1000)
              : null,
        })
        .where(
          and(
            eq(legacyLegacyDayforgeSaasUserCredentials.tenantId, account.tenantId),
            eq(legacyLegacyDayforgeSaasUserCredentials.userOpenId, account.userOpenId)
          )
        );
      return genericFailure();
    }
    await db
      .update(legacyLegacyDayforgeSaasUserCredentials)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(
        and(
          eq(legacyLegacyDayforgeSaasUserCredentials.tenantId, account.tenantId),
          eq(legacyLegacyDayforgeSaasUserCredentials.userOpenId, account.userOpenId)
        )
      );
    const sessionToken = await sdk.createSessionToken(account.userOpenId, {
      name: account.name || "DayForge operator",
      role: "user",
      expiresInMs: ONE_YEAR_MS,
    });
    res.cookie(COOKIE_NAME, sessionToken, {
      ...getSessionCookieOptions(req),
      maxAge: ONE_YEAR_MS,
    });
    return res.json({
      ok: true,
      tenantId: account.tenantId,
      role: account.role,
    });
  });
}
