// Operator Representation architecture: docs/goldline/OPERATOR_REPRESENTATION.md
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  persistentOperatorIdentityBindings,
  users,
} from "../../drizzle/schema";
import type { SaasTenantMemberRole } from "../../shared/saasTenant";
import { getDb } from "../db";
import { isLegacySharedPasswordOpenId } from "../joystick/tenantIdentity";
import {
  isLegacyDayforgeTenant,
  resolveLegacyDayforgeMembership,
} from "../saas/tenantAccess";
import {
  recordPersistentOperatorDiagnosticEvent,
  type PersistentOperatorEmptyReason,
} from "./observability";

export const OPERATOR_IDENTITY_SURFACES = [
  "admin",
  "driver",
  "operator",
  "communication",
] as const;
export type OperatorIdentitySurface = (typeof OPERATOR_IDENTITY_SURFACES)[number];

export const OPERATOR_IDENTITY_TYPES = [
  "canonical_operator",
  "user_id",
  "open_id",
  "tenant_membership",
  "admin_login",
  "driver_login",
  "authorized_phone_identity",
] as const;
export type OperatorIdentityType = (typeof OPERATOR_IDENTITY_TYPES)[number];

type PlatformRole = "admin" | "driver" | "user";

export type OperatorIdentityUser = {
  id: number;
  tenantId: string | null;
  openId: string;
  role: PlatformRole;
};

export type OperatorIdentityBinding = {
  id: string;
  tenantId: string;
  canonicalOpenId: string;
  aliasOpenId: string;
  activeAliasKey?: string | null;
  surface: string;
  active: boolean;
  createdByOpenId: string | null;
  revokedAt: Date | null;
};

export type CanonicalOperatorIdentity = {
  tenantId: string;
  canonicalOperatorId: string;
  canonicalOpenId: string;
  canonicalUserId: number;
  sourceOpenId: string;
  sourceUserId: number;
  sourceRole: PlatformRole;
  dayDirectorActorId: string;
  dayDirectorActorIds: string[];
  weeklyOperatorId: string;
  campaignOperatorUserId: string;
  communicationOperatorUserId: string;
  membership: {
    source: SaasTenantMemberRole;
    canonical: SaasTenantMemberRole;
  };
  aliases: Array<{
    openId: string;
    userId: number;
    role: PlatformRole;
    surface: string;
  }>;
};

export type CanonicalOperatorResolution =
  | { ok: true; identity: CanonicalOperatorIdentity }
  | {
      ok: false;
      reason: Extract<
        PersistentOperatorEmptyReason,
        "identity_unresolved" | "identity_ambiguous"
      >;
    };

export type ResolveCanonicalOperatorIdentityInput = {
  tenantId: string;
  source:
    | { type: "open_id"; value: string; expectedUserId?: number | null }
    | { type: "user_id"; value: number };
  subsystem: string;
};

type Membership = {
  tenantId: string;
  userOpenId: string;
  role: SaasTenantMemberRole;
};

export type OperatorIdentityResolverDeps = {
  findUserByOpenId: (
    tenantId: string,
    openId: string
  ) => Promise<OperatorIdentityUser | null>;
  findUserById: (
    tenantId: string,
    userId: number
  ) => Promise<OperatorIdentityUser | null>;
  listBindingsForAlias: (
    tenantId: string,
    aliasOpenId: string
  ) => Promise<OperatorIdentityBinding[]>;
  listBindingsForCanonical: (
    tenantId: string,
    canonicalOpenId: string
  ) => Promise<OperatorIdentityBinding[]>;
  resolveMembership: (input: {
    tenantId: string;
    userOpenId: string;
    platformRole: PlatformRole;
  }) => Promise<Membership | null>;
  recordFailure: (input: {
    tenantId: string;
    subsystem: string;
    reason: "identity_unresolved" | "identity_ambiguous";
    sourceIdentityType: OperatorIdentityType;
    targetIdentityType: OperatorIdentityType;
  }) => Promise<void>;
};

async function defaultFindUserByOpenId(
  _tenantId: string,
  openId: string
): Promise<OperatorIdentityUser | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({
      id: users.id,
      tenantId: users.tenantId,
      openId: users.openId,
      role: users.role,
    })
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  return row ?? null;
}

