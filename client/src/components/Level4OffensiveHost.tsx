import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BUILDINGS } from "@shared/buildings";
import { TENANT_CONFIG, type TenantId } from "@shared/tenantConfig";
import { Level4Offensive, type Level4OffensiveHandle } from "./Level4Offensive";
import { Level4BoardScene, type Level4ActiveChallenge } from "./Level4BoardScene";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type Deliverable = "sms" | "card";

type GeneratedCopy = {
  headline: string;
  body: string;
  primaryCopy: string;
  internalNote: string;
  deliverable: Deliverable;
  brandId: TenantId;
};

type RouterOutput = inferRouterOutputs<AppRouter>;
type Level4Gate = RouterOutput["admin"]["getLevel4GateState"];
type GateLane = Level4Gate["lanes"][number];

function brandDisplayName(id: TenantId): string {
  return TENANT_CONFIG[id].brandName;
}

function brandHasRequiredFields(id: TenantId): boolean {
  const t = TENANT_CONFIG[id];
  return Boolean(t.supportPhone && t.hostname && t.brandName);
}

/**
 * Allowed brands for this building's Lane 1. Order matters — first entry is
 * the default. Unknown / unconfigured buildings fall back to Butler only.
 */
function allowedBrandsForBuilding(slug: string | undefined | null): TenantId[] {
  if (!slug) return ["default"];
  const b = BUILDINGS.find((x) => x.slug === slug);
  return b?.allowedBrands ?? ["default"];
}

function deliverableForBuilding(slug: string | undefined | null): Deliverable {
  if (!slug) return "sms";
  const b = BUILDINGS.find((x) => x.slug === slug);
  return b?.deliverable ?? "sms";
}

/**
 * Modal payload: bundles the block + click-time context + the generated copy.
 * The admin reviews `copy` then clicks Deploy (executes) or Cancel (dismiss).
 */
type ModalState =
  | null
  | {
      kind: "building_penetration";
      buildingSlug: string;
      buildingName: string;
      metadata: {
        convertedUsers: number;
        convertedPaidUsers: number;
        total: number;
        unconverted: number;
        penetrationPct: number;
        paidPenetrationPct: number;
      };
      copy: GeneratedCopy;
    }
  | {
      kind: "referral_request";
      userId: number;
      firstName: string;
      lastInitial: string;
      orderCount: number;
      ltvCents: number;
      copy: GeneratedCopy;
    }
  | {
      kind: "market_hole_outreach";
      /** Block C has no LLM copy — the preview modal just confirms stub acknowledgement. */
      copy: null;
    };

