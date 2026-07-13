import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarClock,
  Check,
  CircleDollarSign,
  ClipboardCheck,
  FileSignature,
  Loader2,
  MapPinned,
  PackageCheck,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  UserRoundCheck,
  XCircle,
} from "lucide-react";
import { Link } from "wouter";
import { LoginForm } from "@/components/LoginForm";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  COMMERCIAL_PIPELINE_STAGE_LABELS,
  COMMERCIAL_PIPELINE_STAGES,
  canAdvanceRelationshipStage,
  type CommercialPipelineStage,
} from "@shared/commercialPipeline";
import "./commercial-pipeline.css";

const AGREEMENT_CONFIRMATION =
  "I verified this approved agreement value and its evidence" as const;
const ORDER_CONFIRMATION =
  "I verified this order belongs to this commercial account" as const;

function money(cents: number | null): string {
  if (cents === null) return "Not recorded";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function localDateTime(days = 1): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function shortDate(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CommercialPipelinePage() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const pipeline = trpc.system.commercialPipeline.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const detail = trpc.system.commercialPipeline.detail.useQuery(
    { pipelineId: selectedId ?? 0 },
    { enabled: isAuthenticated && selectedId !== null }
  );
  const advance =
    trpc.system.commercialPipeline.advanceRelationship.useMutation();
  const resolve = trpc.system.commercialPipeline.resolve.useMutation();
  const schedule =
    trpc.system.commercialPipeline.scheduleFollowUp.useMutation();
  const complete =
    trpc.system.commercialPipeline.completeFollowUp.useMutation();
  const approveAgreement =
    trpc.system.commercialPipeline.approveAgreement.useMutation();
  const attributeOrder =
    trpc.system.commercialPipeline.attributeOrder.useMutation();
  const reconcile =
    trpc.system.commercialPipeline.reconcileRevenue.useMutation();
  const [relationshipNote, setRelationshipNote] = useState("");
  const [followUpAt, setFollowUpAt] = useState(localDateTime());
  const [followUpNote, setFollowUpNote] = useState("");
  const [agreementDollars, setAgreementDollars] = useState("");
  const [agreementEvidence, setAgreementEvidence] = useState("");
  const [orderId, setOrderId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId === null && pipeline.data?.[0])
      setSelectedId(pipeline.data[0].id);
  }, [pipeline.data, selectedId]);
  const selectedSummary =
    pipeline.data?.find(item => item.id === selectedId) ?? null;
  const selected = detail.data ?? null;

  const metrics = useMemo(() => {
    const records = pipeline.data ?? [];
    return {
      active: records.filter(item => !["won", "lost"].includes(item.stage))
        .length,
      weighted: records
        .filter(item => item.stage !== "lost")
        .reduce(
          (sum, item) => sum + item.values.estimatedContractValueCents,
          0
        ),
      won: records.filter(item => item.stage === "won").length,
      realized: records.reduce(
        (sum, item) => sum + item.values.realizedRevenueCents,
        0
      ),
    };
  }, [pipeline.data]);
  const busy =
    advance.isPending ||
    resolve.isPending ||
    schedule.isPending ||
    complete.isPending ||
    approveAgreement.isPending ||
    attributeOrder.isPending ||
    reconcile.isPending;

  const perform = async (action: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    try {
      await action();
      await Promise.all([
        pipeline.refetch(),
        selectedId === null ? Promise.resolve() : detail.refetch(),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed");
    }
  };

  if (authLoading)
    return (
      <main className="cp-root cp-center">
        <Loader2 className="cp-spin" />
      </main>
    );
  if (!isAuthenticated)
    return (
      <LoginForm role="admin" onSuccess={() => window.location.reload()} />
    );

  return (
    <main className="cp-root">
      <div className="cp-shell">
        <header className="cp-header">
          <div>
            <span className="cp-kicker">
              <TrendingUp /> DAYFORGE REVENUE PIPELINE
            </span>
            <h1>The mission becomes a business.</h1>
            <p>
              One account from territory discovery through BORESLAY, the field
              visit, commercial conversion, first order, and realized revenue.
            </p>
          </div>
          <div className="cp-header-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const result = await reconcile.mutateAsync();
                  setNotice(
                    result.updated
                      ? `${result.updated} paid-order attribution${result.updated === 1 ? "" : "s"} refreshed`
                      : "Revenue is current"
                  );
                })
              }
            >
              <RefreshCw className={reconcile.isPending ? "cp-spin" : ""} />
              Refresh revenue
            </button>
            <Link href="/commercial-missions">
              <ArrowLeft /> Missions
            </Link>
          </div>
        </header>

        {error ? (
          <div className="cp-alert is-error" role="alert">
            <XCircle /> {error}
          </div>
        ) : null}
        {notice ? (
          <div className="cp-alert" role="status">
            <Check /> {notice}
          </div>
        ) : null}
        {pipeline.error ? (
          <div className="cp-alert is-error" role="alert">
            <XCircle /> Pipeline data is unavailable. Confirm migration 0041 is
            applied, then try again.
          </div>
        ) : null}
        {detail.error ? (
          <div className="cp-alert is-error" role="alert">
            <XCircle /> This account detail could not be loaded. Refresh before
            making another change.
          </div>
        ) : null}

        <section className="cp-metrics">
          <article>
            <Target />
            <span>ACTIVE ACCOUNTS</span>
            <b>{metrics.active}</b>
            <small>In motion, not vanity leads</small>
          </article>
          <article>
            <Sparkles />
            <span>ESTIMATED PIPELINE</span>
            <b>{money(metrics.weighted)}</b>
            <small>Planning estimates, not revenue</small>
          </article>
          <article className="is-won">
            <Trophy />
            <span>ACCOUNTS WON</span>
            <b>{metrics.won}</b>
            <small>Converted commercial customers</small>
          </article>
          <article className="is-realized">
            <CircleDollarSign />
            <span>REALIZED REVENUE</span>
            <b>{money(metrics.realized)}</b>
            <small>Paid attributed orders only</small>
          </article>
        </section>

        <section className="cp-stage-strip" aria-label="Pipeline stages">
          {COMMERCIAL_PIPELINE_STAGES.map(stage => {
            const count =
              pipeline.data?.filter(item => item.stage === stage).length ?? 0;
            return (
              <span key={stage} className={count ? "has-records" : ""}>
                <b>{count}</b>
                {COMMERCIAL_PIPELINE_STAGE_LABELS[stage]}
              </span>
            );
          })}
        </section>

        <div className="cp-workspace">
          <section className="cp-list">
            <div className="cp-panel-title">
              <span>ACCOUNT PIPELINE</span>
              <b>{pipeline.data?.length ?? 0}</b>
            </div>
            {pipeline.isLoading ? (
              <div className="cp-empty">
                <Loader2 className="cp-spin" /> Loading pipeline…
              </div>
            ) : null}
            {!pipeline.isLoading &&
            !pipeline.error &&
            pipeline.data?.length === 0 ? (
              <div className="cp-empty">
                <Target />
                <b>No commercial missions yet.</b>
                <p>Create one from a persisted territory opportunity.</p>
              </div>
            ) : null}
            <div className="cp-records">
              {pipeline.data?.map(item => (
                <button
                  type="button"
                  key={item.id}
                  className={
                    item.id === selectedSummary?.id ? "is-selected" : ""
                  }
                  aria-pressed={item.id === selectedSummary?.id}
                  onClick={() => {
                    setSelectedId(item.id);
                    setNotice(null);
                    setError(null);
                  }}
                >
                  <span className={`cp-stage is-${item.stage}`}>
                    {COMMERCIAL_PIPELINE_STAGE_LABELS[item.stage]}
                  </span>
                  <b>{item.account.name}</b>
                  <small>
                    {item.mission.code} · {item.account.accountType}
                  </small>
                  <strong>
                    {money(item.values.estimatedContractValueCents)}
                  </strong>
                  <em>annual estimate</em>
                </button>
              ))}
            </div>
          </section>

          <section className="cp-detail">
            {selectedSummary && detail.isLoading ? (
              <div className="cp-empty is-large">
                <Loader2 className="cp-spin" /> Loading account history…
              </div>
            ) : !selected ? (
              <div className="cp-empty is-large">
                <Building2 /> Select an account.
              </div>
            ) : (
              <>
                <div className="cp-hero">
                  <div>
                    <span className={`cp-stage is-${selected.stage}`}>
                      {COMMERCIAL_PIPELINE_STAGE_LABELS[selected.stage]}
                    </span>
                    <h2>{selected.account?.name}</h2>
                    <p>
                      {selected.mission.code} · Mission ID {selected.mission.id}{" "}
                      · Account ID {selected.account?.id}
                    </p>
                  </div>
                  <div className="cp-hero-value">
                    <small>EST. ANNUAL VALUE</small>
                    <b>{money(selected.values.estimatedContractValueCents)}</b>
                    <span>
                      {selected.mission.opportunity.estimateConfidence}{" "}
                      confidence
                    </span>
                  </div>
                </div>

                <div className="cp-context-grid">
                  <article>
                    <MapPinned />
                    <div>
                      <span>PRIMARY LOCATION</span>
                      <b>{selected.locations[0]?.address}</b>
                      <small>
                        {selected.locations.length} linked location(s)
                      </small>
                    </div>
                  </article>
                  <article>
                    <UserRoundCheck />
                    <div>
                      <span>DECISION-MAKER</span>
                      <b>
                        {selected.contacts[0]?.name ??
                          selected.mission.account.decisionMaker.name ??
                          "Not identified"}
                      </b>
                      <small>
                        {selected.contacts[0]?.title ??
                          selected.mission.account.decisionMaker.title ??
                          "Role unavailable"}
                      </small>
                    </div>
                  </article>
                  <article>
                    <ClipboardCheck />
                    <div>
                      <span>NEXT FOLLOW-UP</span>
                      <b>
                        {selected.nextFollowUpAt
                          ? shortDate(selected.nextFollowUpAt)
                          : "None scheduled"}
                      </b>
                      <small>
                        {
                          selected.followUps.filter(
                            item => item.status === "open"
                          ).length
                        }{" "}
                        open action(s)
                      </small>
                    </div>
                  </article>
                </div>

                <div className="cp-value-ladder">
                  <article>
                    <span>ESTIMATED CONTRACT</span>
                    <b>{money(selected.values.estimatedContractValueCents)}</b>
                    <small>Confidence-scored planning value</small>
                  </article>
                  <article>
                    <span>APPROVED AGREEMENT</span>
                    <b>{money(selected.values.approvedContractValueCents)}</b>
                    <small>Requires operator evidence</small>
                  </article>
                  <article>
                    <span>INVOICED</span>
                    <b>{money(selected.values.invoicedRevenueCents)}</b>
                    <small>No invoice source configured</small>
                  </article>
                  <article>
                    <span>PAID / REALIZED</span>
                    <b>{money(selected.values.realizedRevenueCents)}</b>
                    <small>Tenant paid-order truth</small>
                  </article>
                </div>

                {[
                  "follow_up",
                  "proposal_sent",
                  "pilot_requested",
                  "verbal_yes",
                ].includes(selected.stage) ? (
                  <section className="cp-command">
                    <div className="cp-command-head">
                      <TrendingUp />
                      <div>
                        <span>RELATIONSHIP ADVANCE</span>
                        <b>Move only when the real conversation moves.</b>
                      </div>
                    </div>
                    <textarea
                      value={relationshipNote}
                      onChange={event =>
                        setRelationshipNote(event.target.value)
                      }
                      placeholder="What happened? Record the evidence for this stage."
                      maxLength={2000}
                    />
                    <div className="cp-action-row">
                      {(
                        [
                          "follow_up",
                          "proposal_sent",
                          "pilot_requested",
                          "verbal_yes",
                        ] as const
                      ).map(stage =>
                        canAdvanceRelationshipStage(
                          selected.stage as CommercialPipelineStage,
                          stage
                        ) ? (
                          <button
                            type="button"
                            key={stage}
                            disabled={busy || !relationshipNote.trim()}
                            onClick={() =>
                              void perform(async () => {
                                await advance.mutateAsync({
                                  pipelineId: selected.id,
                                  expectedVersion: selected.version,
                                  stage,
                                  note: relationshipNote,
                                  requestId: crypto.randomUUID(),
                                });
                                setRelationshipNote("");
                                setNotice(
                                  `Pipeline advanced to ${COMMERCIAL_PIPELINE_STAGE_LABELS[stage]}`
                                );
                              })
                            }
                          >
                            {COMMERCIAL_PIPELINE_STAGE_LABELS[stage]}
                          </button>
                        ) : null
                      )}
                      <button
                        type="button"
                        className="is-win"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await resolve.mutateAsync({
                              pipelineId: selected.id,
                              expectedMissionVersion: selected.mission.version,
                              action: "won",
                              reason:
                                "Operator verified commercial account won",
                              requestId: crypto.randomUUID(),
                            });
                            setNotice(
                              "Account converted. Revenue still requires a paid order."
                            );
                          })
                        }
                      >
                        <Trophy /> Mark won
                      </button>
                      <button
                        type="button"
                        className="is-lost"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await resolve.mutateAsync({
                              pipelineId: selected.id,
                              expectedMissionVersion: selected.mission.version,
                              action: "lost",
                              reason:
                                relationshipNote ||
                                "Operator marked account lost",
                              requestId: crypto.randomUUID(),
                            });
                            setNotice(
                              "Account marked lost with history preserved"
                            );
                          })
                        }
                      >
                        <XCircle /> Lost
                      </button>
                    </div>
                  </section>
                ) : null}

                {selected.stage === "lost" ? (
                  <section className="cp-command is-reopen">
                    <div>
                      <span>REOPENING RULE</span>
                      <b>A new signal may reopen the same canonical mission.</b>
                      <p>
                        History stays intact; no duplicate account is created.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await resolve.mutateAsync({
                            pipelineId: selected.id,
                            expectedMissionVersion: selected.mission.version,
                            action: "reopen",
                            reason: "New commercial signal",
                            requestId: crypto.randomUUID(),
                          });
                          setNotice(
                            "Mission reopened from the existing account record"
                          );
                        })
                      }
                    >
                      <RefreshCw /> Reopen mission
                    </button>
                  </section>
                ) : null}

                <section className="cp-followups">
                  <div className="cp-section-head">
                    <div>
                      <span>FOLLOW-UP QUEUE</span>
                      <h3>The next real-world move</h3>
                    </div>
                    <CalendarClock />
                  </div>
                  <div className="cp-followup-form">
                    <label>
                      Due
                      <input
                        type="datetime-local"
                        value={followUpAt}
                        onChange={event => setFollowUpAt(event.target.value)}
                      />
                    </label>
                    <label>
                      Action
                      <input
                        value={followUpNote}
                        onChange={event => setFollowUpNote(event.target.value)}
                        placeholder="Send pilot details, call Dana…"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy || !followUpNote.trim() || !followUpAt}
                      onClick={() =>
                        void perform(async () => {
                          await schedule.mutateAsync({
                            pipelineId: selected.id,
                            dueAt: new Date(followUpAt),
                            note: followUpNote,
                            requestId: crypto.randomUUID(),
                          });
                          setFollowUpNote("");
                          setNotice(
                            "Follow-up scheduled on the same account pipeline"
                          );
                        })
                      }
                    >
                      Schedule
                    </button>
                  </div>
                  <div className="cp-followup-list">
                    {selected.followUps.map(item => (
                      <article key={item.id} className={`is-${item.status}`}>
                        <div>
                          <b>{item.note}</b>
                          <small>
                            {shortDate(item.dueAt)} · {item.status}
                          </small>
                        </div>
                        {item.status === "open" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void perform(async () => {
                                await complete.mutateAsync({
                                  pipelineId: selected.id,
                                  followUpId: item.id,
                                  requestId: crypto.randomUUID(),
                                });
                                setNotice("Follow-up completed");
                              })
                            }
                          >
                            <Check /> Done
                          </button>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>

                {selected.customer ? (
                  <section className="cp-conversion">
                    <div className="cp-section-head">
                      <div>
                        <span>COMMERCIAL CUSTOMER {selected.customer.id}</span>
                        <h3>Won is not the same as revenue.</h3>
                      </div>
                      <BadgeCheck />
                    </div>
                    <div className="cp-conversion-grid">
                      <article>
                        <FileSignature />
                        <span>AGREEMENT</span>
                        <b>
                          {selected.agreements[0]?.status.replaceAll(
                            "_",
                            " "
                          ) ?? "not recorded"}
                        </b>
                        <small>
                          Proposal v
                          {selected.agreements[0]?.proposalVersion ?? "—"}
                        </small>
                      </article>
                      <article>
                        <Route />
                        <span>ROUTE</span>
                        <b>
                          {selected.routeAssignments[0]?.status ?? "unplanned"}
                        </b>
                        <small>
                          {selected.routeAssignments[0]
                            ?.capacityReservedPoundsPerWeek ?? 0}{" "}
                          lb/week planned
                        </small>
                      </article>
                      <article>
                        <PackageCheck />
                        <span>FIRST ORDER</span>
                        <b>{selected.firstOrderId ?? "Awaiting order"}</b>
                        <small>
                          {selected.orderAttributions.length} attributed
                          order(s)
                        </small>
                      </article>
                      <article>
                        <Trophy />
                        <span>FINAL REWARD</span>
                        <b>{selected.finalReward?.xpAwarded ?? 0} XP</b>
                        <small>Exactly once for {selected.mission.code}</small>
                      </article>
                    </div>

                    {selected.agreements[0]?.status !== "approved" ? (
                      <div className="cp-proof-form">
                        <div>
                          <span>APPROVED AGREEMENT EVIDENCE</span>
                          <p>
                            A verbal yes is preserved as verbal. Record a signed
                            or otherwise approved value only with a verifiable
                            reference.
                          </p>
                        </div>
                        <label>
                          Annual value ($)
                          <input
                            inputMode="decimal"
                            value={agreementDollars}
                            onChange={event =>
                              setAgreementDollars(event.target.value)
                            }
                            placeholder="24800"
                          />
                        </label>
                        <label>
                          Evidence reference
                          <input
                            value={agreementEvidence}
                            onChange={event =>
                              setAgreementEvidence(event.target.value)
                            }
                            placeholder="Signed agreement URL or internal record ID"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={
                            busy ||
                            Number(agreementDollars) <= 0 ||
                            agreementEvidence.trim().length < 3
                          }
                          onClick={() =>
                            void perform(async () => {
                              await approveAgreement.mutateAsync({
                                pipelineId: selected.id,
                                approvedAnnualValueCents: Math.round(
                                  Number(agreementDollars) * 100
                                ),
                                evidenceReference: agreementEvidence,
                                confirmation: AGREEMENT_CONFIRMATION,
                                requestId: crypto.randomUUID(),
                              });
                              setNotice(
                                "Approved agreement value recorded with evidence"
                              );
                            })
                          }
                        >
                          <ShieldCheck /> Record approved agreement
                        </button>
                      </div>
                    ) : null}

                    <div className="cp-order-form">
                      <div>
                        <span>ATTRIBUTE ACTUAL ORDER</span>
                        <p>
                          Link a tenant order only after verifying it belongs to
                          this commercial account. Paid revenue is read from the
                          order.
                        </p>
                      </div>
                      <label>
                        Order ID
                        <input
                          inputMode="numeric"
                          value={orderId}
                          onChange={event => setOrderId(event.target.value)}
                          placeholder="1042"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={
                          busy ||
                          !Number.isInteger(Number(orderId)) ||
                          Number(orderId) <= 0
                        }
                        onClick={() =>
                          void perform(async () => {
                            await attributeOrder.mutateAsync({
                              pipelineId: selected.id,
                              orderId: Number(orderId),
                              confirmation: ORDER_CONFIRMATION,
                              requestId: crypto.randomUUID(),
                            });
                            setOrderId("");
                            setNotice(
                              "Order attributed; only paid truth counts as realized revenue"
                            );
                          })
                        }
                      >
                        <CircleDollarSign /> Attribute order
                      </button>
                    </div>
                  </section>
                ) : null}

                <section className="cp-history">
                  <div className="cp-section-head">
                    <div>
                      <span>IMMUTABLE STAGE HISTORY</span>
                      <h3>How this account got here</h3>
                    </div>
                  </div>
                  <div>
                    {selected.events.map(event => (
                      <article key={event.id}>
                        <span />
                        <div>
                          <b>
                            {event.fromStage
                              ? `${COMMERCIAL_PIPELINE_STAGE_LABELS[event.fromStage as CommercialPipelineStage]} → `
                              : ""}
                            {COMMERCIAL_PIPELINE_STAGE_LABELS[
                              event.toStage as CommercialPipelineStage
                            ] ?? event.toStage}
                          </b>
                          <small>
                            {shortDate(event.createdAt)} · {event.actorType}
                          </small>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
