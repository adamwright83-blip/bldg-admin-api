import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, count, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  dayforgeSaasBillingEvents,
  dayforgeSaasBillingPlans,
  dayforgeSaasCheckoutSessions,
  dayforgeSaasEntitlements,
  dayforgeSaasExternalCustomers,
  dayforgeSaasExternalOrders,
  dayforgeSaasMemberships,
  dayforgeSaasImportConnections,
  dayforgeSaasImportRuns,
  dayforgeSaasOnboardingSessions,
  dayforgeSaasSubscriptions,
  dayforgeSaasTenantInvites,
  dayforgeSaasTenantLocations,
  dayforgeSaasTenantServices,
  dayforgeSaasTenants,
  dayforgeSaasUserCredentials,
  tenantCommercialProposalProfiles,
  territoryOperatorProfiles,
  users,
} from "../../drizzle/schema";
import {
  DAYFORGE_ENTITLEMENTS,
  normalizeSaasEmail,
  normalizeSaasTenantSlug,
  onboardingConfigurationIsOperational,
  subscriptionAllowsDayforgeAccess,
  type DayforgeEntitlement,
  type SaasSubscriptionStatus,
  type SaasTenantMemberRole,
  type SaasTenantOnboardingConfiguration,
} from "../../shared/saasTenant";
import type {
  NormalizedTenantCustomer,
  NormalizedTenantOrder,
} from "../../shared/tenantImports";
import { getDb } from "../db";

export type PublicSaasPlan = {
  planKey: string;
  displayName: string;
  trialDays: number;
  foundingPlan: boolean;
};

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function affectedRows(result: unknown): number {
  return Number(
    (result as { [0]?: { affectedRows?: number } })[0]?.affectedRows ?? 0
  );
}

function duplicateKey(error: unknown): boolean {
  const candidate = error as { code?: string; errno?: number };
  return candidate?.code === "ER_DUP_ENTRY" || candidate?.errno === 1062;
}

function allEntitlementsFromEnv(): DayforgeEntitlement[] {
  const requested = (process.env.DAYFORGE_STRIPE_ENTITLEMENTS ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  const values = requested.length > 0 ? requested : [...DAYFORGE_ENTITLEMENTS];
  return values.filter((value): value is DayforgeEntitlement =>
    DAYFORGE_ENTITLEMENTS.includes(value as DayforgeEntitlement)
  );
}

export async function syncConfiguredSaasPlan(): Promise<void> {
  const priceId = process.env.DAYFORGE_STRIPE_PRICE_ID?.trim();
  if (!priceId) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const planKey = process.env.DAYFORGE_STRIPE_PLAN_KEY?.trim() || "dayforge";
  const foundingPlan = process.env.DAYFORGE_STRIPE_FOUNDING_PLAN === "true";
  const maxSubscriptionsRaw = Number(
    process.env.DAYFORGE_STRIPE_MAX_SUBSCRIPTIONS ?? ""
  );
  const rules = {
    configuredFromEnvironment: true,
    foundingAvailability:
      process.env.DAYFORGE_STRIPE_FOUNDING_AVAILABILITY ?? null,
  };
  await db
    .insert(dayforgeSaasBillingPlans)
    .values({
      planKey,
      displayName: process.env.DAYFORGE_STRIPE_PLAN_NAME?.trim() || "DayForge",
      stripePriceId: priceId,
      stripeProductId: process.env.DAYFORGE_STRIPE_PRODUCT_ID?.trim() || null,
      trialDays: Math.max(
        0,
        Number(process.env.DAYFORGE_STRIPE_TRIAL_DAYS ?? "0") || 0
      ),
      foundingPlan,
      maxSubscriptions:
        Number.isInteger(maxSubscriptionsRaw) && maxSubscriptionsRaw > 0
          ? maxSubscriptionsRaw
          : null,
      rulesJson: rules,
      entitlementsJson: allEntitlementsFromEnv(),
      active: true,
    })
    .onDuplicateKeyUpdate({
      set: {
        displayName:
          process.env.DAYFORGE_STRIPE_PLAN_NAME?.trim() || "DayForge",
        stripePriceId: priceId,
        stripeProductId: process.env.DAYFORGE_STRIPE_PRODUCT_ID?.trim() || null,
        trialDays: Math.max(
          0,
          Number(process.env.DAYFORGE_STRIPE_TRIAL_DAYS ?? "0") || 0
        ),
        foundingPlan,
        maxSubscriptions:
          Number.isInteger(maxSubscriptionsRaw) && maxSubscriptionsRaw > 0
            ? maxSubscriptionsRaw
            : null,
        rulesJson: rules,
        entitlementsJson: allEntitlementsFromEnv(),
        active: true,
      },
    });
}

export async function listPublicSaasPlans(): Promise<PublicSaasPlan[]> {
  await syncConfiguredSaasPlan();
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const rows = await db
    .select()
    .from(dayforgeSaasBillingPlans)
    .where(eq(dayforgeSaasBillingPlans.active, true));
  return rows
    .filter(
      row =>
        (!row.availabilityStartsAt || row.availabilityStartsAt <= now) &&
        (!row.availabilityEndsAt || row.availabilityEndsAt > now)
    )
    .map(row => ({
      planKey: row.planKey,
      displayName: row.displayName,
      trialDays: row.trialDays,
      foundingPlan: row.foundingPlan,
    }));
}

export async function getActiveSaasPlan(planKey: string) {
  await syncConfiguredSaasPlan();
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [plan] = await db
    .select()
    .from(dayforgeSaasBillingPlans)
    .where(
      and(
        eq(dayforgeSaasBillingPlans.planKey, planKey),
        eq(dayforgeSaasBillingPlans.active, true)
      )
    )
    .limit(1);
  if (!plan) throw new Error("The selected DayForge plan is unavailable");
  return plan;
}

export async function assertSaasPlanCanCheckout(planKey: string) {
  const plan = await getActiveSaasPlan(planKey);
  const now = new Date();
  if (
    (plan.availabilityStartsAt && plan.availabilityStartsAt > now) ||
    (plan.availabilityEndsAt && plan.availabilityEndsAt <= now)
  ) {
    throw new Error(
      "The selected DayForge plan is outside its availability window"
    );
  }
  if (plan.maxSubscriptions) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const [row] = await db
      .select({ total: count() })
      .from(dayforgeSaasSubscriptions)
      .where(eq(dayforgeSaasSubscriptions.planKey, plan.planKey));
    if (Number(row?.total ?? 0) >= plan.maxSubscriptions) {
      throw new Error("The selected DayForge plan has reached capacity");
    }
  }
  return plan;
}

