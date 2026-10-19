/**
 * Playable Villager Collaborative Letter Desk & Neighborhood Experience
 * Phase 3 Specification — Silver Lake Playable Outreach
 *
 * Provides:
 * - Distinct villager personalities (Fox Barnaby/Mei vs Badger Bramble, etc.)
 * - Grounded letter approach variations (Warm & Brief, Helpful & Detailed, Cozy Care)
 * - Dynamic reactive dialogue and gestures responding to player decisions
 * - Persistent neighborhood consequence choices (Courtyard Tea Table vs Garden Bench)
 * - Witnessed interaction memory across visits
 * - Isolated synthetic test preview targets covering all 8 realistic outreach states
 */

import {
  type CozyCustomerTarget,
  type CozySlotId,
  type VillagerAnimationState,
  type VillagerVariant,
  COZY_SLOT_ANCHORS,
} from "./cozyVillagerOutreach";
import {
  type CozyCommunicationState,
  type CozyProjectedTarget,
  type CozyReplyProjection,
  type CozyPaidOrderProjection,
} from "./cozyVillagerEvidence";
import {
  projectSilverLakeOutreachStatus,
  type SilverLakeOutreachSnapshot,
} from "./silverLakeOutreachStatus";

export type LetterApproachId =
  | "warm_brief"
  | "helpful_detailed"
  | "cozy_care_perk"
  | "custom";

export interface LetterApproachOption {
  id: LetterApproachId;
  label: string;
  icon: string;
  summary: string;
  generateText: (target: CozyCustomerTarget, tenantId?: string | null) => string;
}

/**
 * Resolves the authorized business brand name for customer-facing communication.
 * Silver Lake recovery is strictly a Laundry Farm mission. Never hardcodes Laundry Butler.
 */
export function businessNameForTenant(tenantId?: string | null): string {
  if (tenantId === "default" || tenantId === "laundry_butler") {
    return "Laundry Butler";
  }
  return "Laundry Farm";
}

/**
 * Standard outreach approaches grounded strictly in genuine customer facts.
 * Every option preserves the customer's name and lapsed cadence honestly.
 */
export const LETTER_APPROACHES: Record<LetterApproachId, LetterApproachOption> = {
  warm_brief: {
    id: "warm_brief",
    label: "Warm & Brief",
    icon: "🌿",
    summary: "Concise, friendly check-in that gets straight to the point.",
    generateText: (target, tenantId) => {
      const firstName = target.displayName.split(" ")[0];
      const business = businessNameForTenant(tenantId);
      return `Hi ${firstName}, hope you're having a wonderful week in ${target.territoryName}! We noticed it's been ${target.daysSinceLastOrder} days since your last order with ${business}. We're here whenever you'd like a pickup!`;
    },
  },
  helpful_detailed: {
    id: "helpful_detailed",
    label: "Helpful & Detailed",
    icon: "📖",
    summary: "Personalized touch mentioning their past care and service cadence.",
    generateText: (target, tenantId) => {
      const firstName = target.displayName.split(" ")[0];
      const business = businessNameForTenant(tenantId);
      const serviceDetail = target.lastOrderSummary
        ? ` with your ${target.lastOrderSummary.toLowerCase()}`
        : "";
      return `Hi ${firstName}, checking in from ${business}! It's been ${target.daysSinceLastOrder} days since we last cared for your laundry${serviceDetail}. We'd love to help take care of your linens for the upcoming week whenever you're ready.`;
    },
  },
  cozy_care_perk: {
    id: "cozy_care_perk",
    label: "Cozy Care Perk",
    icon: "🎁",
    summary: "Warm invitation focusing on free door-to-door convenience.",
    generateText: (target, tenantId) => {
      const firstName = target.displayName.split(" ")[0];
      const business = businessNameForTenant(tenantId);
      return `Hi ${firstName}! Your friends at ${business} in ${target.territoryName} are thinking of you. It's been ${target.daysSinceLastOrder} days since your last fresh fold — schedule your next pickup anytime and let us handle the rest!`;
    },
  },
  custom: {
    id: "custom",
    label: "Custom Quill",
    icon: "✍️",
    summary: "Direct personal wording edited by you or dictated via voice.",
    generateText: (target) => {
      return target.suggestedMessage;
    },
  },
};

