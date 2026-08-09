import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileText,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useRoute } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { trpc } from "@/lib/trpc";
import {
  FIELD_OUTCOME_REASONS,
  type FieldOutcomeReason,
} from "@shared/commercialMissionField";
import "./commercial-sales-mission.css";

function money(cents: number | null): string {
  if (cents === null) return "Estimate unavailable — needs qualification";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function requestId(): string {
  return crypto.randomUUID();
}

function SectionHeader({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <header className="csm-screen-head">
      <span>{eyebrow}</span>
      <h1>{title}</h1>
      {body ? <p>{body}</p> : null}
    </header>
  );
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  secondary = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <button
      type="button"
      className={`csm-action${secondary ? " is-secondary" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export default function CommercialSalesMission() {
  const [, params] = useRoute("/driver/sales-mission/:missionId");
  const missionId = Number(params?.missionId);
  const validMissionId = Number.isInteger(missionId) && missionId > 0;
  const { loading: authLoading, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const stateQuery = trpc.system.commercialMission.fieldState.useQuery(
    { missionId: validMissionId ? missionId : 1 },
    { enabled: isAuthenticated && validMissionId, retry: false }
  );
  const startPreparation =
    trpc.system.commercialMission.fieldStartPreparation.useMutation();
  const checklistMutation =
    trpc.system.commercialMission.fieldChecklist.useMutation();
  const departMutation =
    trpc.system.commercialMission.fieldDepart.useMutation();
  const arriveMutation =
    trpc.system.commercialMission.fieldArrive.useMutation();
  const notesMutation =
    trpc.system.commercialMission.fieldSaveNotes.useMutation();
  const outcomeMutation =
    trpc.system.commercialMission.fieldOutcome.useMutation();
  const handoffMutation =
    trpc.system.commercialMission.consumePhoneHandoff.useMutation();
  const irlStepMutation =
    trpc.system.commercialMission.advanceIrlStep.useMutation();
  const proofMutation = trpc.system.commercialMission.submitProof.useMutation();
  const callAttempts = trpc.system.commercialMission.callAttempts.useQuery(
    { missionId: validMissionId ? missionId : 1 },
    { enabled: isAuthenticated && validMissionId, retry: false }
  );
  const callAttemptMutation =
    trpc.system.commercialMission.logCallAttempt.useMutation();
  const [callOutcome, setCallOutcome] = useState<
    | "no_answer"
    | "left_voicemail"
    | "spoke"
    | "visit_booked"
    | "not_a_fit"
    | "contact_unavailable"
  >("no_answer");
  const [callNotes, setCallNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [decisionMakerStatus, setDecisionMakerStatus] = useState<
    "met" | "unavailable" | "not_recorded"
  >("not_recorded");
  const [collateralDelivered, setCollateralDelivered] = useState(false);
  const [quoteRequested, setQuoteRequested] = useState(false);
  const [pilotRequested, setPilotRequested] = useState(false);
  const [followUpRequested, setFollowUpRequested] = useState(false);
  const [followUpAt, setFollowUpAt] = useState("");
  const [reason, setReason] = useState<FieldOutcomeReason>("other");
  const [actionError, setActionError] = useState<string | null>(null);
  const consumedHandoffRef = useRef(false);

  const state = stateQuery.data;
  const mission = state?.mission;
  const builderMetadata = mission?.opportunity.evidence?.find(
    item => item.source === "driver_mission_builder"
  );
  const diamond = mission?.opportunity.evidence?.find(
    item => item.source === "driver_sales_diamond"
  ) as Record<string, unknown> | undefined;
  const callRequired = builderMetadata?.missionType !== "in_person";
  const activeIrlStep = mission?.steps.find(
    step =>
      ["ready", "active", "awaiting_review", "rejected"].includes(
        step.status
      ) && step.type !== "generic"
  );
  const coaching = trpc.system.commercialMission.coaching.useQuery(
    {
      missionId: validMissionId ? missionId : 1,
      stepId:
        activeIrlStep?.type === "sales_training"
          ? (activeIrlStep.id ?? null)
          : null,
    },
    {
      enabled: Boolean(
        isAuthenticated &&
          validMissionId &&
          activeIrlStep?.type === "sales_training"
      ),
      retry: false,
    }
  );
  const generateCoaching =
    trpc.system.commercialMission.generateCoaching.useMutation();
  useEffect(() => {
    if (state?.field) setNotes(state.field.notes);
  }, [state?.field?.notes]);

  useEffect(() => {
    if (!isAuthenticated || !validMissionId || consumedHandoffRef.current)
      return;
    const token = new URLSearchParams(window.location.search).get("handoff");
    if (!token) return;
    consumedHandoffRef.current = true;
    window.history.replaceState({}, "", `/driver/sales-mission/${missionId}`);
    handoffMutation.mutate(
      { missionId, token },
      {
        onSuccess: next => {
          if (next)
            utils.system.commercialMission.fieldState.setData(
              { missionId },
              next
            );
        },
        onError: error => setActionError(error.message),
      }
    );
  }, [handoffMutation, isAuthenticated, missionId, utils, validMissionId]);

  const mutate = async <T,>(
    operation: () => Promise<T>,
    adopt: (value: T) => void
  ) => {
    setActionError(null);
    try {
      const result = await operation();
      adopt(result);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The mission could not be updated."
      );
    }
  };

  const adoptState = (next: NonNullable<typeof state>) => {
    utils.system.commercialMission.fieldState.setData({ missionId }, next);
  };

  const allRequiredReady =
    Boolean(state?.checklist.some(item => item.required)) &&
    Boolean(state?.proposal) &&
    (state?.checklist.every(
      item => !item.required || item.status === "completed"
    ) ??
      false);
  const busy =
    startPreparation.isPending ||
    checklistMutation.isPending ||
    departMutation.isPending ||
    arriveMutation.isPending ||
    notesMutation.isPending ||
    outcomeMutation.isPending ||
    callAttemptMutation.isPending;
  const stageIndex = mission
    ? ((
        {
          phone_ready: 0,
          preparing: 1,
          en_route: 2,
          arrived: 3,
          visit_completed: 4,
          follow_up: 4,
          won: 4,
          lost: 4,
        } as Record<string, number>
      )[mission.status] ?? 0)
    : 0;

  const annualValue = useMemo(
    () => (mission ? money(mission.opportunity.estimatedAnnualValueCents) : ""),
    [mission]
  );

  if (authLoading)
    return (
      <main className="csm-root">
        <Loader2 className="csm-loader" />
      </main>
    );
  if (!isAuthenticated)
    return (
      <LoginForm role="driver" onSuccess={() => window.location.reload()} />
    );
  if (!validMissionId)
    return (
      <main className="csm-root">
        <div className="csm-error">Invalid commercial mission ID.</div>
      </main>
    );
  if (stateQuery.isLoading)
    return (
      <main className="csm-root">
        <Loader2 className="csm-loader" />
      </main>
    );
  if (stateQuery.error || !state || !mission)
    return (
      <main className="csm-root">
        <div className="csm-error">
          {stateQuery.error?.message ?? "Mission unavailable"}
        </div>
      </main>
    );

  const arriveWithLocation = () => {
    if (!navigator.geolocation) {
      setActionError("Location is unavailable. Use manual check-in instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position =>
        void mutate(
          () =>
            arriveMutation.mutateAsync({
              missionId,
              expectedMissionVersion: mission.version,
              expectedFieldVersion: state.field!.version,
              requestId: requestId(),
              checkInMethod: "location",
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              locationAccuracyMeters: Math.round(position.coords.accuracy),
            }),
          next => next && adoptState(next)
        ),
      () =>
        setActionError(
          "Location permission was not granted. Manual check-in remains available."
        ),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
    );
  };

  const submitOutcome = (outcome: "follow_up" | "won" | "lost") =>
    void mutate(
      () =>
        outcomeMutation.mutateAsync({
          missionId,
          expectedMissionVersion: mission.version,
          expectedFieldVersion: state.field!.version,
          requestId: requestId(),
          outcome,
          notes,
          followUpAt:
            outcome === "follow_up" && followUpAt
              ? new Date(followUpAt)
              : undefined,
          decisionMakerStatus,
          collateralDelivered,
          quoteRequested,
          pilotRequested,
          followUpRequested,
          reason: outcome === "lost" ? reason : undefined,
        }),
      adoptState
    );

  return (
    <main className="csm-root">
      <a
        href="/dayforge-today?walkIn=1"
        className="fixed bottom-4 right-4 z-50 rounded-xl bg-orange-500 px-4 py-3 text-xs font-black text-white shadow-xl"
      >
        LOG A WALK-IN
      </a>
      <div className="csm-phone-shell">
        <div className="csm-statusbar" aria-hidden="true">
          <span>DAYFORGE FIELD</span>
          <span>SECURE · LIVE</span>
        </div>
        <nav className="csm-nav">
          <div>
            <small>{mission.code}</small>
            <b>{mission.account.name}</b>
          </div>
          <span className="csm-live-dot">SERVER</span>
        </nav>
        <div className="csm-progress" aria-label={`Mission ${mission.status}`}>
          {[0, 1, 2, 3, 4].map(step => (
            <i key={step} className={step <= stageIndex ? "is-done" : ""} />
          ))}
        </div>
        {actionError ? (
          <div className="csm-error" role="alert">
            {actionError}
          </div>
        ) : null}

        <section className="csm-screen">
          {activeIrlStep ? (
            <article
              className={`mb-5 overflow-hidden rounded-3xl border border-orange-300/30 p-5 text-white shadow-2xl ${activeIrlStep.type === "wardrobe_review" ? "bg-gradient-to-br from-fuchsia-950 via-slate-950 to-orange-950" : activeIrlStep.type === "collateral_pickup" ? "bg-gradient-to-br from-orange-950 via-slate-950 to-amber-950" : activeIrlStep.type === "purchase_stop" ? "bg-gradient-to-br from-emerald-950 via-slate-950 to-cyan-950" : activeIrlStep.type === "sales_training" ? "bg-gradient-to-br from-indigo-950 via-slate-950 to-purple-950" : activeIrlStep.type === "field_visit" ? "bg-gradient-to-br from-sky-950 via-slate-950 to-amber-950" : "bg-gradient-to-br from-slate-900 to-orange-950"}`}
            >
              <div className="flex items-center justify-between">
                <small className="font-black tracking-[.18em] text-orange-300">
                  CURRENT LEVEL · {activeIrlStep.position + 1}/
                  {mission.steps.filter(step => step.type !== "generic").length}
                </small>
                <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase">
                  {activeIrlStep.status.replaceAll("_", " ")}
                </span>
              </div>
              <h2 className="mt-4 text-3xl font-black">
                {activeIrlStep.label}
              </h2>
              <p className="mt-2 text-sm text-white/75">
                {activeIrlStep.instructionText ?? activeIrlStep.detail}
              </p>
              {activeIrlStep.destinationName ? (
                <div className="mt-4 rounded-2xl bg-black/30 p-4">
                  <small className="font-bold text-white/50">DESTINATION</small>
                  <b className="block text-lg">
                    {activeIrlStep.destinationName}
                  </b>
                  <span className="text-sm text-white/70">
                    {activeIrlStep.destinationAddress}
                  </span>
                </div>
              ) : null}
              {activeIrlStep.type === "sales_training" ? (
                coaching.data?.structuredOutput ? (
                  <div className="mt-4 space-y-3 rounded-2xl bg-black/35 p-4">
                    <div>
                      <small className="font-black text-orange-300">
                        ASK FOR · TYPICAL ROLE
                      </small>
                      <b className="block text-2xl">
                        {coaching.data.structuredOutput.recommendedRole}
                      </b>
                    </div>
                    <div>
                      <small className="font-black text-sky-300">
                        FIRST MOVE
                      </small>
                      <p>
                        {coaching.data.structuredOutput.firstNavigationPoint}
                      </p>
                    </div>
                    <div>
                      <small className="font-black text-sky-300">
                        FALLBACK
                      </small>
                      <p>
                        {coaching.data.structuredOutput.fallbackNavigationPoint}
                      </p>
                    </div>
                    <blockquote className="border-l-4 border-orange-400 pl-3 text-lg font-bold">
                      “{coaching.data.structuredOutput.openingLine}”
                    </blockquote>
                    <div className="flex flex-wrap gap-2">
                      {coaching.data.structuredOutput.claims.map(
                        (claim, index) => (
                          <span
                            key={`${claim.key}-${index}`}
                            className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold"
                          >
                            {claim.provenance === "general_industry_guidance"
                              ? "TYPICAL ROLE"
                              : claim.provenance
                                  .replaceAll("_", " ")
                                  .toUpperCase()}
                          </span>
                        )
                      )}
                    </div>
                    <p className="text-xs text-white/55">
                      {coaching.data.generationStatus === "fallback"
                        ? "Provider unavailable — tested deterministic fallback."
                        : `${coaching.data.provider} · ${coaching.data.modelId}`}
                    </p>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={generateCoaching.isPending || !activeIrlStep.id}
                    onClick={async () => {
                      if (!activeIrlStep.id) return;
                      await generateCoaching.mutateAsync({
                        missionId: mission.id,
                        stepId: activeIrlStep.id,
                        requestId: crypto.randomUUID(),
                      });
                      await coaching.refetch();
                    }}
                    className="mt-4 w-full rounded-2xl border border-indigo-300/40 px-4 py-4 font-black"
                  >
                    {generateCoaching.isPending
                      ? "ROOK IS MAPPING THE ROOM…"
                      : "GENERATE LIVE ROOK COACHING"}
                  </button>
                )
              ) : null}
              {activeIrlStep.deadlineAt ? (
                <p className="mt-4 text-lg font-black">
                  COUNTDOWN ENDS{" "}
                  {new Date(activeIrlStep.deadlineAt).toLocaleTimeString()} ·
                  TIME'S UP NEVER BLOCKS COMPLETION
                </p>
              ) : null}
              {activeIrlStep.mapsUrl ? (
                <a
                  href={activeIrlStep.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 block rounded-2xl border border-white/25 px-5 py-4 text-center font-black"
                >
                  OPEN GOOGLE MAPS — PARK BEFORE RETURNING
                </a>
              ) : null}
              {activeIrlStep.status === "awaiting_review" ? (
                <p className="mt-4 rounded-2xl bg-amber-400/15 p-4 font-bold text-amber-200">
                  AWAITING MANUAL REVIEW. Your submitted proof remains
                  server-backed.
                </p>
              ) : activeIrlStep.status === "rejected" ? (
                <label className="mt-4 block rounded-2xl bg-red-400/15 p-4 font-bold text-red-200">
                  REJECTED:{" "}
                  {activeIrlStep.rejectionReason ??
                    "Review the instructions and retry."}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    capture="environment"
                    className="mt-3 block w-full text-xs"
                    onChange={async event => {
                      const file = event.target.files?.[0];
                      if (!file || !activeIrlStep.id) return;
                      const bytes = new Uint8Array(await file.arrayBuffer());
                      let binary = "";
                      for (let index = 0; index < bytes.length; index += 1)
                        binary += String.fromCharCode(bytes[index]);
                      await proofMutation.mutateAsync({
                        missionId: mission.id,
                        missionStepId: activeIrlStep.id,
                        requestId: crypto.randomUUID(),
                        mimeType: file.type as "image/jpeg",
                        dataBase64: btoa(binary),
                      });
                      await stateQuery.refetch();
                    }}
                  />
                </label>
              ) : activeIrlStep.proofRequirement === "photo" &&
                activeIrlStep.status === "active" ? (
                <label className="mt-5 block min-h-16 cursor-pointer rounded-2xl bg-orange-500 px-5 py-5 text-center text-lg font-black">
                  CAPTURE + SUBMIT PROOF
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    capture="environment"
                    className="sr-only"
                    onChange={async event => {
                      const file = event.target.files?.[0];
                      if (!file || !activeIrlStep.id) return;
                      const bytes = new Uint8Array(await file.arrayBuffer());
                      let binary = "";
                      for (let index = 0; index < bytes.length; index += 1)
                        binary += String.fromCharCode(bytes[index]);
                      await proofMutation.mutateAsync({
                        missionId: mission.id,
                        missionStepId: activeIrlStep.id,
                        requestId: crypto.randomUUID(),
                        mimeType: file.type as "image/jpeg",
                        dataBase64: btoa(binary),
                      });
                      await stateQuery.refetch();
                    }}
                  />
                </label>
              ) : (
                <button
                  type="button"
                  disabled={irlStepMutation.isPending}
                  onClick={async () => {
                    await irlStepMutation.mutateAsync({
                      missionId: mission.id,
                      stepKey: activeIrlStep.key,
                      requestId: crypto.randomUUID(),
                      action:
                        activeIrlStep.status === "ready" ? "start" : "complete",
                    });
                    await stateQuery.refetch();
                  }}
                  className="mt-5 min-h-16 w-full rounded-2xl bg-orange-500 px-5 text-lg font-black"
                >
                  {activeIrlStep.status === "ready"
                    ? "REVEAL OBJECTIVE"
                    : activeIrlStep.proofRequirement === "photo"
                      ? "SUBMIT FOR REVIEW"
                      : "COMPLETE + UNLOCK NEXT"}
                </button>
              )}
              {activeIrlStep.type === "field_visit" ? (
                <p className="mt-3 text-center text-xs font-bold text-white/60">
                  No app interaction is required while driving. Continue only
                  when parked.
                </p>
              ) : null}
            </article>
          ) : null}
          {mission.status === "phone_ready" ? (
            <>
              <SectionHeader
                eyebrow="MISSION UNLOCKED"
                title={`${mission.account.name} is ready for the field.`}
                body="This is the same persisted mission you completed in BORESLAY."
              />
              <article className="csm-hero-card">
                <Building2 />
                <div>
                  <small>{mission.account.accountType}</small>
                  <h2>{mission.account.name}</h2>
                  <p>{mission.account.address}</p>
                </div>
                <strong>
                  {annualValue}
                  <small>EST. ANNUAL VALUE</small>
                </strong>
              </article>
              {diamond ? (
                <article className="mb-5 overflow-hidden rounded-3xl border border-fuchsia-300/40 bg-gradient-to-br from-violet-950 via-slate-950 to-fuchsia-950 p-5 text-white shadow-[0_18px_50px_rgba(168,85,247,.28)]">
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fuchsia-300 text-violet-950">
                      <Sparkles className="h-6 w-6" />
                    </span>
                    <div>
                      <small className="font-black uppercase tracking-[.2em] text-fuchsia-200">
                        Your diamond
                      </small>
                      <h3 className="text-2xl font-black">
                        {String(diamond.title ?? "Field advantage")}
                      </h3>
                    </div>
                  </div>
                  <p className="mt-4 text-base font-bold text-white/75">
                    {String(diamond.cue ?? "")}
                  </p>
                  <blockquote className="mt-4 border-l-4 border-fuchsia-300 pl-4 text-lg font-black leading-relaxed">
                    “{String(diamond.response ?? "")}”
                  </blockquote>
                  <p className="mt-4 rounded-2xl bg-white/[.07] p-4 text-sm font-semibold text-white/75">
                    Then ask: {String(diamond.followUp ?? "")}
                  </p>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[.12em] text-white/40">
                    {String(diamond.sourceLabel ?? "Laundry Butler playbook")}
                  </p>
                </article>
              ) : null}
              <div className="csm-facts">
                <article>
                  <UserRound />
                  <span>
                    <small>ASK FOR</small>
                    <b>
                      {mission.account.decisionMaker.name ??
                        "Decision-maker not yet identified"}
                    </b>
                    <em>
                      {mission.account.decisionMaker.title ??
                        "Confirm the right contact"}
                    </em>
                  </span>
                </article>
                <article>
                  <Sparkles />
                  <span>
                    <small>WHY NOW</small>
                    <b>{mission.opportunity.primarySignal}</b>
                    <em>
                      {mission.opportunity.estimateConfidence} confidence
                      estimate
                    </em>
                  </span>
                </article>
                <article>
                  <ShieldCheck />
                  <span>
                    <small>BEST ANGLE</small>
                    <b>{mission.brief.salesAngle}</b>
                    <em>
                      Use sourced facts and confirm assumptions in person.
                    </em>
                  </span>
                </article>
              </div>
              {callRequired ? (
                <article className="mb-5 rounded-3xl border border-sky-300/25 bg-sky-950/60 p-5 text-white">
                  <div className="flex items-start gap-3">
                    <PhoneCall className="mt-1 h-6 w-6 shrink-0 text-sky-300" />
                    <div>
                      <small className="font-black tracking-[.16em] text-sky-300">
                        COLD-CALL CHECKPOINT
                      </small>
                      <h2 className="mt-1 text-2xl font-black">
                        Call before you travel.
                      </h2>
                      <p className="mt-1 text-sm text-white/65">
                        The app never dials automatically. Place the call
                        yourself, then record only what actually happened.
                      </p>
                    </div>
                  </div>
                  {mission.account.decisionMaker.phone ? (
                    <a
                      className="mt-4 block min-h-14 rounded-2xl border border-sky-300/40 px-5 py-4 text-center font-black"
                      href={`tel:${mission.account.decisionMaker.phone}`}
                    >
                      CALL{" "}
                      {mission.account.decisionMaker.name ?? "PROPERTY CONTACT"}
                    </a>
                  ) : (
                    <p className="mt-4 rounded-2xl bg-white/10 p-4 text-sm font-bold">
                      No verified phone number is attached. Research it
                      separately, or log “contact unavailable.”
                    </p>
                  )}
                  <label className="mt-4 block text-sm font-bold">
                    Call outcome
                    <select
                      value={callOutcome}
                      onChange={event =>
                        setCallOutcome(event.target.value as typeof callOutcome)
                      }
                      className="mt-2 w-full rounded-xl border border-white/15 bg-slate-950 px-4 py-3"
                    >
                      <option value="no_answer">No answer</option>
                      <option value="left_voicemail">Left voicemail</option>
                      <option value="spoke">Spoke with contact</option>
                      <option value="visit_booked">Visit booked</option>
                      <option value="not_a_fit">Not a fit</option>
                      <option value="contact_unavailable">
                        Contact unavailable
                      </option>
                    </select>
                  </label>
                  <label className="mt-4 block text-sm font-bold">
                    Call notes
                    <textarea
                      value={callNotes}
                      onChange={event => setCallNotes(event.target.value)}
                      rows={3}
                      placeholder="Record what happened—never invent an answer."
                      className="mt-2 w-full rounded-xl border border-white/15 bg-slate-950 px-4 py-3"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={
                      callAttemptMutation.isPending || !callNotes.trim()
                    }
                    onClick={async () => {
                      setActionError(null);
                      try {
                        await callAttemptMutation.mutateAsync({
                          missionId,
                          requestId: requestId(),
                          outcome: callOutcome,
                          notes: callNotes,
                        });
                        setCallNotes("");
                        await callAttempts.refetch();
                      } catch (error) {
                        setActionError(
                          error instanceof Error
                            ? error.message
                            : "The call attempt could not be saved."
                        );
                      }
                    }}
                    className="mt-4 min-h-14 w-full rounded-2xl bg-sky-500 px-5 font-black disabled:opacity-40"
                  >
                    {callAttemptMutation.isPending
                      ? "SAVING CALL…"
                      : "LOG CALL ATTEMPT"}
                  </button>
                  {callAttempts.data?.length ? (
                    <p
                      role="status"
                      className="mt-3 text-sm font-bold text-emerald-300"
                    >
                      {callAttempts.data.length} call attempt
                      {callAttempts.data.length === 1 ? "" : "s"} saved ·
                      latest:{" "}
                      {callAttempts.data.at(-1)!.outcome.replaceAll("_", " ")}
                    </p>
                  ) : null}
                </article>
              ) : (
                <article className="mb-5 rounded-3xl border border-violet-300/25 bg-violet-950/60 p-5 text-white">
                  <small className="font-black tracking-[.16em] text-violet-300">
                    IN-PERSON SALES STOP
                  </small>
                  <h2 className="mt-1 text-2xl font-black">
                    Prepare, then visit when parked.
                  </h2>
                  <p className="mt-2 text-sm text-white/65">
                    This mission was intentionally built for an in-person
                    introduction, so no cold-call checkpoint is required.
                  </p>
                </article>
              )}
              <ActionButton
                disabled={busy || (callRequired && !callAttempts.data?.length)}
                onClick={() =>
                  void mutate(
                    () =>
                      startPreparation.mutateAsync({
                        missionId,
                        expectedMissionVersion: mission.version,
                        requestId: requestId(),
                      }),
                    adoptState
                  )
                }
              >
                Start mission preparation <ArrowRight />
              </ActionButton>
              {callRequired && !callAttempts.data?.length ? (
                <p className="csm-privacy">
                  Log the cold-call checkpoint before starting mission
                  preparation.
                </p>
              ) : null}
            </>
          ) : null}

          {mission.status === "preparing" && state.field ? (
            <>
              <SectionHeader
                eyebrow="PREPARE"
                title="Walk in ready."
                body="Every check is persisted. Required items must be complete before departure."
              />
              <div className="csm-checklist">
                {state.checklist.map(item => (
                  <button
                    type="button"
                    key={item.itemKey}
                    className={item.status === "completed" ? "is-complete" : ""}
                    disabled={
                      busy || (item.itemKey === "collateral" && !state.proposal)
                    }
                    onClick={() =>
                      void mutate(
                        () =>
                          checklistMutation.mutateAsync({
                            missionId,
                            expectedFieldVersion: state.field!.version,
                            itemKey: item.itemKey,
                            status:
                              item.status === "completed"
                                ? "pending"
                                : "completed",
                            requestId: requestId(),
                          }),
                        adoptState
                      )
                    }
                  >
                    <span>
                      <FileText />
                    </span>
                    <span>
                      <b>
                        {item.label}
                        {item.required ? " *" : ""}
                      </b>
                      <small>{item.detail}</small>
                    </span>
                    <i>{item.status === "completed" ? <Check /> : null}</i>
                  </button>
                ))}
              </div>
              <div className="csm-collateral-note">
                <FileText />
                <div>
                  <b>Proposal & collateral</b>
                  {state.proposal ? (
                    <p>
                      Approved version {state.proposal.version} is current.{" "}
                      <a href={`/commercial-proposal/${missionId}`}>
                        Open or print the leave-behind.
                      </a>
                    </p>
                  ) : (
                    <p>
                      No current approved proposal. DayForge will not let this
                      mission claim the leave-behind is ready.
                    </p>
                  )}
                </div>
              </div>
              <ActionButton
                disabled={busy || !allRequiredReady}
                onClick={() =>
                  void mutate(
                    () =>
                      departMutation.mutateAsync({
                        missionId,
                        expectedMissionVersion: mission.version,
                        expectedFieldVersion: state.field!.version,
                        requestId: requestId(),
                      }),
                    next => next && adoptState(next)
                  )
                }
              >
                Depart for account <Navigation />
              </ActionButton>
            </>
          ) : null}

          {mission.status === "en_route" && state.field ? (
            <>
              <SectionHeader
                eyebrow="EN ROUTE"
                title="Finish the mission in the real world."
                body="Navigation opens outside DayForge. Return here to check in."
              />
              <div className="csm-route-card">
                <MapPin />
                <div>
                  <small>DESTINATION</small>
                  <h2>{mission.account.name}</h2>
                  <p>{mission.account.address}</p>
                </div>
              </div>
              <a
                className="csm-action"
                href={state.navigationUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open navigation <Navigation />
              </a>
              <ActionButton disabled={busy} onClick={arriveWithLocation}>
                <LocateFixed /> Check in with location
              </ActionButton>
              <ActionButton
                secondary
                disabled={busy}
                onClick={() =>
                  void mutate(
                    () =>
                      arriveMutation.mutateAsync({
                        missionId,
                        expectedMissionVersion: mission.version,
                        expectedFieldVersion: state.field!.version,
                        requestId: requestId(),
                        checkInMethod: "manual",
                      }),
                    next => next && adoptState(next)
                  )
                }
              >
                Manual check-in
              </ActionButton>
              <p className="csm-privacy">
                Location is optional. DayForge stores coordinates only when you
                explicitly choose location check-in.
              </p>
            </>
          ) : null}

          {mission.status === "arrived" && state.field ? (
            <>
              <SectionHeader
                eyebrow="ARRIVED"
                title="Walk in with the opener ready."
                body="Confirm what you learn. Do not treat estimates as facts."
              />
              <div className="csm-script">
                <small>OPENING LINE</small>
                <blockquote>“{mission.brief.openingLine}”</blockquote>
                <small>BEST ANGLE</small>
                <p>{mission.brief.salesAngle}</p>
              </div>
              <div className="csm-question-list">
                <h3>DISCOVERY QUESTIONS</h3>
                {mission.brief.discoveryQuestions.map(question => (
                  <p key={question}>{question}</p>
                ))}
              </div>
              <label className="csm-notes">
                <span>VISIT NOTES</span>
                <textarea
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  rows={5}
                  placeholder="Record only what happened and what was said…"
                />
              </label>
              <ActionButton
                secondary
                disabled={busy || notes === state.field.notes}
                onClick={() =>
                  void mutate(
                    () =>
                      notesMutation.mutateAsync({
                        missionId,
                        expectedFieldVersion: state.field!.version,
                        notes,
                        requestId: requestId(),
                      }),
                    next => next && adoptState(next)
                  )
                }
              >
                Save notes
              </ActionButton>
              <div className="csm-visit-facts">
                <label>
                  Decision-maker
                  <select
                    value={decisionMakerStatus}
                    onChange={event =>
                      setDecisionMakerStatus(
                        event.target.value as typeof decisionMakerStatus
                      )
                    }
                  >
                    <option value="not_recorded">Not recorded</option>
                    <option value="met">Met</option>
                    <option value="unavailable">Unavailable</option>
                  </select>
                </label>
                {[
                  [
                    "Collateral delivered",
                    collateralDelivered,
                    setCollateralDelivered,
                  ],
                  ["Quote requested", quoteRequested, setQuoteRequested],
                  ["Pilot requested", pilotRequested, setPilotRequested],
                  [
                    "Follow-up requested",
                    followUpRequested,
                    setFollowUpRequested,
                  ],
                ].map(([label, checked, setter]) => (
                  <label key={String(label)}>
                    <input
                      type="checkbox"
                      checked={Boolean(checked)}
                      onChange={event =>
                        (setter as (value: boolean) => void)(
                          event.target.checked
                        )
                      }
                    />{" "}
                    {String(label)}
                  </label>
                ))}
              </div>
              <label className="csm-followup">
                Follow-up date
                <input
                  type="datetime-local"
                  value={followUpAt}
                  onChange={event => setFollowUpAt(event.target.value)}
                />
              </label>
              <label className="csm-followup">
                Lost reason
                <select
                  value={reason}
                  onChange={event =>
                    setReason(event.target.value as FieldOutcomeReason)
                  }
                >
                  {FIELD_OUTCOME_REASONS.map(value => (
                    <option key={value} value={value}>
                      {value.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <div className="csm-outcomes">
                <ActionButton
                  disabled={busy || !notes.trim()}
                  onClick={() => submitOutcome("won")}
                >
                  <CheckCircle2 /> Account won
                </ActionButton>
                <ActionButton
                  secondary
                  disabled={busy || !notes.trim() || !followUpAt}
                  onClick={() => submitOutcome("follow_up")}
                >
                  <Clock3 /> Follow-up needed
                </ActionButton>
                <ActionButton
                  secondary
                  disabled={busy || !notes.trim()}
                  onClick={() => submitOutcome("lost")}
                >
                  Not a fit
                </ActionButton>
              </div>
            </>
          ) : null}

          {["follow_up", "won", "lost"].includes(mission.status) ? (
            <div
              className={`csm-complete${mission.status === "won" ? " is-won" : ""}`}
            >
              <span>
                {mission.status === "won" ? <CheckCircle2 /> : <Clock3 />}
              </span>
              <small>{mission.code}</small>
              <h1>
                {mission.status === "won"
                  ? "Account won."
                  : mission.status === "follow_up"
                    ? "Follow-up recorded."
                    : "Mission learned from."}
              </h1>
              <p>{mission.account.name}</p>
              {mission.status === "won" ? (
                <strong>
                  <CircleDollarSign /> {annualValue} estimated contract value
                </strong>
              ) : null}
              <div className="csm-summary">
                <small>REALIZED REVENUE</small>
                <b>$0 until a paid order is attributed</b>
                <small>VISIT NOTES</small>
                <b>{state.visitOutcome?.notes || "No notes recorded"}</b>
              </div>
              <a className="csm-action" href="/driver">
                Back to Goldline
              </a>
            </div>
          ) : null}
        </section>
        <footer className="csm-footer">
          <span>
            <Sparkles /> Same mission on every device
          </span>
          <small>
            ID {mission.id} · v{mission.version}
          </small>
        </footer>
      </div>
    </main>
  );
}
