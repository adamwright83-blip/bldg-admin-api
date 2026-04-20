import { BUILDINGS, type BuildingConfig } from "@shared/buildings";
import { TENANT_CONFIG, type TenantId } from "@shared/tenantConfig";
import { invokeLLM, type InvokeResult } from "./_core/llm";
import {
  describeViolations,
  sanitizeCopy,
  type SanitizerInputContext,
  type SanitizeViolation,
} from "./level4OffensiveCopySanitizer";

/**
 * SYSTEM PROMPT — sent verbatim with every Level 4 LLM copy-generation call.
 * Single source of truth: do not duplicate this string in tests / scripts —
 * import it instead so any change is reflected everywhere.
 *
 * Only SMS-deliverable blocks reach the LLM. Card-deliverable blocks take the
 * deterministic template path in `buildDeterministicCardCopy` and never prompt.
 */
export const LEVEL4_COPY_SYSTEM_PROMPT = `You are an outreach copywriter for an internal sales-operations dashboard at a building-services startup (laundry, dry cleaning, alterations).

Your output is reviewed by a human admin before any message is sent. Never address the customer directly in narration; produce only the assets the admin asked for.

Voice:
- Confident, plain, specific. Sound like a senior operator, not a marketer.
- No emojis. No exclamation marks. No superlatives ("amazing", "incredible"). No filler adjectives.
- Reference the exact numbers and names you are given. Do not invent figures.
- For SMS, write under 160 characters, conversational, signed informally as "bldg".

ABSOLUTE NEGATIVE CONSTRAINTS — these are non-negotiable:
- DO NOT invent offers, discounts, percentages off, free pickups, free first orders, trials, credits, or any incentive of any kind.
- DO NOT invent promo codes, coupon codes, or referral codes.
- DO NOT invent pricing claims (per-pound rates, flat rates, comparisons to competitors).
- DO NOT invent operational claims not present in the payload (turnaround times, vendor names, service guarantees, hours, coverage).
- If promo data, pricing, or any specific offer is not explicitly provided in the input payload, do not mention any offer. Write the message without one.
- DO NOT output \`[link]\`, \`[url]\`, \`[name]\`, or any bracketed placeholder tokens. If a link or value is not in the payload, omit it entirely and phrase the message so it still reads naturally.
- DO NOT make claims about how many neighbors are using the service unless that exact figure is in the payload.
- DO NOT state UX timing claims such as "takes 2 minutes", "in seconds", "instantly", or "quickly" unless that exact timing is provided in the payload.
- DO NOT make qualitative social-proof claims such as "your neighbors are using", "neighbors already signed up", "join your neighbors", or "residents are using" unless the exact count or phrasing is explicitly supported by the payload. The word "neighbors" in social-proof framing is forbidden unless the payload explicitly authorizes it.
- DO NOT mention specific service categories (laundry, wash & fold, dry cleaning, alterations, tailoring, hemming, etc.) unless that exact service category is explicitly provided in the payload for that block. Use generic phrasing like "our service" or "our building service" instead.
- DO NOT mention specific service-delivery mechanics such as "pickup", "delivery", "pickup and delivery", "doorstep", "drop-off", "contactless", "at your door", or "curbside" unless that exact mechanic is explicitly provided in the payload. Default to generic framing like "our service" or "our building service" with no mechanic specified.
- If a fact is not in the payload, omit it. When in doubt, write less. A short message that names only the building, the resident, and the count is always preferable to a longer one that invents detail.

Output strictly the four fields requested:
- headline: <= 10 words, dashboard tile label, no period.
- body: 2 sentences max, briefs the admin on what this opportunity is and why it scores high right now. Reference the data.
- primaryCopy: the actual outbound SMS draft the admin will review before sending.
- internalNote: one short tactical note (<= 20 words) for the admin — what to watch for, what to follow up with.`;

const COPY_OUTPUT_SCHEMA = {
  name: "level4_outreach_copy",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["headline", "body", "primaryCopy", "internalNote"],
    properties: {
      headline: { type: "string", minLength: 3, maxLength: 80 },
      body: { type: "string", minLength: 10, maxLength: 600 },
      primaryCopy: { type: "string", minLength: 10, maxLength: 320 },
      internalNote: { type: "string", minLength: 5, maxLength: 240 },
    },
  },
} as const;

export type BuildingDeliverable = "sms" | "card";