export type VillagerPersonalityStyle = "enthusiastic" | "concise" | "balanced";

export interface VillagerPersonality {
  variant: VillagerVariant;
  canonicalName: string;
  title: string;
  style: VillagerPersonalityStyle;
  portraitSrc: string;
  firstEncounterGreeting: (customerName: string) => string;
  repeatEncounterGreeting: (customerName: string, memoryNote?: string | null) => string;
  reactionToApproach: (approach: LetterApproachId, text: string) => {
    pose: VillagerAnimationState;
    dialogue: string;
    glyph: string;
  };
  reactionToSchedule: (timeLabel: string) => {
    pose: VillagerAnimationState;
    dialogue: string;
    glyph: string;
  };
  reactionToCommit: (actionType: "send" | "schedule" | "sms_opened") => {
    pose: VillagerAnimationState;
    dialogue: string;
    glyph: string;
  };
}

/**
 * Two distinct character experiences:
 * Character A: Fox (Barnaby / Mei) — Enthusiastic, warm, expressive, loves personal detail.
 * Character B: Badger (Bramble) — Wonderfully dry, concise, pragmatic, values brevity and speed.
 */
export const VILLAGER_PERSONALITIES: Record<string, VillagerPersonality> = {
  fox: {
    variant: "fox",
    canonicalName: "Barnaby the Fox",
    title: "Upper Two-Story Cottage Keeper",
    style: "enthusiastic",
    portraitSrc: "/assets/lantern-villager-outreach/villagers/animations/fox-idle.png",
    firstEncounterGreeting: (customerName) =>
      `Oh hello! I'm Barnaby. I keep the hearth warm and the letters heartfelt here in Silver Lake. Let's write something lovely for ${customerName}!`,
    repeatEncounterGreeting: (customerName, memoryNote) =>
      memoryNote
        ? `Welcome back! ${memoryNote} Ready to craft another warm note for ${customerName}!`
        : `Back at the writing desk! Ready to craft another warm note for ${customerName}.`,
    reactionToApproach: (approach, text) => {
      switch (approach) {
        case "helpful_detailed":
          return {
            pose: "wave",
            dialogue:
              "Oh, I love this one! Mentioning their past service shows how much we care about their home. It feels like a hug in an envelope! ❤️",
            glyph: "✨❤️",
          };
        case "warm_brief":
          return {
            pose: "selected",
            dialogue:
              "Brisk and cheerful! Gets straight to the point while still sharing some Silver Lake sunshine. ☀️",
            glyph: "🌿",
          };
        case "cozy_care_perk":
          return {
            pose: "wave",
            dialogue:
              "A delightful hospitality note! Reminding them of the convenience makes taking laundry off their plate feel effortless! 🎁",
            glyph: "🏮🎁",
          };
        case "custom":
        default:
          return {
            pose: "selected",
            dialogue:
              text.length > 250
                ? "You've written so much care into this! Every word feels heartfelt."
                : "Personal pen strokes are the most genuine. I love hearing your own voice in this!",
            glyph: "✍️",
          };
      }
    },
    reactionToSchedule: (timeLabel) => ({
      pose: "wave",
      dialogue: `Wonderful! I'll place this letter on the dispatch shelf for ${timeLabel}. Remember: when that time comes, open Google Messages on your phone to send it from your personal number. No automatic delivery here!`,
      glyph: "⏰🏮",
    }),
    reactionToCommit: (actionType) => {
      switch (actionType) {
        case "send":
          return {
            pose: "acknowledged",
            dialogue:
              "Dispatched! A warm personal note is on its way. Let's celebrate caring for our neighbors! 🏮✨",
            glyph: "✨🏮",
          };
        case "schedule":
          return {
            pose: "acknowledged",
            dialogue:
              "Tucked safely on the dispatch shelf! When the scheduled hour arrives, open Google Messages on your handset to send from your personal number.",
            glyph: "⏰✨",
          };
        case "sms_opened":
          return {
            pose: "wave",
            dialogue:
              "Opened in your Messages app! Send it whenever you're ready — I'll keep your spot right here.",
            glyph: "📱",
          };
      }
    },
  },

  badger: {
    variant: "badger",
    canonicalName: "Bramble the Badger",
    title: "Lower Stone Cottage Craftsman",
    style: "concise",
    portraitSrc: "/assets/lantern-villager-outreach/villagers/animations/badger-idle.png",
    firstEncounterGreeting: (customerName) =>
      `Bramble. Lower cottage. Customers don't want a novel; they want clean clothes and zero fuss. Let's make this quick for ${customerName}.`,
    repeatEncounterGreeting: (customerName, memoryNote) =>
      memoryNote
        ? `You again. Good. ${memoryNote} Let's keep ${customerName}'s note under forty words.`
        : `You again. Good. Let's get ${customerName}'s message done in under forty words.`,
    reactionToApproach: (approach, text) => {
      switch (approach) {
        case "warm_brief":
          return {
            pose: "wave",
            dialogue:
              "Now that's a proper message. Respects their time. Send it before we start adding extra adjectives.",
            glyph: "👍",
          };
        case "helpful_detailed":
          return {
            pose: "selected",
            dialogue:
              "Two whole sentences? Well... at least you cited their last care summary. Don't go adding exclamation marks.",
            glyph: "👓",
          };
        case "cozy_care_perk":
          return {
            pose: "selected",
            dialogue:
              "Sensible incentive. Clean clothes are better than promises anyway. Let's get it out the door.",
            glyph: "📦",
          };
        case "custom":
        default:
          return {
            pose: "selected",
            dialogue:
              text.length > 200
                ? "Careful now. The longer the text, the less people read. Keep it sharp."
                : "Straightforward and honest. That's the way to do it.",
            glyph: "✍️",
          };
      }
    },
    reactionToSchedule: (timeLabel) => ({
      pose: "wave",
      dialogue: `${timeLabel}. On the shelf it goes. Remember: at that time, you open Google Messages on your handset to tap send yourself. No magic automated texting.`,
      glyph: "⏰",
    }),
    reactionToCommit: (actionType) => {
      switch (actionType) {
        case "send":
          return {
            pose: "acknowledged",
            dialogue:
              "Recorded and handled. Clean, fast, zero nonsense. Next task.",
            glyph: "✓",
          };
        case "schedule":
          return {
            pose: "acknowledged",
            dialogue:
              "Locked on the dispatch shelf. Remember: when the clock strikes, you still have to open Google Messages on your handset and send it yourself. No automatic texts.",
            glyph: "⏰",
          };
        case "sms_opened":
          return {
            pose: "wave",
            dialogue:
              "Sent to your handset. Review it and tap send from your own phone when ready.",
            glyph: "📱",
          };
      }
    },
  },

  // Fallback personality for other villagers (Bunny, Otter, etc.)
  bunny: {
    variant: "bunny",
    canonicalName: "Bella the Bunny",
    title: "Garden Cottage Host",
    style: "balanced",
    portraitSrc: "/assets/lantern-villager-outreach/villagers/animations/bunny-idle.png",
    firstEncounterGreeting: (customerName) =>
      `Hi there! I'm Bella. I love seeing friendly notes brighten someone's day. Let's write a sweet note for ${customerName}!`,
    repeatEncounterGreeting: (customerName, memoryNote) =>
      memoryNote
        ? `Hello again! ${memoryNote} Let's check in with ${customerName}.`
        : `Hello again! Ready to check in with ${customerName}.`,
    reactionToApproach: (approach) => ({
      pose: "wave",
      dialogue:
        approach === "warm_brief"
          ? "Short and sweet! Perfect for a busy day."
          : "Thoughtful and kind. This will bring a smile!",
      glyph: "🌸",
    }),
    reactionToSchedule: (timeLabel) => ({
      pose: "wave",
      dialogue: `Placed on the dispatch shelf for ${timeLabel}! When it's time, remember to open Google Messages on your phone to send it from your personal number.`,
      glyph: "⏰🌸",
    }),
    reactionToCommit: () => ({
      pose: "acknowledged",
      dialogue: "Done! Thank you for taking such good care of our Silver Lake neighbors! 🌸",
      glyph: "🌸✨",
    }),
  },
};