export async function startSaasOnboarding(input: {
  businessName: string;
  slug: string;
  ownerEmail: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db
    .select()
    .from(dayforgeSaasOnboardingSessions)
    .where(eq(dayforgeSaasOnboardingSessions.startRequestId, input.requestId))
    .limit(1);
  if (existing[0]) {
    return { session: existing[0], resumeToken: null as string | null };
  }
  const sessionId = randomUUID();
  const resumeToken = randomBytes(32).toString("base64url");
  const slug = normalizeSaasTenantSlug(input.slug);
  if (slug.length < 3) throw new Error("A valid tenant slug is required");
  try {
    await db.insert(dayforgeSaasOnboardingSessions).values({
      id: sessionId,
      resumeTokenHash: hashSecret(resumeToken),
      businessName: input.businessName.trim(),
      slug,
      ownerEmail: normalizeSaasEmail(input.ownerEmail),
      currentStep: "business",
      version: 1,
      startRequestId: input.requestId,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    });
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    const [raceWinner] = await db
      .select()
      .from(dayforgeSaasOnboardingSessions)
      .where(eq(dayforgeSaasOnboardingSessions.startRequestId, input.requestId))
      .limit(1);
    if (raceWinner) return { session: raceWinner, resumeToken: null };
    throw error;
  }
  const [session] = await db
    .select()
    .from(dayforgeSaasOnboardingSessions)
    .where(eq(dayforgeSaasOnboardingSessions.id, sessionId))
    .limit(1);
  return { session, resumeToken };
}

export async function requireOnboardingSession(input: {
  sessionId: string;
  resumeToken: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [session] = await db
    .select()
    .from(dayforgeSaasOnboardingSessions)
    .where(
      and(
        eq(dayforgeSaasOnboardingSessions.id, input.sessionId),
        eq(
          dayforgeSaasOnboardingSessions.resumeTokenHash,
          hashSecret(input.resumeToken)
        )
      )
    )
    .limit(1);
  if (
    !session ||
    session.expiresAt <= new Date() ||
    session.status === "expired"
  ) {
    throw new Error("Onboarding session is invalid or expired");
  }
  return session;
}

export async function saveOnboardingConfiguration(input: {
  sessionId: string;
  resumeToken: string;
  expectedVersion: number;
  currentStep: string;
  configuration: SaasTenantOnboardingConfiguration;
}) {
  const session = await requireOnboardingSession(input);
  if (!onboardingConfigurationIsOperational(input.configuration)) {
    throw new Error(
      "Store, capacity, service, radius, and turnaround configuration is incomplete"
    );
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .update(dayforgeSaasOnboardingSessions)
    .set({
      businessName: input.configuration.businessName,
      slug: normalizeSaasTenantSlug(input.configuration.slug),
      ownerEmail: normalizeSaasEmail(input.configuration.contactEmail),
      currentStep: input.currentStep,
      configurationJson: input.configuration,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(dayforgeSaasOnboardingSessions.id, session.id),
        eq(dayforgeSaasOnboardingSessions.version, input.expectedVersion),
        eq(dayforgeSaasOnboardingSessions.status, "draft")
      )
    );
  if (affectedRows(result) !== 1) {
    throw new Error(
      "Onboarding changed in another session; reload before saving"
    );
  }
  return requireOnboardingSession(input);
}

export async function attachCheckoutToOnboarding(input: {
  sessionId: string;
  resumeToken: string;
  planKey: string;
  requestId: string;
  stripeCheckoutSessionId: string;
}) {
  const session = await requireOnboardingSession(input);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (
    session.checkoutRequestId &&
    session.checkoutRequestId !== input.requestId
  ) {
    throw new Error(
      "Checkout has already been created for this onboarding session"
    );
  }
  await db
    .update(dayforgeSaasOnboardingSessions)
    .set({
      status: "checkout_pending",
      currentStep: "checkout",
      planKey: input.planKey,
      checkoutRequestId: input.requestId,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
    })
    .where(eq(dayforgeSaasOnboardingSessions.id, session.id));
  await db
    .update(dayforgeSaasCheckoutSessions)
    .set({
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      status: "open",
    })
    .where(
      eq(dayforgeSaasCheckoutSessions.onboardingSessionId, input.sessionId)
    );
}

export async function reserveOnboardingCheckout(input: {
  sessionId: string;
  resumeToken: string;
  planKey: string;
  requestId: string;
}) {
  const session = await requireOnboardingSession(input);
  if (!session.configurationJson) {
    throw new Error("Complete and save store configuration before checkout");
  }
  if (session.checkoutRequestId) {
    return session;
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .update(dayforgeSaasOnboardingSessions)
    .set({
      status: "checkout_pending",
      currentStep: "checkout",
      planKey: input.planKey,
      checkoutRequestId: input.requestId,
    })
    .where(
      and(
        eq(dayforgeSaasOnboardingSessions.id, session.id),
        eq(dayforgeSaasOnboardingSessions.status, "draft")
      )
    );
  if (affectedRows(result) !== 1) {
    const current = await requireOnboardingSession(input);
    if (current.checkoutRequestId !== input.requestId) {
      throw new Error("Checkout was reserved by another request");
    }
    return current;
  }
  return requireOnboardingSession(input);
}

export async function reserveSaasCheckoutSlot(input: {
  onboardingSessionId: string;
  planKey: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db
    .select()
    .from(dayforgeSaasCheckoutSessions)
    .where(
      eq(
        dayforgeSaasCheckoutSessions.onboardingSessionId,
        input.onboardingSessionId
      )
    )
    .limit(1);
  if (existing) {
    if (existing.planKey !== input.planKey) {
      throw new Error("Checkout is already reserved for a different plan");
    }
    return existing;
  }
  const id = randomUUID();
  try {
    await db.transaction(async tx => {
      await tx.insert(dayforgeSaasCheckoutSessions).values({
        id,
        onboardingSessionId: input.onboardingSessionId,
        planKey: input.planKey,
        requestId: input.requestId,
        status: "reserved",
        claimedSlot: true,
      });
      const claim = await tx
        .update(dayforgeSaasBillingPlans)
        .set({
          claimedSubscriptions: sql`${dayforgeSaasBillingPlans.claimedSubscriptions} + 1`,
        })
        .where(
          and(
            eq(dayforgeSaasBillingPlans.planKey, input.planKey),
            eq(dayforgeSaasBillingPlans.active, true),
            or(
              isNull(dayforgeSaasBillingPlans.maxSubscriptions),
              lt(
                dayforgeSaasBillingPlans.claimedSubscriptions,
                dayforgeSaasBillingPlans.maxSubscriptions
              )
            )
          )
        );
      if (affectedRows(claim) !== 1) {
        throw new Error("The selected DayForge plan has reached capacity");
      }
    });
  } catch (error) {
    if (!duplicateKey(error)) throw error;
  }
  const [reserved] = await db
    .select()
    .from(dayforgeSaasCheckoutSessions)
    .where(
      eq(
        dayforgeSaasCheckoutSessions.onboardingSessionId,
        input.onboardingSessionId
      )
    )
    .limit(1);
  if (!reserved || reserved.planKey !== input.planKey) {
    throw new Error("Checkout reservation could not be established");
  }
  return reserved;
}

export async function reserveBillingEvent(input: {
  stripeEventId: string;
  eventType: string;
  livemode: boolean;
  stripeCreatedAt: Date;
  payloadHash: string;
  objectId?: string | null;
  metadata?: unknown;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.insert(dayforgeSaasBillingEvents).values({
      stripeEventId: input.stripeEventId,
      eventType: input.eventType,
      livemode: input.livemode,
      stripeCreatedAt: input.stripeCreatedAt,
      payloadHash: input.payloadHash,
      objectId: input.objectId ?? null,
      metadataJson: input.metadata ?? null,
      status: "processing",
    });
    return true;
  } catch (error) {
    if (duplicateKey(error)) {
      const [existing] = await db
        .select({
          status: dayforgeSaasBillingEvents.status,
          processingStartedAt: dayforgeSaasBillingEvents.processingStartedAt,
        })
        .from(dayforgeSaasBillingEvents)
        .where(eq(dayforgeSaasBillingEvents.stripeEventId, input.stripeEventId))
        .limit(1);
      const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
      if (
        existing?.status === "failed" ||
        (existing?.status === "processing" &&
          existing.processingStartedAt < staleBefore)
      ) {
        const retry = await db
          .update(dayforgeSaasBillingEvents)
          .set({
            status: "processing",
            errorCode: null,
            processedAt: null,
            processingStartedAt: new Date(),
            attemptCount: sql`${dayforgeSaasBillingEvents.attemptCount} + 1`,
          })
          .where(
            and(
              eq(dayforgeSaasBillingEvents.stripeEventId, input.stripeEventId),
              existing.status === "failed"
                ? eq(dayforgeSaasBillingEvents.status, "failed")
                : and(
                    eq(dayforgeSaasBillingEvents.status, "processing"),
                    lt(
                      dayforgeSaasBillingEvents.processingStartedAt,
                      staleBefore
                    )
                  )
            )
          );
        return affectedRows(retry) === 1;
      }
      return false;
    }
    throw error;
  }
}

export async function expireOnboardingCheckout(
  stripeCheckoutSessionId: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async tx => {
    const [checkout] = await tx
      .select()
      .from(dayforgeSaasCheckoutSessions)
      .where(
        eq(
          dayforgeSaasCheckoutSessions.stripeCheckoutSessionId,
          stripeCheckoutSessionId
        )
      )
      .limit(1);
    if (!checkout) return;
    const release = await tx
      .update(dayforgeSaasCheckoutSessions)
      .set({ status: "expired", claimedSlot: false })
      .where(
        and(
          eq(dayforgeSaasCheckoutSessions.id, checkout.id),
          eq(dayforgeSaasCheckoutSessions.claimedSlot, true)
        )
      );
    if (affectedRows(release) === 1) {
      await tx
        .update(dayforgeSaasBillingPlans)
        .set({
          claimedSubscriptions: sql`GREATEST(0, ${dayforgeSaasBillingPlans.claimedSubscriptions} - 1)`,
        })
        .where(eq(dayforgeSaasBillingPlans.planKey, checkout.planKey));
    }
    await tx
      .update(dayforgeSaasOnboardingSessions)
      .set({
        status: "draft",
        currentStep: "checkout",
        checkoutRequestId: null,
        stripeCheckoutSessionId: null,
      })
      .where(
        and(
          eq(
            dayforgeSaasOnboardingSessions.stripeCheckoutSessionId,
            stripeCheckoutSessionId
          ),
          eq(dayforgeSaasOnboardingSessions.status, "checkout_pending")
        )
      );
  });
}

export async function finishBillingEvent(input: {
  stripeEventId: string;
  status: "processed" | "ignored" | "failed";
  tenantId?: string | null;
  errorCode?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(dayforgeSaasBillingEvents)
    .set({
      status: input.status,
      tenantId: input.tenantId ?? null,
      errorCode: input.errorCode ?? null,
      processedAt: new Date(),
    })
    .where(eq(dayforgeSaasBillingEvents.stripeEventId, input.stripeEventId));
}

function tenantIdForOnboarding(sessionId: string): string {
  return `df_${createHash("sha256").update(sessionId).digest("hex").slice(0, 24)}`;
}

export async function provisionTenantFromSubscription(input: {
  onboardingSessionId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  planKey: string;
  status: SaasSubscriptionStatus;
  eventId: string;
  eventCreatedAt: Date;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  trialEnd: Date | null;
  latestInvoiceId: string | null;
  delinquentAt?: Date | null;
  graceEndsAt?: Date | null;
  accessEndsAt?: Date | null;
  lastInvoicePaidAt?: Date | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [session] = await db
    .select()
    .from(dayforgeSaasOnboardingSessions)
    .where(eq(dayforgeSaasOnboardingSessions.id, input.onboardingSessionId))
    .limit(1);
  if (!session)
    throw new Error("Stripe subscription is not linked to onboarding");
  const configuration =
    session.configurationJson as SaasTenantOnboardingConfiguration | null;
  if (!configuration || !onboardingConfigurationIsOperational(configuration)) {
    throw new Error(
      "Stripe subscription is linked to incomplete onboarding configuration"
    );
  }
  const plan = await getActiveSaasPlan(input.planKey);
  const entitlements = (
    Array.isArray(plan.entitlementsJson) ? plan.entitlementsJson : []
  ) as DayforgeEntitlement[];
  const tenantId = session.tenantId || tenantIdForOnboarding(session.id);
  const tenantStatus =
    input.status === "active" || input.status === "trialing"
      ? session.status === "complete"
        ? "active"
        : "configuring"
      : input.status === "canceled"
        ? "canceled"
        : input.status === "paused"
          ? "suspended"
          : "delinquent";
  const existingSubscription = await db
    .select()
    .from(dayforgeSaasSubscriptions)
    .where(eq(dayforgeSaasSubscriptions.tenantId, tenantId))
    .limit(1);
  if (
    existingSubscription[0]?.lastStripeEventCreatedAt &&
    existingSubscription[0].lastStripeEventCreatedAt > input.eventCreatedAt
  ) {
    return { tenantId, ignoredAsStale: true };
  }

  await db.transaction(async tx => {
    await tx
      .insert(dayforgeSaasTenants)
      .values({
        id: tenantId,
        slug: normalizeSaasTenantSlug(configuration.slug),
        businessName: configuration.businessName,
        brandName: configuration.brandName,
        logoUrl: configuration.logoUrl,
        primaryColor: configuration.primaryColor,
        contactName: configuration.contactName,
        contactEmail: normalizeSaasEmail(configuration.contactEmail),
        contactPhone: configuration.contactPhone,
        website: configuration.website,
        timeZone: configuration.timeZone,
        proposalTemplateKey: configuration.proposalTemplateKey,
        status: tenantStatus,
        billingStateUpdatedAt: input.eventCreatedAt,
        onboardingStep: "owner_activation",
      })
      .onDuplicateKeyUpdate({
        set: {
          businessName: configuration.businessName,
          brandName: configuration.brandName,
          contactName: configuration.contactName,
          contactEmail: normalizeSaasEmail(configuration.contactEmail),
          contactPhone: configuration.contactPhone,
          website: configuration.website,
          timeZone: configuration.timeZone,
          status: sql`IF(${dayforgeSaasTenants.billingStateUpdatedAt} IS NULL OR ${dayforgeSaasTenants.billingStateUpdatedAt} <= ${input.eventCreatedAt}, ${tenantStatus}, ${dayforgeSaasTenants.status})`,
          billingStateUpdatedAt: sql`GREATEST(COALESCE(${dayforgeSaasTenants.billingStateUpdatedAt}, ${input.eventCreatedAt}), ${input.eventCreatedAt})`,
        },
      });

    for (let index = 0; index < configuration.locations.length; index += 1) {
      const location = configuration.locations[index]!;
      const locationKey =
        normalizeSaasTenantSlug(location.label) || `location-${index + 1}`;
      await tx
        .insert(dayforgeSaasTenantLocations)
        .values({
          tenantId,
          locationKey,
          label: location.label,
          address: location.address,
          latitude:
            location.latitude == null ? null : String(location.latitude),
          longitude:
            location.longitude == null ? null : String(location.longitude),
          serviceRadiusMiles: String(location.serviceRadiusMiles),
          maxPoundsPerDay: location.maxPoundsPerDay,
          maxPoundsByWeekdayJson: location.maxPoundsByWeekday,
          openCapacityPoundsPerWeek: location.openCapacityPoundsPerWeek,
          pickupDaysJson: location.pickupDays,
          routeWindowsJson: location.routeWindows,
          turnaroundHours: location.turnaroundHours,
          deliveryEnabled: location.deliveryEnabled,
          isPrimary: index === 0,
        })
        .onDuplicateKeyUpdate({
          set: {
            label: location.label,
            address: location.address,
            serviceRadiusMiles: String(location.serviceRadiusMiles),
            maxPoundsPerDay: location.maxPoundsPerDay,
            maxPoundsByWeekdayJson: location.maxPoundsByWeekday,
            openCapacityPoundsPerWeek: location.openCapacityPoundsPerWeek,
            pickupDaysJson: location.pickupDays,
            routeWindowsJson: location.routeWindows,
            turnaroundHours: location.turnaroundHours,
            deliveryEnabled: location.deliveryEnabled,
          },
        });
    }

    const locationRows = await tx
      .select()
      .from(dayforgeSaasTenantLocations)
      .where(eq(dayforgeSaasTenantLocations.tenantId, tenantId));
    for (const service of configuration.services) {
      const locationId = service.locationKey
        ? (locationRows.find(location => location.label === service.locationKey)
            ?.id ?? 0)
        : 0;
      await tx
        .insert(dayforgeSaasTenantServices)
        .values({
          tenantId,
          locationId,
          serviceKey: service.serviceKey,
          name: service.name,
          enabled: service.enabled,
          commercialEnabled: service.commercialEnabled,
          pricePerPoundCents: service.pricePerPoundCents,
          minimumOrderCents: service.minimumOrderCents,
          terms: service.terms,
        })
        .onDuplicateKeyUpdate({
          set: {
            name: service.name,
            enabled: service.enabled,
            commercialEnabled: service.commercialEnabled,
            pricePerPoundCents: service.pricePerPoundCents,
            minimumOrderCents: service.minimumOrderCents,
            terms: service.terms,
          },
        });
    }

    await tx
      .insert(dayforgeSaasSubscriptions)
      .values({
        tenantId,
        planKey: input.planKey,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        status: input.status,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        currentPeriodEnd: input.currentPeriodEnd,
        trialEnd: input.trialEnd,
        delinquentAt: input.delinquentAt ?? null,
        graceEndsAt: input.graceEndsAt ?? null,
        accessEndsAt: input.accessEndsAt ?? null,
        lastInvoicePaidAt: input.lastInvoicePaidAt ?? null,
        latestInvoiceId: input.latestInvoiceId,
        lastStripeEventId: input.eventId,
        lastStripeEventCreatedAt: input.eventCreatedAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          planKey: sql`IF(${dayforgeSaasSubscriptions.lastStripeEventCreatedAt} <= ${input.eventCreatedAt}, ${input.planKey}, ${dayforgeSaasSubscriptions.planKey})`,
          stripeCustomerId: sql`IF(${dayforgeSaasSubscriptions.lastStripeEventCreatedAt} <= ${input.eventCreatedAt}, ${input.stripeCustomerId}, ${dayforgeSaasSubscriptions.stripeCustomerId})`,
          stripeSubscriptionId: sql`IF(${dayforgeSaasSubscriptions.lastStripeEventCreatedAt} <= ${input.eventCreatedAt}, ${input.stripeSubscriptionId}, ${dayforgeSaasSubscriptions.stripeSubscriptionId})`,
          status: sql`IF(${dayforgeSaasSubscriptions.lastStripeEventCreatedAt} <= ${input.eventCreatedAt}, ${input.status}, ${dayforgeSaasSubscriptions.status})`,
          cancelAtPeriodEnd: sql`IF(${dayforgeSaasSubscriptions.lastStripeEventCreatedAt} <= ${input.eventCreatedAt}, ${input.cancelAtPeriodEnd}, ${dayforgeSaasSubscriptions.cancelAtPeriodEnd})`,
          currentPeriodEnd: sql`IF(${dayforgeSaasSubscriptions.lastStripeEventCreatedAt} <= ${input.eventCreatedAt}, ${input.currentPeriodEnd}, ${dayforgeSaasSubscriptions.currentPeriodEnd})`,
          trialEnd: sql`IF(${dayforgeSaasSubscriptions.lastStripeEventCreatedAt} <= ${input.eventCreatedAt}, ${input.trialEnd}, ${dayforgeSaasSubscriptions.trialEnd})`,
          ...(input.delinquentAt !== undefined
            ? {
                delinquentAt: sql`IF(${dayforgeSaasSubscriptions.lastStripeEventCreatedAt} <= ${input.eventCreatedAt}, ${input.delinquentAt}, ${dayforgeSaasSubscriptions.delinquentAt})`,
              }
            : {}),
          ...(input.graceEndsAt !== undefined
            ? {
                graceEndsAt: sql`IF(${dayforgeSaasSubscriptions.lastStripeEventCreatedAt} <= ${input.eventCreatedAt}, ${input.graceEndsAt}, ${dayforgeSaasSubscriptions.graceEndsAt})`,
              }
            : {}),
          ...(input.accessEndsAt !== undefined
            ? {
                accessEndsAt: sql`IF(${dayforgeSaasSubscriptions.lastStripeEventCreatedAt} <= ${input.eventCreatedAt}, ${input.accessEndsAt}, ${dayforgeSaasSubscriptions.accessEndsAt})`,
              }
            : {}),
          ...(input.lastInvoicePaidAt !== undefined
            ? {
                lastInvoicePaidAt: sql`IF(${dayforgeSaasSubscriptions.lastStripeEventCreatedAt} <= ${input.eventCreatedAt}, ${input.lastInvoicePaidAt}, ${dayforgeSaasSubscriptions.lastInvoicePaidAt})`,
              }
            : {}),
          latestInvoiceId: sql`IF(${dayforgeSaasSubscriptions.lastStripeEventCreatedAt} <= ${input.eventCreatedAt}, ${input.latestInvoiceId}, ${dayforgeSaasSubscriptions.latestInvoiceId})`,
          lastStripeEventId: sql`IF(${dayforgeSaasSubscriptions.lastStripeEventCreatedAt} <= ${input.eventCreatedAt}, ${input.eventId}, ${dayforgeSaasSubscriptions.lastStripeEventId})`,
          lastStripeEventCreatedAt: sql`GREATEST(${dayforgeSaasSubscriptions.lastStripeEventCreatedAt}, ${input.eventCreatedAt})`,
        },
      });

    for (const entitlementKey of DAYFORGE_ENTITLEMENTS) {
      await tx
        .insert(dayforgeSaasEntitlements)
        .values({
          tenantId,
          entitlementKey,
          source: "plan",
          enabled: entitlements.includes(entitlementKey),
        })
        .onDuplicateKeyUpdate({
          set: {
            enabled: entitlements.includes(entitlementKey),
            expiresAt: null,
          },
        });
    }

    const primary = configuration.locations[0];
    const commercialServices = configuration.services.filter(
      service => service.enabled && service.commercialEnabled
    );
    const commercialPrice = commercialServices.find(
      service => service.pricePerPoundCents
    )?.pricePerPoundCents;
    if (primary && commercialPrice) {
      await tx
        .insert(territoryOperatorProfiles)
        .values({
          tenantId,
          storeName: primary.label,
          storeAddress: primary.address,
          latitude: primary.latitude == null ? null : String(primary.latitude),
          longitude:
            primary.longitude == null ? null : String(primary.longitude),
          serviceRadiusMiles: String(primary.serviceRadiusMiles),
          commercialWashFoldEnabled: true,
          averagePricePerPoundCents: commercialPrice,
          availableWeeklyCapacityPounds: primary.openCapacityPoundsPerWeek,
          routePointsJson: [],
          turnaroundCompatibleByDefault: true,
          pickupDaysCompatibleByDefault: primary.pickupDays.length > 0,
        })
        .onDuplicateKeyUpdate({
          set: {
            storeName: primary.label,
            storeAddress: primary.address,
            serviceRadiusMiles: String(primary.serviceRadiusMiles),
            averagePricePerPoundCents: commercialPrice,
            availableWeeklyCapacityPounds: primary.openCapacityPoundsPerWeek,
          },
        });
      if (configuration.website && configuration.contactPhone) {
        await tx
          .insert(tenantCommercialProposalProfiles)
          .values({
            tenantId,
            storeName: configuration.brandName,
            operatorName: configuration.contactName,
            phone: configuration.contactPhone,
            email: normalizeSaasEmail(configuration.contactEmail),
            website: configuration.website,
            address: primary.address,
            logoUrl: configuration.logoUrl,
            commercialPricePerPoundCents: commercialPrice,
            minimumOrderCents:
              commercialServices.find(service => service.minimumOrderCents)
                ?.minimumOrderCents ?? null,
            turnaroundLabel: `${primary.turnaroundHours} hour turnaround`,
            pickupScheduleLabel: primary.pickupDays.join(", "),
            serviceAreaLabel: `${primary.serviceRadiusMiles} mile service radius`,
            insuranceLabel: null,
            servicesJson: commercialServices.map(service => service.name),
            createdBy: "dayforge_onboarding",
            updatedBy: "dayforge_onboarding",
          })
          .onDuplicateKeyUpdate({
            set: {
              storeName: configuration.brandName,
              operatorName: configuration.contactName,
              phone: configuration.contactPhone,
              email: normalizeSaasEmail(configuration.contactEmail),
              website: configuration.website,
              address: primary.address,
              logoUrl: configuration.logoUrl,
              commercialPricePerPoundCents: commercialPrice,
              servicesJson: commercialServices.map(service => service.name),
              updatedBy: "dayforge_onboarding",
            },
          });
      }
    }

    await tx
      .update(dayforgeSaasOnboardingSessions)
      .set({
        tenantId,
        status: sql`IF(${dayforgeSaasOnboardingSessions.status} = 'complete', 'complete', 'provisioned')`,
        currentStep: sql`IF(${dayforgeSaasOnboardingSessions.status} = 'complete', 'complete', 'owner_activation')`,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
      })
      .where(eq(dayforgeSaasOnboardingSessions.id, session.id));
    await tx
      .update(dayforgeSaasCheckoutSessions)
      .set({ status: "completed" })
      .where(eq(dayforgeSaasCheckoutSessions.onboardingSessionId, session.id));
  });
  return { tenantId, ignoredAsStale: false };
}

export async function activateOnboardingOwner(input: {
  sessionId: string;
  resumeToken: string;
  name: string;
  passwordHash: string;
}) {
  const session = await requireOnboardingSession(input);
  if (!session.tenantId || session.status !== "provisioned") {
    throw new Error("Tenant is not ready for owner activation");
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tenantId = session.tenantId;
  const [subscription] = await db
    .select()
    .from(dayforgeSaasSubscriptions)
    .where(eq(dayforgeSaasSubscriptions.tenantId, tenantId))
    .limit(1);
  if (
    !subscription ||
    !subscriptionAllowsDayforgeAccess({
      status: subscription.status,
      graceEndsAt: subscription.graceEndsAt,
      accessEndsAt: subscription.accessEndsAt,
    })
  ) {
    throw new Error("Tenant subscription is not active for owner activation");
  }
  const openId = `dayforge:${createHash("sha256")
    .update(`${tenantId}:${session.ownerEmail}`)
    .digest("hex")
    .slice(0, 48)}`;
  await db.transaction(async tx => {
    const claim = await tx
      .update(dayforgeSaasOnboardingSessions)
      .set({ status: "configuring", currentStep: "owner_activation" })
      .where(
        and(
          eq(dayforgeSaasOnboardingSessions.id, session.id),
          eq(dayforgeSaasOnboardingSessions.status, "provisioned")
        )
      );
    if (affectedRows(claim) !== 1) {
      throw new Error("Tenant owner activation has already been claimed");
    }
    await tx
      .insert(users)
      .values({
        tenantId,
        openId,
        name: input.name,
        email: session.ownerEmail,
        loginMethod: "dayforge_password",
        role: "user",
      })
      .onDuplicateKeyUpdate({
        set: {
          tenantId,
          name: input.name,
          email: session.ownerEmail,
        },
      });
    await tx
      .insert(dayforgeSaasMemberships)
      .values({
        tenantId,
        userOpenId: openId,
        role: "owner",
        active: true,
      })
      .onDuplicateKeyUpdate({ set: { role: "owner", active: true } });
    await tx
      .insert(dayforgeSaasUserCredentials)
      .values({
        tenantId,
        userOpenId: openId,
        emailNormalized: session.ownerEmail,
        passwordHash: input.passwordHash,
      })
      .onDuplicateKeyUpdate({
        set: {
          passwordHash: input.passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
    await tx
      .update(dayforgeSaasTenants)
      .set({
        status: "active",
        onboardingStep: "complete",
        onboardingCompletedAt: new Date(),
      })
      .where(eq(dayforgeSaasTenants.id, tenantId));
    await tx
      .update(dayforgeSaasOnboardingSessions)
      .set({ status: "complete", currentStep: "complete" })
      .where(eq(dayforgeSaasOnboardingSessions.id, session.id));
  });
  return { tenantId, openId };
}

export async function createTenantInvite(input: {
  tenantId: string;
  email: string;
  role: Exclude<SaasTenantMemberRole, "owner">;
  actorOpenId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await db.insert(dayforgeSaasTenantInvites).values({
    id,
    tenantId: input.tenantId,
    emailNormalized: normalizeSaasEmail(input.email),
    role: input.role,
    tokenHash: hashSecret(token),
    invitedByOpenId: input.actorOpenId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  return { inviteId: id, token };
}

export async function acceptTenantInvite(input: {
  token: string;
  name: string;
  passwordHash: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [invite] = await db
    .select()
    .from(dayforgeSaasTenantInvites)
    .where(
      and(
        eq(dayforgeSaasTenantInvites.tokenHash, hashSecret(input.token)),
        eq(dayforgeSaasTenantInvites.status, "pending")
      )
    )
    .limit(1);
  if (!invite || invite.expiresAt <= new Date()) {
    throw new Error("Invite is invalid or expired");
  }
  const openId = `dayforge:${createHash("sha256")
    .update(`${invite.tenantId}:${invite.emailNormalized}`)
    .digest("hex")
    .slice(0, 48)}`;
  const platformRole = "user" as const;
  await db.transaction(async tx => {
    const claim = await tx
      .update(dayforgeSaasTenantInvites)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(
        and(
          eq(dayforgeSaasTenantInvites.id, invite.id),
          eq(dayforgeSaasTenantInvites.status, "pending")
        )
      );
    if (affectedRows(claim) !== 1) {
      throw new Error("Invite has already been used");
    }
    await tx
      .insert(users)
      .values({
        tenantId: invite.tenantId,
        openId,
        name: input.name,
        email: invite.emailNormalized,
        loginMethod: "dayforge_password",
        role: platformRole,
      })
      .onDuplicateKeyUpdate({
        set: {
          tenantId: invite.tenantId,
          name: input.name,
          role: platformRole,
        },
      });
    await tx
      .insert(dayforgeSaasMemberships)
      .values({
        tenantId: invite.tenantId,
        userOpenId: openId,
        role: invite.role,
        active: true,
      })
      .onDuplicateKeyUpdate({ set: { role: invite.role, active: true } });
    await tx
      .insert(dayforgeSaasUserCredentials)
      .values({
        tenantId: invite.tenantId,
        userOpenId: openId,
        emailNormalized: invite.emailNormalized,
        passwordHash: input.passwordHash,
      })
      .onDuplicateKeyUpdate({
        set: {
          passwordHash: input.passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
  });
  return { tenantId: invite.tenantId, openId, role: invite.role };
}

export async function listTenantMembers(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select({
      openId: dayforgeSaasMemberships.userOpenId,
      role: dayforgeSaasMemberships.role,
      active: dayforgeSaasMemberships.active,
      name: users.name,
      email: users.email,
    })
    .from(dayforgeSaasMemberships)
    .leftJoin(users, eq(users.openId, dayforgeSaasMemberships.userOpenId))
    .where(eq(dayforgeSaasMemberships.tenantId, tenantId));
}

export async function getTenantConfiguration(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [tenant] = await db
    .select()
    .from(dayforgeSaasTenants)
    .where(eq(dayforgeSaasTenants.id, tenantId))
    .limit(1);
  if (!tenant) return null;
  const [locations, services] = await Promise.all([
    db
      .select()
      .from(dayforgeSaasTenantLocations)
      .where(eq(dayforgeSaasTenantLocations.tenantId, tenantId)),
    db
      .select()
      .from(dayforgeSaasTenantServices)
      .where(eq(dayforgeSaasTenantServices.tenantId, tenantId)),
  ]);
  return { tenant, locations, services };
}

export async function startTenantImportRun(input: {
  tenantId: string;
  providerKey: string;
  configuration: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .insert(dayforgeSaasImportConnections)
    .values({
      tenantId: input.tenantId,
      providerKey: input.providerKey,
      status: "configured",
      configurationJson: input.configuration,
    })
    .onDuplicateKeyUpdate({
      set: { status: "configured", configurationJson: input.configuration },
    });
  const [connection] = await db
    .select()
    .from(dayforgeSaasImportConnections)
    .where(
      and(
        eq(dayforgeSaasImportConnections.tenantId, input.tenantId),
        eq(dayforgeSaasImportConnections.providerKey, input.providerKey)
      )
    )
    .limit(1);
  if (!connection) throw new Error("Import connection was not created");
  const runId = randomUUID();
  await db.insert(dayforgeSaasImportRuns).values({
    id: runId,
    tenantId: input.tenantId,
    connectionId: connection.id,
    status: "started",
  });
  return { runId, connectionId: connection.id };
}

export async function finishTenantImportRun(input: {
  tenantId: string;
  runId: string;
  connectionId: number;
  status: "completed" | "completed_with_errors" | "failed";
  importedCustomers: number;
  importedOrders: number;
  skippedRecords: number;
  errorJson?: unknown;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(dayforgeSaasImportRuns)
    .set({
      status: input.status,
      importedCustomers: input.importedCustomers,
      importedOrders: input.importedOrders,
      skippedRecords: input.skippedRecords,
      errorJson: input.errorJson ?? null,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(dayforgeSaasImportRuns.tenantId, input.tenantId),
        eq(dayforgeSaasImportRuns.id, input.runId)
      )
    );
  await db
    .update(dayforgeSaasImportConnections)
    .set({
      status: input.status === "failed" ? "error" : "connected",
      lastImportedAt: new Date(),
    })
    .where(
      and(
        eq(dayforgeSaasImportConnections.tenantId, input.tenantId),
        eq(dayforgeSaasImportConnections.id, input.connectionId)
      )
    );
}

export async function persistNormalizedTenantImport(input: {
  tenantId: string;
  providerKey: string;
  connectionId: number;
  runId: string;
  customers: NormalizedTenantCustomer[];
  orders: NormalizedTenantOrder[];
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async tx => {
    for (const customer of input.customers) {
      await tx
        .insert(dayforgeSaasExternalCustomers)
        .values({
          tenantId: input.tenantId,
          connectionId: input.connectionId,
          providerKey: input.providerKey,
          externalId: customer.externalId,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          factsJson: customer.facts,
          sourceCapturedAt: new Date(customer.sourceCapturedAt),
          importRunId: input.runId,
        })
        .onDuplicateKeyUpdate({
          set: {
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            factsJson: customer.facts,
            sourceCapturedAt: new Date(customer.sourceCapturedAt),
            importRunId: input.runId,
          },
        });
    }
    for (const order of input.orders) {
      await tx
        .insert(dayforgeSaasExternalOrders)
        .values({
          tenantId: input.tenantId,
          connectionId: input.connectionId,
          providerKey: input.providerKey,
          externalId: order.externalId,
          externalCustomerId: order.externalCustomerId,
          totalCents: order.totalCents,
          paid: order.paid,
          occurredAt: order.occurredAt ? new Date(order.occurredAt) : null,
          factsJson: order.facts,
          sourceCapturedAt: new Date(order.sourceCapturedAt),
          importRunId: input.runId,
        })
        .onDuplicateKeyUpdate({
          set: {
            externalCustomerId: order.externalCustomerId,
            totalCents: order.totalCents,
            paid: order.paid,
            occurredAt: order.occurredAt ? new Date(order.occurredAt) : null,
            factsJson: order.facts,
            sourceCapturedAt: new Date(order.sourceCapturedAt),
            importRunId: input.runId,
          },
        });
    }
  });
}

export async function getTenantBillingSummary(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [subscription] = await db
    .select()
    .from(dayforgeSaasSubscriptions)
    .where(eq(dayforgeSaasSubscriptions.tenantId, tenantId))
    .limit(1);
  if (!subscription) return null;
  const [plan] = await db
    .select()
    .from(dayforgeSaasBillingPlans)
    .where(eq(dayforgeSaasBillingPlans.planKey, subscription.planKey))
    .limit(1);
  return {
    planKey: subscription.planKey,
    planName: plan?.displayName ?? subscription.planKey,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    trialEnd: subscription.trialEnd?.toISOString() ?? null,
  };
}

export async function getStripeCustomerForTenant(
  tenantId: string
): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [subscription] = await db
    .select({ stripeCustomerId: dayforgeSaasSubscriptions.stripeCustomerId })
    .from(dayforgeSaasSubscriptions)
    .where(eq(dayforgeSaasSubscriptions.tenantId, tenantId))
    .limit(1);
  if (!subscription)
    throw new Error("Tenant does not have a DayForge subscription");
  return subscription.stripeCustomerId;
}