function formatUsdCents(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function decayLabel(kind: "collection" | "vagueness" | "target", days: number) {
  if (kind === "vagueness") {
    if (days <= 2) return "ACTIVE";
    if (days <= 6) return "DEGRADED";
    if (days <= 13) return "STALE VAGUENESS";
    return "RECKONING";
  }
  if (kind === "collection") {
    if (days <= 2) return "ACTIVE";
    if (days <= 6) return "ASSET COOLING";
    if (days <= 13) return "EXTRACTION WINDOW CLOSING";
    return "ASSET IN THE COLD";
  }
  if (days <= 6) return "ACTIVE TARGET";
  if (days <= 13) return "TARGET COOLING";
  if (days <= 29) return "EXTRACTION WINDOW CLOSING";
  if (days <= 44) return "COLD CASE WARNING";
  return "COLD CASE VISUAL_ONLY";
}

/**
 * Phase 2:
 * - operator_xp_transactions table
 * - persistent Butler Rating
 * - immutable XP events
 * - anti-gaming validation server-side
 * - cold-case persistence
 * - relationship warmth metadata for building targets
 * - copy performance tracking
 */

function challengeFromGate(gate: Level4Gate): Level4ActiveChallenge | null {
  const lane = gate.lanes.find((item) => item.count > 0);
  if (!lane) return null;
  if (lane.key === "collections") {
    return {
      id: `collections:${lane.orderId ?? "live"}`,
      kind: "collections",
      title: "COLLECTIONS DETECTED",
      targetLabel: lane.target ?? "Known-dollar order",
      missionLabel: lane.intel ?? "Collect or recover known revenue.",
      ctaLabel: "OPEN LIVE →",
      severity: lane.state === "DEGRADED" ? "degraded" : "active",
    };
  }
  if (lane.key === "vagueness") {
    return {
      id: `vagueness:${lane.orderId ?? "intake"}`,
      kind: "vagueness",
      title: "VAGUENESS DETECTED",
      targetLabel: lane.target ?? "Order not yet clear",
      missionLabel: "Revenue exposure uncomputed.",
      ctaLabel: "RESTORE CLARITY →",
      severity: lane.state === "DEGRADED" ? "degraded" : "active",
    };
  }
  return {
    id: `dispatch:${lane.orderId ?? "routes"}`,
    kind: "dispatch",
    title: "DISPATCH BLOCKER",
    targetLabel: lane.target ?? "Route action required",
    missionLabel: lane.intel ?? "Physical movement still needs action today.",
    ctaLabel: "OPEN ROUTES →",
    severity: "active",
  };
}

function challengeFromBoss(params: {
  topBuilding: { buildingSlug: string; buildingName: string; unconverted: number; paidPenetrationPct: number } | null;
  referralCandidate: { userId: number; firstName: string; lastInitial: string; orderCount: number } | null;
}): Level4ActiveChallenge | null {
  if (params.topBuilding) {
    return {
      id: `building_penetration:${params.topBuilding.buildingSlug}`,
      kind: "building_penetration",
      title: "BUILDING GROWTH",
      targetLabel: params.topBuilding.buildingName,
      missionLabel: `${params.topBuilding.unconverted} unconverted / ${params.topBuilding.paidPenetrationPct}% paid penetration`,
      ctaLabel: "DRAW WEAPON →",
      severity: "boss",
    };
  }
  if (params.referralCandidate) {
    return {
      id: `referral_request:${params.referralCandidate.userId}`,
      kind: "referral_request",
      title: "REFERRAL REQUEST",
      targetLabel: `${params.referralCandidate.firstName} ${params.referralCandidate.lastInitial}.`,
      missionLabel: `${params.referralCandidate.orderCount} paid orders. Ask for one intro.`,
      ctaLabel: "DRAW WEAPON →",
      severity: "boss",
    };
  }
  return {
    id: "market_hole_outreach:stubbed_for_v1",
    kind: "market_hole_outreach",
    title: "MARKET HOLE",
    targetLabel: "Stubbed for v1",
    missionLabel: "Acknowledge the market-hole lane only.",
    ctaLabel: "ACKNOWLEDGE →",
    severity: "boss",
  };
}

/**
 * Live wrapper for <Level4Offensive />. Owns the tRPC queries/mutations,
 * renders the lane labels from real state, and runs the preview → execute flow.
 *
 * Game-loop contract: each onDeployLaneN returns Promise<boolean>. The promise
 * resolves true after the admin deploys (execute mutation success), false on
 * cancel or error — the crusher game uses that to advance or retry the lane.
 */
/**
 * Client-only synthetic lane 2 candidate. Created by the Simulation Override so the
 * referral-ask loop can be tested when the real admin.getLevel4OffensiveState returns no
 * referralRequest. This object never touches execAction and is never written to the DB.
 */
const SYNTHETIC_LANE2_CANDIDATE = {
  userId: -1,
  firstName: "Sim",
  lastInitial: "X",
  orderCount: 7,
  ltvCents: 48_400,
} as const;

export function Level4OffensiveHost() {
  const state = trpc.admin.getLevel4OffensiveState.useQuery();
  const gateQuery = trpc.admin.getLevel4GateState.useQuery();
  const generateCopy = trpc.admin.generateOffensiveCopy.useMutation();
  const execAction = trpc.admin.executeOffensiveAction.useMutation();
  const utils = trpc.useUtils();

  const [modal, setModal] = useState<ModalState>(null);
  const [modalBusy, setModalBusy] = useState<"idle" | "generating" | "deploying">("idle");
  const [modalError, setModalError] = useState<string | null>(null);
  /** Resolves the crusher-game promise once the modal is dismissed or deploy completes. */
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);
  /** Imperative handle to the crusher UI — used to force-fire revive from the deploy
   *  success path even if the promise-driven child trigger ever loses its resolution. */
  const l4Ref = useRef<Level4OffensiveHandle>(null);
  /** When true, lane 2 runs on a client-only candidate with a no-op deploy. */
  const [syntheticLane2Active, setSyntheticLane2Active] = useState(false);
  const [completion, setCompletion] = useState<{
    lane: 1 | 2 | 3;
    deduped: boolean;
    xp: number;
    message: string;
    challengeId?: string;
  } | null>(null);

  // Pick the top building-penetration target by unconverted desc.
  const topBuilding = useMemo(() => {
    const list = state.data?.buildingPenetration ?? [];
    if (list.length === 0) return null;
    return list[0];
  }, [state.data]);

  const referralCandidate = useMemo(() => {
    if (syntheticLane2Active) return SYNTHETIC_LANE2_CANDIDATE;
    const r = state.data?.referralRequest;
    if (!r) return null;
    if ("userId" in r) return r;
    return null;
  }, [state.data, syntheticLane2Active]);

  const gate = gateQuery.data;

  const openBuildingPenetration = useCallback(async (): Promise<boolean> => {
    if (!topBuilding) {
      setModalError("No building candidate available.");
      return false;
    }
    const brands = allowedBrandsForBuilding(topBuilding.buildingSlug);
    const defaultBrand: TenantId = brands[0] ?? "default";
    setModalError(null);
    setModalBusy("generating");
    try {
      const out = await generateCopy.mutateAsync({
        block: "building_penetration",
        brand: defaultBrand,
        payload: {
          buildingSlug: topBuilding.buildingSlug,
          buildingName: topBuilding.buildingName,
          convertedUsers: topBuilding.convertedUsers,
          convertedPaidUsers: topBuilding.convertedPaidUsers,
          total: topBuilding.total,
          unconverted: topBuilding.unconverted,
          penetrationPct: topBuilding.penetrationPct,
          paidPenetrationPct: topBuilding.paidPenetrationPct,
        },
      });
      if (out.block !== "building_penetration" || !out.copy) throw new Error("No copy returned.");
      setModal({
        kind: "building_penetration",
        buildingSlug: topBuilding.buildingSlug,
        buildingName: topBuilding.buildingName,
        metadata: {
          convertedUsers: topBuilding.convertedUsers,
          convertedPaidUsers: topBuilding.convertedPaidUsers,
          total: topBuilding.total,
          unconverted: topBuilding.unconverted,
          penetrationPct: topBuilding.penetrationPct,
          paidPenetrationPct: topBuilding.paidPenetrationPct,
        },
        copy: out.copy,
      });
      setModalBusy("idle");
    } catch (e) {
      setModalBusy("idle");
      setModalError(e instanceof Error ? e.message : "Copy generation failed.");
      return false;
    }
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, [topBuilding, generateCopy]);

  /**
   * Brand toggle inside the preview — regenerates copy with the new brand and
   * swaps it in place. No-op when the requested brand is already active.
   */
  const switchBrandInPreview = useCallback(
    async (nextBrand: TenantId) => {
      if (!modal) return;
      if (modal.kind !== "building_penetration" && modal.kind !== "referral_request") return;
      if (modal.copy && modal.copy.brandId === nextBrand) return;
      setModalBusy("generating");
      setModalError(null);
      try {
        if (modal.kind === "building_penetration") {
          const out = await generateCopy.mutateAsync({
            block: "building_penetration",
            brand: nextBrand,
            payload: {
              buildingSlug: modal.buildingSlug,
              buildingName: modal.buildingName,
              convertedUsers: modal.metadata.convertedUsers,
              convertedPaidUsers: modal.metadata.convertedPaidUsers,
              total: modal.metadata.total,
              unconverted: modal.metadata.unconverted,
              penetrationPct: modal.metadata.penetrationPct,
              paidPenetrationPct: modal.metadata.paidPenetrationPct,
            },
          });
          if (out.block !== "building_penetration" || !out.copy) throw new Error("No copy returned.");
          setModal({ ...modal, copy: out.copy });
        } else {
          const out = await generateCopy.mutateAsync({
            block: "referral_request",
            brand: nextBrand,
            payload: {
              firstName: modal.firstName,
              lastInitial: modal.lastInitial,
              orderCount: modal.orderCount,
              ltvCents: modal.ltvCents,
            },
          });
          if (out.block !== "referral_request" || !out.copy) throw new Error("No copy returned.");
          setModal({ ...modal, copy: out.copy });
        }
      } catch (e) {
        setModalError(e instanceof Error ? e.message : "Brand switch failed.");
      } finally {
        setModalBusy("idle");
      }
    },
    [modal, generateCopy]
  );

  const openReferralRequest = useCallback(async (): Promise<boolean> => {
    if (!referralCandidate) {
      setModalError("No referral candidate available.");
      return false;
    }
    // SYNTHETIC LANE 2: bypass LLM + execAction. Show a mock preview and resolve true
    // with zero server calls. This is guarded by syntheticLane2Active so production flow
    // is untouched when the flag is off.
    if (syntheticLane2Active) {
      setModal({
        kind: "referral_request",
        userId: referralCandidate.userId,
        firstName: referralCandidate.firstName,
        lastInitial: referralCandidate.lastInitial,
        orderCount: referralCandidate.orderCount,
        ltvCents: referralCandidate.ltvCents,
        copy: {
          headline: "Ask for one referral",
          body: "Synthetic preview copy. Deploy is stubbed; nothing is sent.",
          primaryCopy: "Sim, can you intro me to one resident who should know about bldg?",
          internalNote: "SIMULATION: no execAction, no admin_action_log row.",
          deliverable: "sms",
          brandId: "default",
        },
      });
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
      });
    }
    setModalError(null);
    setModalBusy("generating");
    try {
      const out = await generateCopy.mutateAsync({
        block: "referral_request",
        brand: "default",
        payload: {
          firstName: referralCandidate.firstName,
          lastInitial: referralCandidate.lastInitial,
          orderCount: referralCandidate.orderCount,
          ltvCents: referralCandidate.ltvCents,
        },
      });
      if (out.block !== "referral_request" || !out.copy) throw new Error("No copy returned.");
      setModal({
        kind: "referral_request",
        userId: referralCandidate.userId,
        firstName: referralCandidate.firstName,
        lastInitial: referralCandidate.lastInitial,
        orderCount: referralCandidate.orderCount,
        ltvCents: referralCandidate.ltvCents,
        copy: out.copy,
      });
      setModalBusy("idle");
    } catch (e) {
      setModalBusy("idle");
      setModalError(e instanceof Error ? e.message : "Copy generation failed.");
      return false;
    }
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, [referralCandidate, generateCopy, syntheticLane2Active]);

  const openMarketHole = useCallback(async (): Promise<boolean> => {
    setModalError(null);
    setModal({ kind: "market_hole_outreach", copy: null });
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const closeModal = useCallback(
    (deployed: boolean) => {
      const r = resolverRef.current;
      resolverRef.current = null;
      setModal(null);
      setModalError(null);
      setModalBusy("idle");
      if (r) r(deployed);
    },
    []
  );

  const laneForModal = useCallback((m: NonNullable<ModalState>): 1 | 2 | 3 => {
    if (m.kind === "building_penetration") return 1;
    if (m.kind === "referral_request") return 2;
    return 3;
  }, []);

  const confirmDeploy = useCallback(async () => {
    if (!modal) return;
    const lane = laneForModal(modal);
    // SYNTHETIC LANE 2 path: short visual pause, no mutation, no cache invalidate.
    if (modal.kind === "referral_request" && syntheticLane2Active) {
      setModalBusy("deploying");
      setModalError(null);
      await new Promise((r) => setTimeout(r, 280));
      closeModal(true);
      // Belt-and-suspenders: force the revive from here so the payoff is guaranteed.
      queueMicrotask(() => l4Ref.current?.forceRevive(lane));
      return;
    }
    setModalBusy("deploying");
    setModalError(null);
    try {
      if (modal.kind === "building_penetration") {
        const result = await execAction.mutateAsync({
          block: "building_penetration",
          buildingSlug: modal.buildingSlug,
          buildingName: modal.buildingName,
          metadata: modal.metadata,
          generatedCopy: modal.copy,
        });
        setCompletion({
          lane,
          deduped: result.deduped,
          xp: !result.deduped ? 500 : 0,
          message: result.deduped ? "ALREADY LOGGED TODAY" : "BUILDING PENETRATION LOGGED",
          challengeId: `building_penetration:${modal.buildingSlug}:${result.logId ?? "deduped"}`,
        });
      } else if (modal.kind === "referral_request") {
        const result = await execAction.mutateAsync({
          block: "referral_request",
          userId: modal.userId,
          firstName: modal.firstName,
          lastInitial: modal.lastInitial,
          orderCount: modal.orderCount,
          ltvCents: modal.ltvCents,
          generatedCopy: modal.copy,
        });
        setCompletion({
          lane,
          deduped: result.deduped,
          xp: !result.deduped ? 500 : 0,
          message: result.deduped ? "ALREADY LOGGED TODAY" : "TARGET ENGAGED",
          challengeId: `referral_request:${modal.userId}:${result.logId ?? "deduped"}`,
        });
      } else {
        const result = await execAction.mutateAsync({ block: "market_hole_outreach" });
        setCompletion({
          lane,
          deduped: result.deduped,
          xp: !result.deduped ? 500 : 0,
          message: result.deduped ? "ALREADY LOGGED TODAY" : "TERRITORY PRESSURE REDUCED",
          challengeId: `market_hole_outreach:${result.logId ?? "deduped"}`,
        });
      }
      closeModal(true);
      // Belt-and-suspenders: force revive so the dopamine hit fires even if the
      // promise-driven path in tryCompleteLane loses its resolution across the
      // tRPC invalidation cycle. runReviveSequence is guarded against double-fire.
      queueMicrotask(() => l4Ref.current?.forceRevive(lane));
    } catch (e) {
      setModalBusy("idle");
      setModalError(e instanceof Error ? e.message : "Deploy failed.");
    }
  }, [modal, execAction, utils, closeModal, syntheticLane2Active, laneForModal]);

  // Honest lane labels derived from the read-only server gate.
  if (state.isLoading || gateQuery.isLoading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-white/50" />
      </div>
    );
  }

  if (!gate) {
    return (
      <section className="min-h-screen bg-[#0e1111] text-[#e5e7eb] px-4 py-12 font-mono">
        <div className="mx-auto max-w-3xl border border-red-500/45 bg-black/35 p-8 text-center">
          <div className="text-[11px] uppercase tracking-[0.22em] text-red-300">LEVEL 4 GATE UNAVAILABLE</div>
          <p className="mt-4 text-sm text-white/60">The read-only gate could not load. No Level 4 action was executed.</p>
        </div>
      </section>
    );
  }

  if (gate.state === "LOCKED") {
    const lockedChallenge = challengeFromGate(gate);
    return (
      <Level4GateLocked
        gate={gate}
        activeChallenge={lockedChallenge}
        onNavigate={(path) => { window.location.href = path; }}
      />
    );
  }

  if (gate.state === "COMPLETE_TODAY") {
    return <Level4Complete dailyXp={gate.dailyXp} />;
  }

  const targetAgeLabel = topBuilding?.daysSinceLastTouch != null
    ? decayLabel("target", topBuilding.daysSinceLastTouch)
    : "ACTIVE TARGET";

  const lane1Title = topBuilding
    ? `BOSS ENCOUNTER · BUILDING GROWTH · ${topBuilding.buildingName}`
    : "LANE 1 | BLOCK A | Building penetration";
  const lane1Deliverable = deliverableForBuilding(topBuilding?.buildingSlug);
  const lane1BrandDefault: TenantId = allowedBrandsForBuilding(topBuilding?.buildingSlug)[0] ?? "default";
  const lane1AssetLabel = lane1Deliverable === "card" ? "Resident-safe card" : "SMS outreach";
  const lane1Body = topBuilding
    ? `TARGET: ${topBuilding.buildingName}. OBJECTIVE: Secure next building intro or resident acquisition path. INTEL: ${topBuilding.convertedUsers}/${topBuilding.total} converted, ${topBuilding.convertedPaidUsers} paying, ${topBuilding.paidPenetrationPct}% paid penetration, ${topBuilding.unconverted} unconverted. ${targetAgeLabel}. WEAPON: ${lane1AssetLabel}. Brand: ${brandDisplayName(lane1BrandDefault)}`
    : state.isLoading
      ? "Loading building penetration…"
      : "No building candidate.";
  const lane1CtaLabel = topBuilding
    ? lane1Deliverable === "card"
      ? "GENERATE CARD →"
      : "GENERATE OUTREACH →"
    : "NO TARGET";

  const lane2Title = referralCandidate
    ? syntheticLane2Active
      ? `LANE 2 | BLOCK B | ${referralCandidate.firstName} ${referralCandidate.lastInitial}. (SIM)`
      : `LANE 2 | BLOCK B | ${referralCandidate.firstName} ${referralCandidate.lastInitial}.`
    : "LANE 2 | BLOCK B | Referral request";
  const lane2Body = referralCandidate
    ? syntheticLane2Active
      ? `SYNTHETIC · ${referralCandidate.orderCount} paid orders · ${formatUsdCents(referralCandidate.ltvCents)} LTV · no db writes.`
      : `${referralCandidate.orderCount} paid orders · ${formatUsdCents(referralCandidate.ltvCents)} LTV.`
    : state.isLoading
      ? "Loading referral candidate…"
      : "No eligible referral candidate right now.";
  const lane2CtaLabel = referralCandidate
    ? syntheticLane2Active
      ? "SIM: DEPLOY REFERRAL →"
      : "GENERATE REFERRAL ASK →"
    : "NO CANDIDATE";
  const lane2Disabled = !referralCandidate;

  const lane3Title = "LANE 3 | BLOCK C | Market hole";
  const lane3Body = "Scoring engine not built yet.";
  const activeChallenge = challengeFromBoss({ topBuilding, referralCandidate });

  return (
    <>
      <Level4Offensive
        ref={l4Ref}
        onDeployLane1={openBuildingPenetration}
        onDeployLane2={openReferralRequest}
        onDeployLane3={openMarketHole}
        lane1Title={lane1Title}
        lane1Body={lane1Body}
        lane1CtaLabel={lane1CtaLabel}
        lane2Title={lane2Title}
        lane2Body={lane2Body}
        lane2CtaLabel={lane2CtaLabel}
        lane2Disabled={lane2Disabled}
        lane3Title={lane3Title}
        lane3Body={lane3Body}
        lane3Stubbed
        syntheticLane2Active={syntheticLane2Active}
        onInjectSyntheticLane2={() => setSyntheticLane2Active(true)}
        onResetSyntheticLane2={() => setSyntheticLane2Active(false)}
        // HOLD→UNSTABLE timer starts only when the preview is actually on screen;
        // during copy generation we intentionally keep HOLD stable. The Dialog is
        // rendered when `modal != null`, which covers the three preview kinds.
        previewOpen={modal != null}
        dailyXp={gate.dailyXp + (completion?.xp ?? 0)}
        completion={completion}
        gateState={gate.state}
        activeChallenge={activeChallenge}
        onCompletionHoldDone={() => {
          setCompletion(null);
          void utils.admin.getLevel4OffensiveState.invalidate();
          void utils.admin.getLevel4GateState.invalidate();
        }}
      />

      <Dialog
        open={modal != null}
        onOpenChange={(open) => {
          if (!open && modalBusy !== "deploying") closeModal(false);
        }}
      >
        <DialogContent className="max-w-lg">
          {modal?.kind === "building_penetration" && (
            <>
              <DialogHeader>
                <DialogTitle>Preview — {modal.buildingName}</DialogTitle>
                <DialogDescription className="text-xs font-mono">
                  building_penetration · {modal.metadata.convertedUsers}/{modal.metadata.total} signed up · {modal.metadata.convertedPaidUsers} paying
                </DialogDescription>
              </DialogHeader>
              <BrandToggle
                copy={modal.copy}
                allowedBrands={allowedBrandsForBuilding(modal.buildingSlug)}
                disabled={modalBusy !== "idle"}
                onSwitch={(id) => void switchBrandInPreview(id)}
              />
              <CopyPreview copy={modal.copy} />
            </>
          )}
          {modal?.kind === "referral_request" && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Preview — {modal.firstName} {modal.lastInitial}.
                </DialogTitle>
                <DialogDescription className="text-xs font-mono">
                  referral_request · {modal.orderCount} orders · {formatUsdCents(modal.ltvCents)} LTV
                </DialogDescription>
              </DialogHeader>
              <CopyPreview copy={modal.copy} />
            </>
          )}
          {modal?.kind === "market_hole_outreach" && (
            <>
              <DialogHeader>
                <DialogTitle>Block C — stubbed for v1</DialogTitle>
                <DialogDescription className="text-xs font-mono">market_hole_outreach</DialogDescription>
              </DialogHeader>
              <p className="text-sm text-[var(--ink-muted)] leading-relaxed">
                No scoring engine is wired for market-hole detection yet. Deploying logs an acknowledgement row
                in <code className="text-xs">admin_action_log</code> so this lane retires from today's queue. No outbound
                message is sent and no copy is generated.
              </p>
            </>
          )}

          {modalError && (
            <p className="text-sm text-[var(--red)] font-sans">{modalError}</p>
          )}

          {modal && (modal.kind === "building_penetration" || modal.kind === "referral_request") && modal.copy && !brandHasRequiredFields(modal.copy.brandId) && (
            <p className="text-sm text-[var(--red)] font-sans border border-[var(--red)] px-3 py-2 rounded">
              Branding incomplete for {brandDisplayName(modal.copy.brandId)}: missing phone or website.
              Deploy blocked until configured in <code className="font-mono text-xs">shared/tenantConfig.ts</code>.
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={modalBusy === "deploying"}
              onClick={() => closeModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                modalBusy !== "idle" ||
                Boolean(
                  modal &&
                    (modal.kind === "building_penetration" || modal.kind === "referral_request") &&
                    modal.copy &&
                    !brandHasRequiredFields(modal.copy.brandId)
                )
              }
              onClick={() => void confirmDeploy()}
            >
              {modalBusy === "deploying" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  EXECUTING
                </>
              ) : (
                "Deploy"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {modalBusy === "generating" && !modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-[var(--card)] rounded-lg px-6 py-4 flex items-center gap-3 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating copy…
          </div>
        </div>
      )}
    </>
  );
}

function CopyPreview({ copy }: { copy: GeneratedCopy }) {
  if (copy.deliverable === "card") {
    return (
      <div className="space-y-3 text-sm">
        <CardMockup copy={copy} />
        <Field label="Headline" value={copy.headline} />
        <Field label="Body" value={copy.body} />
        <Field label="Footer" value={copy.primaryCopy} mono />
        <Field label="Internal note" value={copy.internalNote} />
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      <Field label="Headline" value={copy.headline} />
      <Field label="Body" value={copy.body} />
      <Field label="SMS copy" value={copy.primaryCopy} mono />
      <Field label="Internal note" value={copy.internalNote} />
    </div>
  );
}

/**
 * Print-style mockup of the handoff card. Card-deliverable copy only. Shows
 * the active brand name prominently so the admin can confirm which brand the
 * resident-facing artifact represents.
 */
function CardMockup({ copy }: { copy: GeneratedCopy }) {
  return (
    <div className="border border-[var(--ink)] rounded bg-[var(--card)] p-4 space-y-2 font-sans">
      <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--ink-muted)]">
        {brandDisplayName(copy.brandId)} · Resident card preview
      </p>
      <p className="text-base font-semibold leading-snug">{copy.headline}</p>
      <p className="text-sm leading-relaxed">{copy.body}</p>
      <p className="text-xs font-mono pt-2 border-t border-[var(--border)]">{copy.primaryCopy}</p>
    </div>
  );
}

function BrandToggle({
  copy,
  allowedBrands,
  disabled,
  onSwitch,
}: {
  copy: GeneratedCopy | null;
  allowedBrands: TenantId[];
  disabled: boolean;
  onSwitch: (id: TenantId) => void;
}) {
  if (!copy) return null;
  if (allowedBrands.length <= 1) {
    return (
      <p className="text-[10px] font-mono uppercase tracking-wide text-[var(--ink-muted)]">
        Brand: {brandDisplayName(copy.brandId)}
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-mono uppercase tracking-wide text-[var(--ink-muted)]">Brand:</span>
      {allowedBrands.map((id) => {
        const active = id === copy.brandId;
        return (
          <button
            key={id}
            type="button"
            disabled={disabled || active}
            onClick={() => onSwitch(id)}
            className={
              active
                ? "px-2 py-1 border border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)] rounded font-mono uppercase"
                : "px-2 py-1 border border-[var(--border)] rounded font-mono uppercase hover:border-[var(--ink)]"
            }
          >
            {brandDisplayName(id)}
          </button>
        );
      })}
    </div>
  );
}

function Level4GateLocked({
  gate,
  activeChallenge,
  onNavigate,
}: {
  gate: Level4Gate;
  activeChallenge: Level4ActiveChallenge | null;
  onNavigate: (path: string) => void;
}) {
  const primaryLane = gate.lanes.find((lane) => lane.count > 0);
  return (
    <section className="min-h-screen bg-[#0e1111] text-[#e5e7eb] px-4 py-8 font-mono">
      <div className="mx-auto max-w-5xl border border-red-500/40 bg-black/35">
        <div className="border-b border-red-500/30 p-5">
          <div className="text-[11px] uppercase tracking-[0.2em] text-red-300">LEVEL 4 LOCKED</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-[0.12em]">Clear operational lanes to unlock boss encounter.</h1>
        </div>
        <div className="border-b border-red-500/30 p-4">
          <Level4BoardScene
            gateState="LOCKED"
            activeChallenge={activeChallenge}
            dailyXp={gate.dailyXp}
            onPrimaryAction={() => {
              if (primaryLane) onNavigate(primaryLane.path);
            }}
          />
        </div>
        <div className="l4-gateLaneStrip">
          {gate.lanes.map((lane) => (
            <article key={lane.key} className="l4-gateLane">
              <div className="l4-gateLaneTop">
                <h2>{lane.title.replace("LANE ", "LANE 0")}</h2>
                <span className={lane.state === "QUIET" ? "is-quiet" : lane.state === "DEGRADED" ? "is-degraded" : "is-blocked"}>
                  {lane.state}
                </span>
              </div>
              <div className="l4-gateLaneMid">
                <strong>{lane.count}</strong>
                <span>{lane.key === "dispatch" ? "PENDING" : "REMAINING"}</span>
              </div>
              <p>{lane.key === "vagueness" && lane.count > 0 ? "Revenue exposure uncomputed." : lane.intel}</p>
              {lane.warningCount > 0 && lane.warningIntel ? (
                <p className="l4-gateLaneWarning">{lane.warningCount} decay warning · {lane.warningIntel}</p>
              ) : null}
              {lane.count > 0 ? (
                <button type="button" onClick={() => onNavigate(lane.path)}>
                  {lane.key === "vagueness" ? "RESTORE CLARITY" : lane.key === "dispatch" ? "OPEN ROUTES" : "OPEN LIVE"}
                </button>
              ) : null}
            </article>
          ))}
        </div>
        <div className="border-t border-red-500/30 p-4 text-center text-xs uppercase tracking-[0.16em] text-white/45">
          Boss encounter appears when the territory is stabilized.
        </div>
      </div>
    </section>
  );
}

function Level4Complete({ dailyXp }: { dailyXp: number }) {
  return (
    <section className="min-h-screen bg-[#0e1111] text-[#e5e7eb] px-4 py-12 font-mono">
      <div className="mx-auto max-w-3xl border border-emerald-500/45 bg-black/35 p-8 text-center">
        <div className="text-[11px] uppercase tracking-[0.22em] text-emerald-300">LEVEL 4 COMPLETE FOR TODAY</div>
        <h1 className="mt-4 text-3xl font-semibold tracking-[0.12em]">TERRITORY PRESSURE REDUCED</h1>
        <div className="mt-6">
          <Level4BoardScene gateState="COMPLETE_TODAY" activeChallenge={null} />
        </div>
        <p className="mt-4 text-sm text-white/60">No boss target is currently available from real Level 4 data.</p>
        <div className="mt-8 inline-flex border border-emerald-400/40 px-4 py-2 text-sm text-emerald-200">
          TODAY: +{dailyXp.toLocaleString("en-US")} XP
        </div>
      </div>
    </section>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-mono uppercase tracking-wide text-[var(--ink-muted)]">{label}</p>
      <p className={mono ? "font-mono text-xs whitespace-pre-wrap" : "font-sans"}>{value}</p>
    </div>
  );
}