export function getVillagerPersonality(variant: VillagerVariant): VillagerPersonality {
  if (VILLAGER_PERSONALITIES[variant]) {
    return VILLAGER_PERSONALITIES[variant];
  }
  // Default to Fox for canine/feline/otter variants, Badger for hedgehog/squirrel
  if (variant === "hedgehog" || variant === "squirrel") {
    return {
      ...VILLAGER_PERSONALITIES.badger,
      variant,
      canonicalName: variant === "hedgehog" ? "Henry the Hedgehog" : "Sammy the Squirrel",
      title: "Silver Lake Villager",
    };
  }
  return {
    ...VILLAGER_PERSONALITIES.fox,
    variant,
    canonicalName: variant === "otter" ? "Oliver the Otter" : variant === "bear" ? "Barnaby the Bear" : "Mei the Fox",
    title: "Silver Lake Villager",
  };
}

/**
 * Reason to return: Persistent Neighborhood Consequence.
 * The player chooses where to place an outdoor feature in the courtyard,
 * and the consequence is visibly remembered on future visits.
 */
export type NeighborhoodFeatureChoice = "tea_table" | "reading_bench";

export interface NeighborhoodFeatureConfig {
  id: NeighborhoodFeatureChoice;
  name: string;
  icon: string;
  description: string;
  quote: string;
  badge: string;
}

