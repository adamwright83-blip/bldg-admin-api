/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import express from "express";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import {
  legacyDayforgeSaasMemberships,
  legacyDayforgeSaasTenants,
  legacyDayforgeSaasUserCredentials,
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
    const rawSlug = String(req.body?.slug ?? "").trim();
    const slug = rawSlug ? normalizeSaasTenantSlug(rawSlug) : "";
    const email = normalizeSaasEmail(String(req.body?.email ?? ""));
    const password = String(req.body?.password ?? "");
    if (!email || password.length < 1 || password.length > 128) {
      return res.status(400).json({ error: "email and password are required" });
    }
    if (rawSlug && slug.length < 3) {
      return res.status(400).json({ error: "Invalid workspace" });
    }
    const db = await getDb();
    if (!db)
      return res.status(503).json({ error: "Authentication is unavailable" });
    const accounts = await db
      .select({
        tenantId: legacyDayforgeSaasTenants.id,
        tenantStatus: legacyDayforgeSaasTenants.status,
        userOpenId: legacyDayforgeSaasUserCredentials.userOpenId,
        passwordHash: legacyDayforgeSaasUserCredentials.passwordHash,
        failedLoginCount: legacyDayforgeSaasUserCredentials.failedLoginCount,
        lockedUntil: legacyDayforgeSaasUserCredentials.lockedUntil,
        role: legacyDayforgeSaasMemberships.role,
        membershipActive: legacyDayforgeSaasMemberships.active,
        name: users.name,
      })
      .from(legacyDayforgeSaasUserCredentials)
      .innerJoin(
        legacyDayforgeSaasTenants,
        eq(legacyDayforgeSaasTenants.id, legacyDayforgeSaasUserCredentials.tenantId)
      )
      .innerJoin(
        legacyDayforgeSaasMemberships,
        and(
          eq(legacyDayforgeSaasMemberships.tenantId, legacyDayforgeSaasUserCredentials.tenantId),
          eq(
            legacyDayforgeSaasMemberships.userOpenId,
            legacyDayforgeSaasUserCredentials.userOpenId
          )
        )
      )
      .innerJoin(
        users,
        eq(users.openId, legacyDayforgeSaasUserCredentials.userOpenId)
      )
      .where(
        rawSlug
          ? and(
              eq(legacyDayforgeSaasTenants.slug, slug),
              eq(legacyDayforgeSaasUserCredentials.emailNormalized, email)
            )
          : eq(legacyDayforgeSaasUserCredentials.emailNormalized, email)
      );

    const genericFailure = () =>
      res.status(401).json({ error: "Invalid email or password" });
    if (accounts.length === 0) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return genericFailure();
    }

    const eligibleAccounts = accounts.filter(
      candidate =>
        candidate.membershipActive &&
        candidate.tenantStatus !== "suspended" &&
        candidate.tenantStatus !== "canceled" &&
        (!candidate.lockedUntil || candidate.lockedUntil <= new Date())
    );
    const passwordMatches = await Promise.all(
      eligibleAccounts.map(async candidate => ({
        candidate,
        valid: await bcrypt.compare(password, candidate.passwordHash),
      }))
    );
    const matches = passwordMatches
      .filter(result => result.valid)
      .map(result => result.candidate);

    if (matches.length === 0) {
      const failureTarget = accounts[0];
      if (failureTarget) {
        const failedLoginCount = failureTarget.failedLoginCount + 1;
        await db
          .update(legacyDayforgeSaasUserCredentials)
          .set({
            failedLoginCount,
            lockedUntil:
              failedLoginCount >= 5
                ? new Date(Date.now() + 15 * 60 * 1000)
                : null,
          })
          .where(
            and(
              eq(
                legacyDayforgeSaasUserCredentials.tenantId,
                failureTarget.tenantId
              ),
              eq(
                legacyDayforgeSaasUserCredentials.userOpenId,
                failureTarget.userOpenId
              )
            )
          );
      }
      return genericFailure();
    }

    if (matches.length > 1) {
      return res.status(409).json({
        error: "Multiple accounts use this email. Contact support.",
      });
    }

    const account = matches[0]!;

    await db
      .update(legacyDayforgeSaasUserCredentials)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(
        and(
          eq(legacyDayforgeSaasUserCredentials.tenantId, account.tenantId),
          eq(legacyDayforgeSaasUserCredentials.userOpenId, account.userOpenId)
        )
      );
    const sessionToken = await sdk.createSessionToken(account.userOpenId, {
      name: account.name || "JOYSTICK operator",
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
