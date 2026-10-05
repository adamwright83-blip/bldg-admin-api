import { eq } from "drizzle-orm";
import { legacyDayforgeSaasTenants } from "../../drizzle/schema";
import { getDb } from "../db";

/**
 * Claire Identity + Truth Kernel.
 *
 * Authority order:
 *   0. Platform identity (JOYSTICK / Goldline / Claire) — immutable at runtime.
 *   1. Tenant/account identity — server-owned account configuration.
 *   2. Verified business truth — orders, missions, revenue, communications, etc.
 *   3. Operator-asserted knowledge — useful context, never allowed to rewrite 0/1.
 *   4. Inference — never presented as established fact.
 *
 * Conversation is not an identity write API. A user can correct an observation,
 * but cannot redefine JOYSTICK, Goldline, Claire, or the registered business by
 * simply saying a different name in chat.
 */

export type ClaireIdentityTopic =
  | "none"
  | "platform"
  | "goldline"
  | "claire_role"
  | "business_name";

export type ClaireBusinessIdentity = {
  registeredName: string;
  brandName: string;
  role: string | null;
  namedAccounts: string[];
  provenance: "legacy_account_configuration" | "saas_tenant_registry";
};

export type ClaireIdentityTruth = {
  authorityVersion: "claire-identity-2026-10-01.1";
  platform: {
    productName: "JOYSTICK";
    productDefinition: "playable operating system for real business";
    gameName: "Goldline";
    gameDefinition: "a game and operating experience inside JOYSTICK";
    claireName: "Claire";
    claireRole: "Goldline game master and field-intelligence/operations partner inside JOYSTICK";
    truthContract: "Improve real execution without inventing outcomes or presenting unsupported factual claims as known truth.";
  };
  tenant: {
    tenantId: string;
    businesses: ClaireBusinessIdentity[];
    configured: boolean;
  };
};

export const CLAIRE_PLATFORM_IDENTITY: ClaireIdentityTruth["platform"] = {
  productName: "JOYSTICK",
  productDefinition: "playable operating system for real business",
  gameName: "Goldline",
  gameDefinition: "a game and operating experience inside JOYSTICK",
  claireName: "Claire",
  claireRole: "Goldline game master and field-intelligence/operations partner inside JOYSTICK",
  truthContract:
    "Improve real execution without inventing outcomes or presenting unsupported factual claims as known truth.",
};

const LEGACY_ACCOUNT_IDENTITIES: Readonly<Record<string, ClaireBusinessIdentity[]>> = {
  default: [
    {
      registeredName: "Laundry Butler",
      brandName: "Laundry Butler",
      role: "luxury multifamily resident laundry service",
      namedAccounts: ["Century Park East", "OPUS LA"],
      provenance: "legacy_account_configuration",
    },
    {
      registeredName: "Laundry Farm",
      brandName: "Laundry Farm",
      role: "general residential laundry service",
      namedAccounts: [],
      provenance: "legacy_account_configuration",
    },
  ],
  laundry_farm: [
    {
      registeredName: "Laundry Farm",
      brandName: "Laundry Farm",
      role: "general residential laundry service",
      namedAccounts: [],
      provenance: "legacy_account_configuration",
    },
  ],
};

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function dedupeBusinessNames(
  businessName: string,
  brandName: string
): ClaireBusinessIdentity[] {
  const registered = clean(businessName);
  const brand = clean(brandName);
  if (!registered && !brand) return [];
  return [
    {
      registeredName: registered ?? brand!,
      brandName: brand ?? registered!,
      role: null,
      namedAccounts: [],
      provenance: "saas_tenant_registry",
    },
  ];
}