export const NEIGHBORHOOD_FEATURES: Record<NeighborhoodFeatureChoice, NeighborhoodFeatureConfig> = {
  tea_table: {
    id: "tea_table",
    name: "Cozy Cedar Tea Table",
    icon: "🍵",
    description: "A warm cedar wood table with steaming earthen mugs under the trees.",
    quote: "A welcoming spot for neighbors to pause and chat over warm tea.",
    badge: "Courtyard Tea Table Placed",
  },
  reading_bench: {
    id: "reading_bench",
    name: "Sunlit Garden Reading Bench",
    icon: "🌸",
    description: "A sturdy wooden bench flanked by flowering planters near the stepping stones.",
    quote: "A peaceful garden bench to sit quietly and enjoy the afternoon sun.",
    badge: "Garden Reading Bench Placed",
  },
};

export interface NeighborhoodMemoryState {
  featureChoice: NeighborhoodFeatureChoice | null;
  lastVisitedAt: string | null;
  encounterCounts: Record<string, number>; // villagerVariant -> count
  lastDraftedCustomer: {
    customerId: string;
    customerName: string;
    variant: VillagerVariant;
    completedAt: string;
    actionType: "send" | "schedule" | "sms_opened";
  } | null;
}

const STORAGE_KEY_PREFIX = "joystick_silver_lake_memory_";

/**
 * Loads browser-local neighborhood memory strictly partitioned by tenant.
 * Browser-local fictional memory for this playable slice; zero cross-tenant leakage.
 */
export function loadNeighborhoodMemory(tenantId: string = "laundry_farm"): NeighborhoodMemoryState {
  if (typeof window === "undefined") {
    return {
      featureChoice: "tea_table",
      lastVisitedAt: null,
      encounterCounts: {},
      lastDraftedCustomer: null,
    };
  }
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${tenantId}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // Fall back to clean memory
  }
  return {
    featureChoice: null,
    lastVisitedAt: null,
    encounterCounts: {},
    lastDraftedCustomer: null,
  };
}

/**
 * Saves browser-local neighborhood memory strictly partitioned by tenant.
 */