export type GeneratedCopy = {
  headline: string;
  body: string;
  /**
   * Deliverable-specific actionable copy.
   * - `deliverable: "sms"` — the SMS message draft.
   * - `deliverable: "card"` — the footer line (phone · URL) for the printed card.
   */
  primaryCopy: string;
  internalNote: string;
  deliverable: BuildingDeliverable;
  /** Brand this copy was generated for. Frozen at generation time; preview toggle regenerates. */
  brandId: TenantId;
};

export type BuildingPenetrationCopyInput = {
  block: "building_penetration";
  brand: TenantId;
  payload: {
    buildingSlug: string;
    buildingName: string;
    convertedUsers: number;
    convertedPaidUsers: number;
    total: number;
    unconverted: number;
    penetrationPct: number;
    paidPenetrationPct: number;
  };
};

export type ReferralRequestCopyInput = {
  block: "referral_request";
  brand: TenantId;
  payload: {
    firstName: string;
    lastInitial: string;
    orderCount: number;
    ltvCents: number;
  };
};

export type MarketHoleCopyInput = {
  block: "market_hole";
  brand?: TenantId;
  payload: Record<string, never>;
};

export type GenerateOffensiveCopyInput =
  | BuildingPenetrationCopyInput
  | ReferralRequestCopyInput
  | MarketHoleCopyInput;

export type GenerateOffensiveCopyOutput =
  | { block: "building_penetration"; copy: GeneratedCopy }
  | { block: "referral_request"; copy: GeneratedCopy }
  | { block: "market_hole"; status: "stubbed_for_v1"; copy: null };

function getMessageText(result: InvokeResult): string {
  const raw = result.choices[0]?.message?.content;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: string }).text) : ""))
      .join("");
  }
  return "";
}

function dollarsFromCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function resolveBrand(brandId: TenantId): {
  id: TenantId;
  name: string;
  phone: string;
  websiteUrl: string;
} {
  const t = TENANT_CONFIG[brandId];
  return {
    id: t.id,
    name: t.brandName,
    phone: t.supportPhone,
    websiteUrl: t.hostname,
  };
}

function findBuilding(slug: string): BuildingConfig | undefined {
  return BUILDINGS.find((b) => b.slug === slug);
}

function resolveDeliverable(slug: string): BuildingDeliverable {
  return findBuilding(slug)?.deliverable ?? "sms";
}

/**
 * Deterministic card template. No LLM, no sanitizer. Used when a building's
 * `deliverable` is "card" — currently only Century Park East. Returns copy
 * that satisfies the card-size rules up front: 1 offer, 1 CTA, 1 proof,
 * headline ≤12 words, body ≤24 words. Any change to wording should preserve
 * those caps.
 */
function buildDeterministicCardCopy(
  buildingSlug: string,
  brand: ReturnType<typeof resolveBrand>
): GeneratedCopy | null {
  if (buildingSlug === "centuryparkeast") {
    const building = findBuilding(buildingSlug);
    const buildingName = building?.name ?? "Century Park East";
    return {
      headline: "Share our service with a neighbor and get 30% off your next order.",
      body:
        "If they place an order, have them mention your name — or text us first and we'll make sure your 30% is applied.",
      primaryCopy: `${brand.phone} · ${brand.websiteUrl}`,
      internalNote: `Use as a handoff card or attach to completed orders for ${buildingName} customers. Do not use as unsolicited resident outreach.`,
      deliverable: "card",
      brandId: brand.id,
    };
  }
  return null;
}

function buildUserPromptForBuildingPenetration(
  p: BuildingPenetrationCopyInput["payload"],
  brand: ReturnType<typeof resolveBrand>
): string {
  return [
    `Brand: ${brand.name} (phone ${brand.phone}, web ${brand.websiteUrl})`,
    `Block: BUILDING PENETRATION`,
    `Building: ${p.buildingName} (slug=${p.buildingSlug})`,
    `Total units in building: ${p.total}`,
    `Signed-up residents (any account): ${p.convertedUsers} (${p.penetrationPct}% of building)`,
    `Paying residents (≥1 paid order): ${p.convertedPaidUsers} (${p.paidPenetrationPct}% of building)`,
    `Unconverted residents (estimate): ${p.unconverted}`,
    ``,
    `Task: produce outreach copy for a building-penetration campaign — getting more residents in this building to sign up and place a first order. The dashboard tile is for the admin; the primaryCopy field is the SMS draft the admin will (after review) send to a building-wide list or to property-management contacts.`,
  ].join("\n");
}