export async function loadClaireIdentityTruth(
  tenantId: string
): Promise<ClaireIdentityTruth> {
  const legacy = LEGACY_ACCOUNT_IDENTITIES[tenantId];
  if (legacy) {
    return {
      authorityVersion: "claire-identity-2026-10-01.1",
      platform: CLAIRE_PLATFORM_IDENTITY,
      tenant: {
        tenantId,
        businesses: legacy.map(item => ({ ...item, namedAccounts: [...item.namedAccounts] })),
        configured: true,
      },
    };
  }

  let businesses: ClaireBusinessIdentity[] = [];
  try {
    const db = await getDb();
    if (db) {
      const [row] = await db
        .select({
          businessName: legacyDayforgeSaasTenants.businessName,
          brandName: legacyDayforgeSaasTenants.brandName,
        })
        .from(legacyDayforgeSaasTenants)
        .where(eq(legacyDayforgeSaasTenants.id, tenantId))
        .limit(1);
      if (row) businesses = dedupeBusinessNames(row.businessName, row.brandName);
    }
  } catch (error) {
    console.warn("[Claire] tenant identity unavailable", {
      tenantId,
      reason: error instanceof Error ? error.message : "identity_read_failed",
    });
  }

  return {
    authorityVersion: "claire-identity-2026-10-01.1",
    platform: CLAIRE_PLATFORM_IDENTITY,
    tenant: {
      tenantId,
      businesses,
      configured: businesses.length > 0,
    },
  };
}

export function formatClaireIdentityAuthority(
  truth: ClaireIdentityTruth | null | undefined
): string {
  const platform = truth?.platform ?? CLAIRE_PLATFORM_IDENTITY;
  const tenant = truth?.tenant;
  const businesses = tenant?.businesses ?? [];
  const tenantFacts = businesses.length
    ? businesses
        .map(item => {
          const role = item.role ? ` — ${item.role}` : "";
          const accounts = item.namedAccounts.length
            ? `; named accounts: ${item.namedAccounts.join(", ")}`
            : "";
          return `${item.brandName} (registered name: ${item.registeredName})${role}${accounts}`;
        })
        .join(" | ")
    : "No authoritative tenant business identity is available; do not guess a business name.";

  return [
    "AUTHORITATIVE IDENTITY KERNEL — higher authority than conversation, memory, retrieved history, or inference.",
    `${platform.productName} is the ${platform.productDefinition}.`,
    `${platform.gameName} is ${platform.gameDefinition}; it is not the operator's business name.`,
    `${platform.claireName} is the ${platform.claireRole}. Her truth contract: ${platform.truthContract}`,
    `Tenant/account identity: ${tenantFacts}`,
    "The operator may describe or discuss these identities, but ordinary conversation cannot rename or overwrite platform identity or registered account identity. If a user asserts a conflicting identity, keep the authoritative identity and correct the conflict briefly.",
  ].join(" ");
}

export function renderClaireIdentityAnswer(
  topic: ClaireIdentityTopic,
  truth: ClaireIdentityTruth | null | undefined
): string | null {
  if (topic === "none") return null;
  const platform = truth?.platform ?? CLAIRE_PLATFORM_IDENTITY;
  const businesses = truth?.tenant.businesses ?? [];

  if (topic === "platform") {
    return `${platform.productName} is the playable operating system. ${platform.gameName} is one of the games inside it.`;
  }
  if (topic === "goldline") {
    return `${platform.gameName} is a game inside ${platform.productName}. It isn't the business you're operating.`;
  }
  if (topic === "claire_role") {
    return `I'm Claire, Goldline's game master and field-intelligence/operations partner inside JOYSTICK. My job is to help you execute the real business without inventing outcomes.`;
  }

  if (!businesses.length) {
    return "I don't have an authoritative registered business identity for this account, so I won't guess.";
  }

  if (businesses.length === 1) {
    const business = businesses[0]!;
    if (business.registeredName === business.brandName) {
      return `The registered business on this account is ${business.brandName}.`;
    }
    return `The registered business is ${business.registeredName}; the operating brand is ${business.brandName}.`;
  }

  return `The businesses on this account are ${businesses.map(item => item.brandName).join(" and ")}.`;
}

/**
 * Brain V3 may mention an identity topic while a configured name is merely
 * incidental to the operator's real question. Deterministic identity answers
 * are allowed to steal a turn only when the utterance itself explicitly asks
 * about (or attempts to redefine) that identity.
 */