export function saveNeighborhoodMemory(
  state: NeighborhoodMemoryState,
  tenantId: string = "laundry_farm"
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${tenantId}`, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

const DEFAULT_REPLY_UNAVAILABLE: CozyReplyProjection = {
  status: "unavailable",
  reason: "No reply received on synthetic preview",
};

const DEFAULT_PAID_ORDER_UNAVAILABLE: CozyPaidOrderProjection = {
  status: "unavailable",
  reason: "Synthetic preview never presents unverified revenue attribution",
};

/**
 * Builds isolated synthetic test targets for playable demonstration & verification.
 * Strictly uses Laundry Farm branding and attaches authoritative silverLakeStatus.
 * Never presents fake or attributed revenue.
 */
export function buildSyntheticSilverLakeTargets(
  tenantId: string = "laundry_farm"
): CozyProjectedTarget[] {
  const business = businessNameForTenant(tenantId);
  const now = new Date();

  return [
    {
      slotId: "slot_01",
      customerId: "synthetic:customer:mei_lin",
      displayName: "Mei Lin",
      phone: "+13105550141",
      address: "Silver Lake, Los Angeles",
      verifiedAddress: null,
      territoryId: "silver-lake",
      territoryName: "Silver Lake",
      daysSinceLastOrder: 42,
      paidOrders: 5,
      lifetimeCents: 21500,
      lastOrderDate: "2026-09-07T14:30:00.000Z",
      lastOrderSummary: "Wash & Fold · 2 bags",
      hasConsent: true,
      consentStatus: "verified_opt_in",
      consentBasis: "explicit_consent_record",
      villagerVariant: "fox",
      suggestedMessage: `Hi Mei, checking in from ${business}! It's been 42 days since your last wash & fold with us. We'd love to take care of your laundry for the week ahead whenever you're ready!`,
      preparedMessage: `Hi Mei, checking in from ${business}! It's been 42 days since your last wash & fold with us. We'd love to take care of your laundry for the week ahead whenever you're ready!`,
      status: "draft_ready",
      communicationState: "draft_prepared",
      communicationLabel: "Draft Prepared",
      pose: "idle",
      poseFrameAvailable: false,
      messageId: null,
      transport: null,
      reply: DEFAULT_REPLY_UNAVAILABLE,
      paidOrder: DEFAULT_PAID_ORDER_UNAVAILABLE,
      outreachActionComplete: false,
      objectiveComplete: false,
      silverLakeStatus: projectSilverLakeOutreachStatus({
        tenantId,
        operatorId: "preview-operator",
        customerId: "synthetic:customer:mei_lin",
        suggestedBody: `Hi Mei, checking in from ${business}!`,
        now,
      }),
    },
    {
      slotId: "slot_02",
      customerId: "synthetic:customer:david_chen",
      displayName: "David Chen",
      phone: "+13105550142",
      address: "Silver Lake, Los Angeles",
      verifiedAddress: null,
      territoryId: "silver-lake",
      territoryName: "Silver Lake",
      daysSinceLastOrder: 56,
      paidOrders: 3,
      lifetimeCents: 14200,
      lastOrderDate: "2026-08-24T10:15:00.000Z",
      lastOrderSummary: "Bedding & Linens",
      hasConsent: true,
      consentStatus: "existing_customer_relationship",
      consentBasis: "transactional_dormant_recovery",
      villagerVariant: "bear",
      suggestedMessage: `Hi David, hope you're having a good week! It's been 56 days since your last bedding pickup. Let us know if you'd like a fresh wash scheduled!`,
      preparedMessage: `Hi David, checking in from ${business}! Scheduled for tomorrow morning dispatch.`,
      status: "scheduled",
      communicationState: "scheduled",
      communicationLabel: "Scheduled",
      pose: "wave",
      poseFrameAvailable: false,
      messageId: "outbox_synth_david_02",
      transport: null,
      reply: DEFAULT_REPLY_UNAVAILABLE,
      paidOrder: DEFAULT_PAID_ORDER_UNAVAILABLE,
      outreachActionComplete: false,
      objectiveComplete: false,
      scheduledDraft: {
        messageId: "outbox_synth_david_02",
        scheduledFor: new Date(Date.now() + 86400000).toISOString(),
        timezone: "America/Los_Angeles",
        currentMessageBody: `Hi David, checking in from ${business}! Scheduled for tomorrow morning dispatch.`,
      },
      silverLakeStatus: {
        message: "scheduled",
        label: "Scheduled",
        explicitlyApproved: true,
        approvalCoversCurrentRevision: true,
        scheduledFor: new Date(Date.now() + 86400000).toISOString(),
        timezone: "America/Los_Angeles",
        revisionCount: 1,
        messageId: "outbox_synth_david_02",
        automaticTransmission: false,
        openingComposeIsSend: false,
        operatorReportIsVerifiedSend: false,
        revenueAttributedToOutreach: false,
        reply: "none",
        order: "none",
        revenue: "unavailable",
        detail: "Approved and scheduled. At send time the operator opens Google Messages. The row is not an automatic text.",
      },
    },
    {
      slotId: "slot_03",
      customerId: "synthetic:customer:sarah_jenkins",
      displayName: "Sarah Jenkins",
      phone: "+13105550143",
      address: "Silver Lake, Los Angeles",
      verifiedAddress: null,
      territoryId: "silver-lake",
      territoryName: "Silver Lake",
      daysSinceLastOrder: 38,
      paidOrders: 8,
      lifetimeCents: 38900,
      lastOrderDate: "2026-09-11T16:00:00.000Z",
      lastOrderSummary: "Delicates & Hang Dry",
      hasConsent: true,
      consentStatus: "verified_opt_in",
      consentBasis: "explicit_consent_record",
      villagerVariant: "otter",
      suggestedMessage: `Hi Sarah! Hope you're doing well. It's been 38 days since your last delicates service — we're ready whenever you'd like a pickup!`,
      preparedMessage: `Hi Sarah! Saved for your Android phone handoff. Not sent automatically.`,
      status: "awaiting_sender_setup",
      communicationState: "awaiting_sender",
      communicationLabel: "Awaiting Sender",
      pose: "idle",
      poseFrameAvailable: false,
      messageId: "outbox_synth_sarah_03",
      transport: null,
      reply: DEFAULT_REPLY_UNAVAILABLE,
      paidOrder: DEFAULT_PAID_ORDER_UNAVAILABLE,
      outreachActionComplete: false,
      objectiveComplete: false,
      scheduledDraft: {
        messageId: "outbox_synth_sarah_03",
        scheduledFor: new Date().toISOString(),
        timezone: "America/Los_Angeles",
        currentMessageBody: "Hi Sarah! Saved for your Android phone handoff. Not sent automatically.",
      },
      silverLakeStatus: {
        message: "awaiting_sender",
        label: "Awaiting sender",
        explicitlyApproved: true,
        approvalCoversCurrentRevision: true,
        scheduledFor: new Date().toISOString(),
        timezone: "America/Los_Angeles",
        revisionCount: 1,
        messageId: "outbox_synth_sarah_03",
        automaticTransmission: false,
        openingComposeIsSend: false,
        operatorReportIsVerifiedSend: false,
        revenueAttributedToOutreach: false,
        reply: "none",
        order: "none",
        revenue: "unavailable",
        detail: "Approved for this recipient and this text. A sender still has to open Google Messages. Nothing has been sent.",
      },
    },
    {
      slotId: "slot_04",
      customerId: "synthetic:customer:elena_rostova",
      displayName: "Elena Rostova",
      phone: "+13105550144",
      address: "Silver Lake, Los Angeles",
      verifiedAddress: null,
      territoryId: "silver-lake",
      territoryName: "Silver Lake",
      daysSinceLastOrder: 64,
      paidOrders: 4,
      lifetimeCents: 18500,
      lastOrderDate: "2026-08-16T11:00:00.000Z",
      lastOrderSummary: "Wash & Fold",
      hasConsent: true,
      consentStatus: "existing_customer_relationship",
      consentBasis: "transactional_dormant_recovery",
      villagerVariant: "squirrel",
      suggestedMessage: `Hi Elena, thinking of you in Silver Lake! It's been 64 days since your last wash. Let us know when you'd like a pickup!`,
      preparedMessage: `Hi Elena, thinking of you in Silver Lake! It's been 64 days since your last wash. Let us know when you'd like a pickup!`,
      status: "accepted",
      communicationState: "send_observed",
      communicationLabel: "Send Observed",
      pose: "wave",
      poseFrameAvailable: false,
      messageId: "simulated:msg_elena_04",
      transport: "simulated",
      reply: DEFAULT_REPLY_UNAVAILABLE,
      paidOrder: DEFAULT_PAID_ORDER_UNAVAILABLE,
      outreachActionComplete: true,
      objectiveComplete: false,
      providerReceipt: {
        messageSid: "simulated:msg_elena_04",
        status: "dispatched",
        sentAt: new Date(Date.now() - 3600000).toISOString(),
        evidenceName: "simulated_carrier_receipt",
      },
      silverLakeStatus: {
        message: "operator_reported_sent",
        label: "Operator reported sent",
        explicitlyApproved: true,
        approvalCoversCurrentRevision: true,
        scheduledFor: null,
        timezone: null,
        revisionCount: 1,
        messageId: "simulated:msg_elena_04",
        automaticTransmission: false,
        openingComposeIsSend: false,
        operatorReportIsVerifiedSend: false,
        revenueAttributedToOutreach: false,
        reply: "none",
        order: "none",
        revenue: "unavailable",
        detail: "The operator reported this exact revision as sent. That report is not an independent verification.",
      },
    },
    {
      slotId: "slot_05",
      customerId: "synthetic:customer:marcus_vance",
      displayName: "Marcus Vance",
      phone: "+13105550145",
      address: "Silver Lake, Los Angeles",
      verifiedAddress: null,
      territoryId: "silver-lake",
      territoryName: "Silver Lake",
      daysSinceLastOrder: 49,
      paidOrders: 6,
      lifetimeCents: 26000,
      lastOrderDate: "2026-08-31T09:45:00.000Z",
      lastOrderSummary: "Heavy Bedding & Comforter",
      hasConsent: true,
      consentStatus: "verified_opt_in",
      consentBasis: "explicit_consent_record",
      villagerVariant: "badger",
      suggestedMessage: `Hi Marcus, ${business} here. It's been 49 days since your last order. We're available for Silver Lake pickups whenever you're ready.`,
      preparedMessage: `Hi Marcus, ${business} here. It's been 49 days since your last order. We're available for Silver Lake pickups whenever you're ready.`,
      status: "draft_ready",
      communicationState: "draft_prepared",
      communicationLabel: "Draft Prepared",
      pose: "idle",
      poseFrameAvailable: false,
      messageId: null,
      transport: null,
      reply: DEFAULT_REPLY_UNAVAILABLE,
      paidOrder: DEFAULT_PAID_ORDER_UNAVAILABLE,
      outreachActionComplete: false,
      objectiveComplete: false,
      silverLakeStatus: projectSilverLakeOutreachStatus({
        tenantId,
        operatorId: "preview-operator",
        customerId: "synthetic:customer:marcus_vance",
        suggestedBody: `Hi Marcus, ${business} here.`,
        now,
      }),
    },
    {
      slotId: "slot_06",
      customerId: "synthetic:customer:chloe_bennett",
      displayName: "Chloe Bennett",
      phone: "+13105550146",
      address: "Silver Lake, Los Angeles",
      verifiedAddress: null,
      territoryId: "silver-lake",
      territoryName: "Silver Lake",
      daysSinceLastOrder: 72,
      paidOrders: 2,
      lifetimeCents: 9800,
      lastOrderDate: "2026-08-08T15:20:00.000Z",
      lastOrderSummary: "Standard Wash & Fold",
      hasConsent: true,
      consentStatus: "existing_customer_relationship",
      consentBasis: "transactional_dormant_recovery",
      villagerVariant: "cat",
      suggestedMessage: `Hi Chloe, checking in from ${business}! It's been 72 days since your last order. We'd love to help with your laundry this week!`,
      preparedMessage: `Hi Chloe, checking in from ${business}! It's been 72 days since your last order. We'd love to help with your laundry this week!`,
      status: "failed",
      communicationState: "failed",
      communicationLabel: "Failed — not sent",
      pose: "idle",
      poseFrameAvailable: false,
      messageId: "outbox_synth_chloe_06",
      transport: null,
      reply: DEFAULT_REPLY_UNAVAILABLE,
      paidOrder: DEFAULT_PAID_ORDER_UNAVAILABLE,
      outreachActionComplete: false,
      objectiveComplete: false,
      silverLakeStatus: {
        message: "failed",
        label: "Failed",
        explicitlyApproved: false,
        approvalCoversCurrentRevision: false,
        scheduledFor: null,
        timezone: null,
        revisionCount: 1,
        messageId: "outbox_synth_chloe_06",
        automaticTransmission: false,
        openingComposeIsSend: false,
        operatorReportIsVerifiedSend: false,
        revenueAttributedToOutreach: false,
        reply: "none",
        order: "none",
        revenue: "unavailable",
        detail: "Transmission failed. This is not a send.",
      },
    },
    {
      slotId: "slot_07",
      customerId: "synthetic:customer:lucas_morales",
      displayName: "Lucas Morales",
      phone: null,
      address: "Silver Lake, Los Angeles",
      verifiedAddress: null,
      territoryId: "silver-lake",
      territoryName: "Silver Lake",
      daysSinceLastOrder: 80,
      paidOrders: 1,
      lifetimeCents: 4500,
      lastOrderDate: "2026-07-31T12:00:00.000Z",
      lastOrderSummary: "First-time Wash & Fold",
      hasConsent: false,
      consentStatus: "missing_phone",
      consentBasis: "missing_contact_info",
      consentReason: "Missing verified phone number",
      villagerVariant: "fox",
      suggestedMessage: `Hi Lucas, checking in from ${business} in Silver Lake!`,
      preparedMessage: `Hi Lucas, checking in from ${business} in Silver Lake!`,
      status: "consent_blocked",
      communicationState: "consent_blocked",
      communicationLabel: "Consent blocked",
      pose: "idle",
      poseFrameAvailable: false,
      messageId: null,
      transport: null,
      reply: DEFAULT_REPLY_UNAVAILABLE,
      paidOrder: DEFAULT_PAID_ORDER_UNAVAILABLE,
      outreachActionComplete: false,
      objectiveComplete: false,
      silverLakeStatus: {
        message: "cancelled",
        label: "Cancelled",
        explicitlyApproved: false,
        approvalCoversCurrentRevision: false,
        scheduledFor: null,
        timezone: null,
        revisionCount: null,
        messageId: null,
        automaticTransmission: false,
        openingComposeIsSend: false,
        operatorReportIsVerifiedSend: false,
        revenueAttributedToOutreach: false,
        reply: "none",
        order: "none",
        revenue: "unavailable",
        detail: "Contact blocked: missing verified phone number.",
      },
    },
    {
      slotId: "slot_08",
      customerId: "synthetic:customer:grace_holloway",
      displayName: "Grace Holloway",
      phone: "+13105550148",
      address: "Silver Lake, Los Angeles",
      verifiedAddress: null,
      territoryId: "silver-lake",
      territoryName: "Silver Lake",
      daysSinceLastOrder: 21,
      paidOrders: 7,
      lifetimeCents: 34500,
      lastOrderDate: "2026-09-28T13:10:00.000Z",
      lastOrderSummary: "Wash & Fold · Next-day return",
      hasConsent: true,
      consentStatus: "verified_opt_in",
      consentBasis: "explicit_consent_record",
      villagerVariant: "hedgehog",
      suggestedMessage: `Hi Grace! Checking in from ${business} — hope you're having a wonderful week in Silver Lake!`,
      preparedMessage: `Hi Grace! Checking in from ${business} — hope you're having a wonderful week in Silver Lake!`,
      status: "draft_ready",
      communicationState: "draft_prepared",
      communicationLabel: "Draft Prepared",
      pose: "idle",
      poseFrameAvailable: false,
      messageId: null,
      transport: null,
      reply: DEFAULT_REPLY_UNAVAILABLE,
      paidOrder: DEFAULT_PAID_ORDER_UNAVAILABLE,
      outreachActionComplete: false,
      objectiveComplete: false,
      silverLakeStatus: projectSilverLakeOutreachStatus({
        tenantId,
        operatorId: "preview-operator",
        customerId: "synthetic:customer:grace_holloway",
        suggestedBody: `Hi Grace! Checking in from ${business}`,
        now,
      }),
    },
  ];
}

export const SYNTHETIC_SILVER_LAKE_TARGETS: CozyProjectedTarget[] =
  buildSyntheticSilverLakeTargets("laundry_farm");