async function defaultFindUserById(
  _tenantId: string,
  userId: number
): Promise<OperatorIdentityUser | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({
      id: users.id,
      tenantId: users.tenantId,
      openId: users.openId,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

async function defaultBindingsForAlias(
  tenantId: string,
  aliasOpenId: string
): Promise<OperatorIdentityBinding[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(persistentOperatorIdentityBindings)
    .where(
      and(
        eq(persistentOperatorIdentityBindings.tenantId, tenantId),
        eq(persistentOperatorIdentityBindings.aliasOpenId, aliasOpenId),
        eq(persistentOperatorIdentityBindings.active, true)
      )
    );
}

async function defaultBindingsForCanonical(
  tenantId: string,
  canonicalOpenId: string
): Promise<OperatorIdentityBinding[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(persistentOperatorIdentityBindings)
    .where(
      and(
        eq(persistentOperatorIdentityBindings.tenantId, tenantId),
        eq(persistentOperatorIdentityBindings.canonicalOpenId, canonicalOpenId),
        eq(persistentOperatorIdentityBindings.active, true)
      )
    );
}

const defaultDeps: OperatorIdentityResolverDeps = {
  findUserByOpenId: defaultFindUserByOpenId,
  findUserById: defaultFindUserById,
  listBindingsForAlias: defaultBindingsForAlias,
  listBindingsForCanonical: defaultBindingsForCanonical,
  resolveMembership: resolveLegacyDayforgeMembership,
  recordFailure: async input => {
    await recordPersistentOperatorDiagnosticEvent({
      tenantId: input.tenantId,
      subsystem: input.subsystem,
      eventKind: "identity_join_failure",
      reason: input.reason,
      sourceIdentityType: input.sourceIdentityType,
      targetIdentityType: input.targetIdentityType,
    }).catch(() => undefined);
  },
};

function canonicalOperatorId(tenantId: string, canonicalOpenId: string): string {
  return `tenant:${tenantId}:operator:${canonicalOpenId}`;
}

export function operatorUserCanResolveOnTenant(
  user: OperatorIdentityUser,
  tenantId: string
): boolean {
  const persistedTenant = user.tenantId?.trim() || "";
  if (persistedTenant === tenantId) return true;
  return (
    isLegacyDayforgeTenant(tenantId) &&
    isLegacySharedPasswordOpenId(user.openId) &&
    (user.role === "admin" || user.role === "driver")
  );
}

async function fail(
  deps: OperatorIdentityResolverDeps,
  input: ResolveCanonicalOperatorIdentityInput,
  reason: "identity_unresolved" | "identity_ambiguous",
  sourceIdentityType: OperatorIdentityType,
  targetIdentityType: OperatorIdentityType
): Promise<CanonicalOperatorResolution> {
  await deps
    .recordFailure({
      tenantId: input.tenantId,
      subsystem: input.subsystem,
      reason,
      sourceIdentityType,
      targetIdentityType,
    })
    .catch(() => undefined);
  return { ok: false, reason };
}

async function resolveCanonicalOperatorIdentityUnchecked(
  input: ResolveCanonicalOperatorIdentityInput,
  deps: OperatorIdentityResolverDeps = defaultDeps
): Promise<CanonicalOperatorResolution> {
  const tenantId = input.tenantId.trim();
  if (!tenantId) {
    return fail(
      deps,
      input,
      "identity_unresolved",
      input.source.type === "open_id" ? "open_id" : "user_id",
      "canonical_operator"
    );
  }

  const sourceUser =
    input.source.type === "open_id"
      ? await deps.findUserByOpenId(tenantId, input.source.value.trim())
      : await deps.findUserById(tenantId, input.source.value);

  if (!sourceUser || !operatorUserCanResolveOnTenant(sourceUser, tenantId)) {
    return fail(
      deps,
      input,
      "identity_unresolved",
      input.source.type === "open_id" ? "open_id" : "user_id",
      "canonical_operator"
    );
  }

  if (
    input.source.type === "open_id" &&
    input.source.expectedUserId != null &&
    sourceUser.id !== input.source.expectedUserId
  ) {
    return fail(
      deps,
      input,
      "identity_unresolved",
      "open_id",
      "user_id"
    );
  }

  const sourceMembership = await deps.resolveMembership({
    tenantId,
    userOpenId: sourceUser.openId,
    platformRole: sourceUser.role,
  });
  if (!sourceMembership || sourceMembership.tenantId !== tenantId) {
    return fail(
      deps,
      input,
      "identity_unresolved",
      "open_id",
      "tenant_membership"
    );
  }

  const directBindings = await deps.listBindingsForAlias(
    tenantId,
    sourceUser.openId
  );
  if (directBindings.length > 1) {
    return fail(
      deps,
      input,
      "identity_ambiguous",
      "open_id",
      "canonical_operator"
    );
  }

  const canonicalOpenId =
    directBindings[0]?.canonicalOpenId.trim() || sourceUser.openId;
  const canonicalUser = await deps.findUserByOpenId(tenantId, canonicalOpenId);
  if (!canonicalUser || !operatorUserCanResolveOnTenant(canonicalUser, tenantId)) {
    return fail(
      deps,
      input,
      "identity_unresolved",
      "canonical_operator",
      "open_id"
    );
  }

  const canonicalMembership = await deps.resolveMembership({
    tenantId,
    userOpenId: canonicalUser.openId,
    platformRole: canonicalUser.role,
  });
  if (!canonicalMembership || canonicalMembership.tenantId !== tenantId) {
    return fail(
      deps,
      input,
      "identity_unresolved",
      "canonical_operator",
      "tenant_membership"
    );
  }

  const groupBindings = await deps.listBindingsForCanonical(
    tenantId,
    canonicalOpenId
  );
  const duplicateAliases = new Set<string>();
  const seen = new Set<string>();
  for (const binding of groupBindings) {
    if (seen.has(binding.aliasOpenId)) duplicateAliases.add(binding.aliasOpenId);
    seen.add(binding.aliasOpenId);
  }
  if (duplicateAliases.size > 0) {
    return fail(
      deps,
      input,
      "identity_ambiguous",
      "open_id",
      "canonical_operator"
    );
  }

  const aliases: CanonicalOperatorIdentity["aliases"] = [];
  const aliasOpenIds = new Set([
    canonicalUser.openId,
    ...groupBindings.map(binding => binding.aliasOpenId),
  ]);
  for (const openId of aliasOpenIds) {
    const user = await deps.findUserByOpenId(tenantId, openId);
    if (!user || !operatorUserCanResolveOnTenant(user, tenantId)) {
      return fail(
        deps,
        input,
        "identity_unresolved",
        "canonical_operator",
        "open_id"
      );
    }
    const binding = groupBindings.find(row => row.aliasOpenId === openId);
    aliases.push({
      openId,
      userId: user.id,
      role: user.role,
      surface:
        binding?.surface ??
        (user.role === "admin"
          ? "admin"
          : user.role === "driver"
            ? "driver"
            : "operator"),
    });
  }

  const dayDirectorActorIds = [...new Set([
    String(canonicalUser.id),
    String(sourceUser.id),
    ...aliases.map(alias => String(alias.userId)),
  ])];

  return {
    ok: true,
    identity: {
      tenantId,
      canonicalOperatorId: canonicalOperatorId(tenantId, canonicalOpenId),
      canonicalOpenId,
      canonicalUserId: canonicalUser.id,
      sourceOpenId: sourceUser.openId,
      sourceUserId: sourceUser.id,
      sourceRole: sourceUser.role,
      dayDirectorActorId: String(canonicalUser.id),
      dayDirectorActorIds,
      weeklyOperatorId: canonicalOpenId,
      campaignOperatorUserId: canonicalOpenId,
      communicationOperatorUserId: canonicalOpenId,
      membership: {
        source: sourceMembership.role,
        canonical: canonicalMembership.role,
      },
      aliases,
    },
  };
}

export async function resolveCanonicalOperatorIdentity(
  input: ResolveCanonicalOperatorIdentityInput,
  deps: OperatorIdentityResolverDeps = defaultDeps
): Promise<CanonicalOperatorResolution> {
  try {
    return await resolveCanonicalOperatorIdentityUnchecked(input, deps);
  } catch {
    return fail(
      deps,
      input,
      "identity_unresolved",
      input.source.type === "open_id" ? "open_id" : "user_id",
      "canonical_operator"
    );
  }
}

export class CanonicalOperatorIdentityError extends Error {
  constructor(
    public readonly reason: "identity_unresolved" | "identity_ambiguous"
  ) {
    super(`Canonical operator identity failed: ${reason}`);
  }
}

export async function requireCanonicalOperatorIdentityForUser(input: {
  tenantId: string;
  user: { id?: unknown; openId: string; role: PlatformRole };
  subsystem: string;
}): Promise<CanonicalOperatorIdentity> {
  const expectedUserId =
    typeof input.user.id === "number" && Number.isInteger(input.user.id)
      ? input.user.id
      : null;
  const result = await resolveCanonicalOperatorIdentity({
    tenantId: input.tenantId,
    source: {
      type: "open_id",
      value: input.user.openId,
      expectedUserId,
    },
    subsystem: input.subsystem,
  });
  if (!result.ok) throw new CanonicalOperatorIdentityError(result.reason);
  return result.identity;
}

/**
 * Resolves the dedicated canonical operator identity for a target tenant.
 * Used for cross-tenant administration without mutating the platform admin's user record.
 */
export async function resolveTargetTenantCanonicalOperatorIdentity(input: {
  tenantId: string;
  subsystem: string;
}): Promise<CanonicalOperatorIdentity> {
  const tenantId = input.tenantId.trim();
  if (!tenantId) {
    throw new CanonicalOperatorIdentityError("identity_unresolved");
  }

  const db = await getDb();
  if (!db) {
    throw new Error("Database unavailable for cross-tenant operator resolution");
  }

  const candidateUsers = await db
    .select({
      id: users.id,
      tenantId: users.tenantId,
      openId: users.openId,
      role: users.role,
    })
    .from(users)
    .where(eq(users.tenantId, tenantId));

  const targetUsers = candidateUsers.filter(u => u.tenantId === tenantId);
  const targetUser =
    targetUsers.find(u => u.openId.startsWith("operator_")) ||
    targetUsers.find(u => u.role === "admin") ||
    targetUsers.find(u => u.role === "driver") ||
    targetUsers[0];

  if (!targetUser) {
    throw new CanonicalOperatorIdentityError("identity_unresolved");
  }

  return requireCanonicalOperatorIdentityForUser({
    tenantId,
    user: targetUser,
    subsystem: input.subsystem,
  });
}

/**
 * Resolves the effective canonical operator identity for an API procedure:
 * - If targetTenantId matches callerTenantId (or is omitted), uses the caller's own canonical identity.
 * - If targetTenantId differs, validates caller is platform admin and resolves the target tenant's dedicated operator.
 * - Non-admin callers attempting cross-tenant access are rejected with FORBIDDEN.
 */
export async function requireEffectiveOperatorIdentityForTenant(input: {
  callerUser: { id?: unknown; openId: string; role: PlatformRole; tenantId?: string | null };
  callerTenantId: string;
  targetTenantId?: string | null;
  subsystem: string;
}): Promise<CanonicalOperatorIdentity> {
  const callerTenantId = input.callerTenantId?.trim() || "default";
  const targetTenantId = input.targetTenantId?.trim();

  // 1. Same-tenant view: use caller's own canonical identity
  if (!targetTenantId || targetTenantId === callerTenantId) {
    return requireCanonicalOperatorIdentityForUser({
      tenantId: callerTenantId,
      user: input.callerUser,
      subsystem: input.subsystem,
    });
  }

  // 2. Cross-tenant view: strictly requires platform admin
  if (input.callerUser.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Cross-tenant inspection of tenant '${targetTenantId}' is restricted to platform administrators.`,
    });
  }

  // 3. Resolve target tenant's dedicated operator identity without mutating caller's user record
  return resolveTargetTenantCanonicalOperatorIdentity({
    tenantId: targetTenantId,
    subsystem: input.subsystem,
  });
}

export async function bindOperatorIdentityAlias(input: {
  tenantId: string;
  canonicalOpenId: string;
  aliasOpenId: string;
  surface: OperatorIdentitySurface;
  createdByOpenId: string;
}): Promise<OperatorIdentityBinding> {
  const tenantId = input.tenantId.trim();
  const canonicalOpenId = input.canonicalOpenId.trim();
  const aliasOpenId = input.aliasOpenId.trim();
  if (!tenantId || !canonicalOpenId || !aliasOpenId) {
    throw new Error("tenantId, canonicalOpenId, and aliasOpenId are required");
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [canonicalUser, aliasUser] = await Promise.all([
    defaultFindUserByOpenId(tenantId, canonicalOpenId),
    defaultFindUserByOpenId(tenantId, aliasOpenId),
  ]);
  if (
    !canonicalUser ||
    !aliasUser ||
    !operatorUserCanResolveOnTenant(canonicalUser, tenantId) ||
    !operatorUserCanResolveOnTenant(aliasUser, tenantId)
  ) {
    throw new Error(
      "Both identities must be persisted users authorized for the same tenant"
    );
  }

  const [canonicalMembership, aliasMembership] = await Promise.all([
    resolveLegacyDayforgeMembership({
      tenantId,
      userOpenId: canonicalUser.openId,
      platformRole: canonicalUser.role,
    }),
    resolveLegacyDayforgeMembership({
      tenantId,
      userOpenId: aliasUser.openId,
      platformRole: aliasUser.role,
    }),
  ]);
  if (!canonicalMembership || !aliasMembership) {
    throw new Error("Both identities must have active tenant authority");
  }

  // MySQL openId lookups may be case-insensitive. From this point forward the
  // persisted user rows are the spelling authority so every JS Set/key sees
  // one stable identity.
  const persistedCanonicalOpenId = canonicalUser.openId;
  const persistedAliasOpenId = aliasUser.openId;

  if (persistedAliasOpenId === persistedCanonicalOpenId) {
    throw new Error("A canonical identity does not need a self-alias binding");
  }

  // Binding graphs are one level deep. Lock both participating user rows in a
  // deterministic order so cross-linked concurrent requests (B -> A and
  // A -> C) cannot both validate against a stale graph and then commit.
  return db.transaction(async tx => {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, [canonicalUser.id, aliasUser.id]))
      .orderBy(users.id)
      .for("update");

    const active = await tx
      .select()
      .from(persistentOperatorIdentityBindings)
      .where(
        and(
          eq(persistentOperatorIdentityBindings.tenantId, tenantId),
          eq(persistentOperatorIdentityBindings.aliasOpenId, persistedAliasOpenId),
          eq(persistentOperatorIdentityBindings.active, true)
        )
      );
    const canonicalAsAlias = await tx
      .select()
      .from(persistentOperatorIdentityBindings)
      .where(
        and(
          eq(persistentOperatorIdentityBindings.tenantId, tenantId),
          eq(persistentOperatorIdentityBindings.aliasOpenId, persistedCanonicalOpenId),
          eq(persistentOperatorIdentityBindings.active, true)
        )
      );
    const aliasAsCanonical = await tx
      .select()
      .from(persistentOperatorIdentityBindings)
      .where(
        and(
          eq(persistentOperatorIdentityBindings.tenantId, tenantId),
          eq(persistentOperatorIdentityBindings.canonicalOpenId, persistedAliasOpenId),
          eq(persistentOperatorIdentityBindings.active, true)
        )
      );

    if (
      active.some(
        binding =>
          binding.canonicalOpenId !== persistedCanonicalOpenId ||
          binding.surface !== input.surface
      ) ||
      canonicalAsAlias.some(
        binding => binding.canonicalOpenId !== persistedCanonicalOpenId
      ) ||
      aliasAsCanonical.length > 0
    ) {
      throw new CanonicalOperatorIdentityError("identity_ambiguous");
    }
    if (active[0]) return active[0];

    const row: OperatorIdentityBinding = {
      id: randomUUID(),
      tenantId,
      canonicalOpenId: persistedCanonicalOpenId,
      aliasOpenId: persistedAliasOpenId,
      activeAliasKey: `${tenantId}:${persistedAliasOpenId}`,
      surface: input.surface,
      active: true,
      createdByOpenId: input.createdByOpenId,
      revokedAt: null,
    };
    await tx.insert(persistentOperatorIdentityBindings).values(row);
    return row;
  });

}

export async function revokeOperatorIdentityAlias(input: {
  tenantId: string;
  bindingId: string;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db
    .update(persistentOperatorIdentityBindings)
    .set({
      active: false,
      activeAliasKey: null,
      revokedAt: new Date(),
    })
    .where(
      and(
        eq(persistentOperatorIdentityBindings.tenantId, input.tenantId),
        eq(persistentOperatorIdentityBindings.id, input.bindingId),
        eq(persistentOperatorIdentityBindings.active, true)
      )
    );
  return Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) > 0;
}