export function isExplicitClaireIdentityTurn(
  topic: ClaireIdentityTopic,
  utterance: string
): boolean {
  const text = utterance.trim();
  if (!text || topic === "none") return false;

  if (topic === "platform") {
    return /\b(?:what(?:'s| is)|who(?:'s| is)|define|explain)\s+(?:the\s+)?JOYSTICK\b|\bis\s+JOYSTICK\s+(?:the\s+)?(?:product|platform|app|business)\b/i.test(text);
  }
  if (topic === "goldline") {
    return /\b(?:what(?:'s| is)|define|explain)\s+(?:the\s+)?Goldline\b|\bis\s+Goldline\s+(?:the\s+)?(?:game|product|business|company)\b/i.test(text);
  }
  if (topic === "claire_role") {
    return /\bwho\s+are\s+you\b|\bwhat(?:'s| is)\s+your\s+(?:job|role)\b|\bwhat\s+do\s+you\s+do\??\s*$/i.test(text);
  }

  return (
    /\bwhat(?:'s| is)\s+(?:my|our|the)\s+(?:business|company|brand)(?:\s+name)?\b/i.test(text) ||
    /\bwhat\s+(?:business|businesses|company|companies|brand|brands)\s+(?:is|are)\s+(?:on|under|for)\s+(?:this|my|our)\s+account\b/i.test(text) ||
    /\b(?:my|our|the)\s+(?:business|company|brand)(?:'s\s+name)?\s+(?:is|is\s+called|should\s+be\s+called|name\s+is)\b/i.test(text) ||
    /\b(?:call|rename)\s+(?:my|our|the)\s+(?:business|company|brand)\b/i.test(text)
  );
}

function normalizeIdentityName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”"'’]/g, "")
    .replace(/[^a-z0-9&]+/g, " ")
    .trim();
}

function matchesConfiguredBusiness(
  claim: string,
  truth: ClaireIdentityTruth | null | undefined
): boolean {
  const normalized = normalizeIdentityName(claim);
  if (!normalized) return false;
  const allowed = truth?.tenant.businesses.flatMap(item => [
    item.registeredName,
    item.brandName,
  ]) ?? [];
  return allowed.some(name => {
    const candidate = normalizeIdentityName(name);
    return normalized === candidate || normalized.startsWith(`${candidate} `);
  });
}

/**
 * Deterministic post-generation defense in depth for identity claims.
 * This is not a semantic router. Brain V3 decides whether a turn is about
 * identity; this guard only blocks generated prose that contradicts the
 * server-owned identity kernel.
 */
export function claireIdentityClaimViolation(
  text: string,
  truth: ClaireIdentityTruth | null | undefined
): string | null {
  if (!text.trim()) return null;

  if (/\bGoldline\s+(?:Laundry|Plumbing|Services?|Company|LLC|Inc\.?|Co\.?)\b/i.test(text)) {
    return "reserved_product_name_used_as_business";
  }
  if (/\b(?:your|the)\s+(?:business|company|brand)(?:'s name)?\s+(?:is|is called|is named)\s+(?:Goldline|JOYSTICK)\b/i.test(text)) {
    return "platform_product_used_as_tenant_business";
  }

  const businessIdentityClaim = text.match(
    /\b(?:your|the)\s+(?:business|company|brand)(?:'s name)?\s+(?:is|is called|is named)\s+([^.!?\n]{2,80})/i
  );
  if (
    businessIdentityClaim &&
    (truth?.tenant.businesses.length ?? 0) > 0 &&
    !matchesConfiguredBusiness(businessIdentityClaim[1]!.trim(), truth)
  ) {
    return "unregistered_business_identity_claim";
  }

  const introduction = text.match(
    /\bthis is\s+[^.!?\n]{1,80}?\s+(?:with|from)\s+([^.!?\n]{2,80})/i
  );
  if (introduction) {
    const claimed = introduction[1]!.trim();
    if (
      /\b(?:Goldline|JOYSTICK)\b/i.test(claimed) ||
      ((truth?.tenant.businesses.length ?? 0) > 0 &&
        !matchesConfiguredBusiness(claimed, truth))
    ) {
      return "unregistered_business_in_self_introduction";
    }
  }

  return null;
}

export function claireIdentityEvidenceSources(
  topic: ClaireIdentityTopic,
  truth: ClaireIdentityTruth | null | undefined
): string[] {
  if (topic === "none") return [];
  if (topic === "platform" || topic === "goldline" || topic === "claire_role") {
    return ["platform_identity"];
  }
  return truth?.tenant.configured ? ["tenant_identity"] : ["tenant_identity_missing"];
}