function buildUserPromptForReferralRequest(
  p: ReferralRequestCopyInput["payload"],
  brand: ReturnType<typeof resolveBrand>
): string {
  return [
    `Brand: ${brand.name} (phone ${brand.phone}, web ${brand.websiteUrl})`,
    `Block: REFERRAL REQUEST`,
    `Customer: ${p.firstName} ${p.lastInitial}.`,
    `Lifetime paid orders: ${p.orderCount}`,
    `Lifetime value: ${dollarsFromCents(p.ltvCents)}`,
    ``,
    `Task: produce outreach copy for a personal referral ask. The dashboard tile briefs the admin; the primaryCopy field is the SMS draft the admin will (after review) send directly to this customer asking them to refer a neighbor or friend. Address the customer by first name in the SMS only.`,
  ].join("\n");
}

type LLMCopy = { headline: string; body: string; primaryCopy: string; internalNote: string };

async function callLLMOnce(userPrompt: string): Promise<LLMCopy> {
  const result = await invokeLLM({
    messages: [
      { role: "system", content: LEVEL4_COPY_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    outputSchema: COPY_OUTPUT_SCHEMA,
    maxTokens: 1024,
  });

  const text = getMessageText(result);
  if (!text.trim()) {
    throw new Error("Level 4 copy: empty model output after Anthropic tool_use.");
  }
  let parsed: LLMCopy;
  try {
    parsed = JSON.parse(text) as LLMCopy;
  } catch {
    throw new Error(
      `Level 4 copy returned invalid JSON (first 240 chars): ${text.slice(0, 240)}`
    );
  }
  if (
    typeof parsed.headline !== "string" ||
    typeof parsed.body !== "string" ||
    typeof parsed.primaryCopy !== "string" ||
    typeof parsed.internalNote !== "string"
  ) {
    throw new Error("Level 4 copy missing required fields (headline/body/primaryCopy/internalNote).");
  }
  return parsed;
}

function buildRetryPrompt(originalPrompt: string, violations: SanitizeViolation[]): string {
  return [
    originalPrompt,
    ``,
    `PRIOR ATTEMPT REJECTED by deterministic safety sanitizer for these violations:`,
    describeViolations(violations),
    ``,
    `Regenerate every field. Do not include any of the matched phrases or anything similar.`,
    `Reference only facts that appear in the payload above. When in doubt, omit the claim.`,
  ].join("\n");
}

export async function generateOffensiveCopy(
  input: GenerateOffensiveCopyInput
): Promise<GenerateOffensiveCopyOutput> {
  if (input.block === "market_hole") {
    return { block: "market_hole", status: "stubbed_for_v1", copy: null };
  }

  const brand = resolveBrand(input.brand);

  // Card-deliverable: deterministic template, no LLM, no sanitizer.
  if (input.block === "building_penetration") {
    const deliverable = resolveDeliverable(input.payload.buildingSlug);
    if (deliverable === "card") {
      const card = buildDeterministicCardCopy(input.payload.buildingSlug, brand);
      if (!card) {
        throw new Error(
          `Level 4 card copy: no deterministic template registered for building slug "${input.payload.buildingSlug}".`
        );
      }
      return { block: "building_penetration", copy: card };
    }
  }

  const userPrompt =
    input.block === "building_penetration"
      ? buildUserPromptForBuildingPenetration(input.payload, brand)
      : buildUserPromptForReferralRequest(input.payload, brand);

  // Per-block allowed lists for the sanitizer. Current payloads carry no
  // service-category or timing fields, so both are empty — the model may not
  // mention any service category or timing claim. When a future payload adds
  // an explicit field (e.g. payload.serviceCategory), populate the relevant
  // array here so legitimate claims pass through.
  const sanitizerCtx: SanitizerInputContext = {
    allowedServiceCategories: [],
    allowedTimingPhrases: [],
  };

  let llmCopy = await callLLMOnce(userPrompt);
  let result = sanitizeCopy(llmCopy, sanitizerCtx);
  if (!result.ok) {
    const retryPrompt = buildRetryPrompt(userPrompt, result.violations);
    llmCopy = await callLLMOnce(retryPrompt);
    result = sanitizeCopy(llmCopy, sanitizerCtx);
    if (!result.ok) {
      throw new Error(
        "Level 4 copy failed safety sanitization after one re-prompt. Violations: " +
          result.violations
            .map((v) => `${v.field}/${v.rule}/"${v.match}"`)
            .join("; ")
      );
    }
  }

  const copy: GeneratedCopy = {
    headline: llmCopy.headline,
    body: llmCopy.body,
    primaryCopy: llmCopy.primaryCopy,
    internalNote: llmCopy.internalNote,
    deliverable: "sms",
    brandId: brand.id,
  };
  return { block: input.block, copy };
}
