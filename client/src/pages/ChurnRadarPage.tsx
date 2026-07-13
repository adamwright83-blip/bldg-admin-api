import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  ClipboardCheck,
  DollarSign,
  ExternalLink,
  FileCheck2,
  Loader2,
  MessageSquareText,
  Radar,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";
import { Link } from "wouter";
import { LoginForm } from "@/components/LoginForm";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { formatChurnMoney } from "@shared/customerChurn";
import "./churn-radar.css";

const APPROVAL_CONFIRMATION =
  "I reviewed this exact message and approve it for this customer" as const;
const CONTACT_CONFIRMATION =
  "I manually sent this exact approved message to this customer" as const;

function todayInput(): string {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

export default function ChurnRadarPage() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const profile = trpc.system.churnRadar.profile.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const scan = trpc.system.churnRadar.latestScan.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const interventions = trpc.system.churnRadar.interventions.useQuery(
    undefined,
    {
      enabled: isAuthenticated,
    }
  );
  const saveProfile = trpc.system.churnRadar.saveProfile.useMutation();
  const runScan = trpc.system.churnRadar.runScan.useMutation();
  const createIntervention =
    trpc.system.churnRadar.createIntervention.useMutation();
  const reviseDraft = trpc.system.churnRadar.reviseDraft.useMutation();
  const approveDraft = trpc.system.churnRadar.approveDraft.useMutation();
  const setPermission = trpc.system.churnRadar.setPermission.useMutation();
  const prepareContact =
    trpc.system.churnRadar.prepareManualContact.useMutation();
  const markContacted = trpc.system.churnRadar.markContacted.useMutation();

  const [storeName, setStoreName] = useState("");
  const [senderName, setSenderName] = useState("");
  const [schedulingUrl, setSchedulingUrl] = useState("");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(
    null
  );
  const [selectedInterventionId, setSelectedInterventionId] = useState<
    string | null
  >(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [permissionSource, setPermissionSource] = useState("");
  const [permissionDate, setPermissionDate] = useState(todayInput());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile.data) return;
    setStoreName(profile.data.storeName);
    setSenderName(profile.data.senderName);
    setSchedulingUrl(profile.data.schedulingUrl ?? "");
  }, [profile.data]);

  const atRiskCustomers = useMemo(
    () => scan.data?.customers.filter(customer => customer.score >= 40) ?? [],
    [scan.data]
  );
  const selectedCustomer =
    scan.data?.customers.find(customer => customer.id === selectedSnapshotId) ??
    atRiskCustomers[0] ??
    null;
  const selectedIntervention =
    interventions.data?.find(item => item.id === selectedInterventionId) ??
    interventions.data?.find(
      item => item.customer.customerKey === selectedCustomer?.customerKey
    ) ??
    null;

  useEffect(() => {
    if (!selectedSnapshotId && atRiskCustomers[0])
      setSelectedSnapshotId(atRiskCustomers[0].id);
  }, [atRiskCustomers, selectedSnapshotId]);

  useEffect(() => {
    if (!selectedIntervention) return;
    setSelectedInterventionId(selectedIntervention.id);
    setDraftMessage(selectedIntervention.draft.message);
  }, [selectedIntervention?.id, selectedIntervention?.draft.version]);

  const monthlyExposure = atRiskCustomers.reduce(
    (sum, customer) => sum + customer.estimatedMonthlyImpactCents,
    0
  );
  const busy =
    saveProfile.isPending ||
    runScan.isPending ||
    createIntervention.isPending ||
    reviseDraft.isPending ||
    approveDraft.isPending ||
    setPermission.isPending ||
    prepareContact.isPending ||
    markContacted.isPending;

  const perform = async (action: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed");
    }
  };

  const refreshInterventions = async () => {
    await utils.system.churnRadar.interventions.invalidate();
    await interventions.refetch();
  };

  if (authLoading)
    return (
      <main className="cr-root cr-center">
        <Loader2 className="cr-spin" />
      </main>
    );
  if (!isAuthenticated)
    return (
      <LoginForm role="admin" onSuccess={() => window.location.reload()} />
    );

  return (
    <main className="cr-root">
      <div className="cr-shell">
        <header className="cr-header">
          <div>
            <span className="cr-kicker">
              <Radar /> DAYFORGE CHURN RADAR
            </span>
            <h1>Catch the silence before it becomes churn.</h1>
            <p>
              Real completed-order history in. Evidence-backed recovery missions
              out. Nothing contacts a customer without an exact-message approval
              and recorded permission.
            </p>
          </div>
          <Link href="/commercial-missions" className="cr-back">
            <ArrowLeft /> Missions
          </Link>
        </header>

        {error ? (
          <div className="cr-alert is-error" role="alert">
            <AlertTriangle /> {error}
          </div>
        ) : null}
        {notice ? (
          <div className="cr-alert" role="status">
            <CheckCircle2 /> {notice}
          </div>
        ) : null}

        <section className="cr-profile">
          <div>
            <span className="cr-section-label">RECOVERY IDENTITY</span>
            <b>Who is checking in?</b>
            <small>
              Persisted tenant facts only. DayForge supplies no demo operator.
            </small>
          </div>
          <label>
            Store name
            <input
              value={storeName}
              onChange={event => setStoreName(event.target.value)}
              placeholder="Your operating brand"
            />
          </label>
          <label>
            Sender name
            <input
              value={senderName}
              onChange={event => setSenderName(event.target.value)}
              placeholder="The human sending"
            />
          </label>
          <label>
            Scheduling URL · optional
            <input
              type="url"
              value={schedulingUrl}
              onChange={event => setSchedulingUrl(event.target.value)}
              placeholder="https://…"
            />
          </label>
          <button
            type="button"
            disabled={busy || !storeName.trim() || !senderName.trim()}
            onClick={() =>
              void perform(async () => {
                await saveProfile.mutateAsync({
                  storeName,
                  senderName,
                  schedulingUrl: schedulingUrl.trim() || null,
                });
                await profile.refetch();
                setNotice("Recovery identity saved");
              })
            }
          >
            <Save /> Save
          </button>
        </section>

        <section className="cr-metrics">
          <article>
            <small>REAL ORDERS SCANNED</small>
            <b>{scan.data?.sourceOrderCount ?? 0}</b>
            <span>Tenant-scoped orders table</span>
          </article>
          <article>
            <small>CUSTOMERS SCORED</small>
            <b>{scan.data?.customerCount ?? 0}</b>
            <span>Two or more completed orders</span>
          </article>
          <article className="is-danger">
            <small>AT-RISK CUSTOMERS</small>
            <b>{atRiskCustomers.length}</b>
            <span>Score 40 or higher</span>
          </article>
          <article className="is-value">
            <small>EST. MONTHLY IMPACT</small>
            <b>{formatChurnMoney(monthlyExposure)}</b>
            <span>Planning estimate, not booked revenue</span>
          </article>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await runScan.mutateAsync({ requestId: crypto.randomUUID() });
                setSelectedSnapshotId(null);
                await scan.refetch();
                setNotice("Fresh tenant order history scored");
              })
            }
          >
            {runScan.isPending ? (
              <Loader2 className="cr-spin" />
            ) : (
              <RefreshCw />
            )}
            Run fresh scan
          </button>
        </section>

        <div className="cr-workspace">
          <section className="cr-queue">
            <div className="cr-panel-head">
              <div>
                <span className="cr-section-label">PRIORITY QUEUE</span>
                <h2>Good customers going quiet</h2>
              </div>
              <span>{atRiskCustomers.length}</span>
            </div>
            {scan.isLoading ? (
              <div className="cr-empty">
                <Loader2 className="cr-spin" /> Loading history…
              </div>
            ) : null}
            {!scan.isLoading && !scan.data ? (
              <div className="cr-empty">
                <Radar />
                <b>No scan yet</b>
                <p>Run Churn Radar against the tenant's real order history.</p>
              </div>
            ) : null}
            {scan.data && atRiskCustomers.length === 0 ? (
              <div className="cr-empty">
                <BadgeCheck />
                <b>No current churn alerts</b>
                <p>
                  Customers with active orders are automatically suppressed.
                </p>
              </div>
            ) : null}
            <div className="cr-customer-list">
              {atRiskCustomers.map(customer => (
                <button
                  type="button"
                  key={customer.id}
                  className={
                    selectedCustomer?.id === customer.id ? "is-selected" : ""
                  }
                  onClick={() => {
                    setSelectedSnapshotId(customer.id);
                    setSelectedInterventionId(null);
                    setError(null);
                    setNotice(null);
                  }}
                >
                  <span className={`cr-score is-${customer.grade}`}>
                    {customer.score}
                  </span>
                  <span>
                    <b>{customer.customerName}</b>
                    <small>
                      {customer.daysLate} days late ·{" "}
                      {customer.historyOrderCount} completed orders
                    </small>
                  </span>
                  <strong>
                    {formatChurnMoney(customer.estimatedMonthlyImpactCents)}
                    <small>/ mo est.</small>
                  </strong>
                </button>
              ))}
            </div>
          </section>

          <section className="cr-detail">
            {!selectedCustomer ? (
              <div className="cr-empty is-large">
                <Radar />
                <b>Select an alert to inspect its evidence.</b>
              </div>
            ) : (
              <>
                <div className="cr-detail-hero">
                  <div>
                    <span
                      className={`cr-risk-badge is-${selectedCustomer.grade}`}
                    >
                      {selectedCustomer.grade} risk ·{" "}
                      {selectedCustomer.confidence} confidence
                    </span>
                    <h2>{selectedCustomer.customerName}</h2>
                    <p>
                      Last completed {selectedCustomer.lastServiceLabel} service{" "}
                      {formatDate(selectedCustomer.lastServiceAt)} · normal
                      cadence {selectedCustomer.expectedCadenceDays} days
                    </p>
                  </div>
                  <div className="cr-score-big">
                    <b>{selectedCustomer.score}</b>
                    <small>RISK SCORE</small>
                  </div>
                </div>

                <div className="cr-reasons">
                  {selectedCustomer.reasons.map(reason => (
                    <span key={reason}>
                      <AlertTriangle /> {reason}
                    </span>
                  ))}
                </div>

                <div className="cr-evidence">
                  <div className="cr-panel-head">
                    <div>
                      <span className="cr-section-label">
                        WHY SAGE FLAGGED IT
                      </span>
                      <h3>Facts, calculations, and gaps</h3>
                    </div>
                  </div>
                  {selectedCustomer.evidence.map(item => (
                    <article key={item.label} className={`is-${item.kind}`}>
                      <span>{humanize(item.kind)}</span>
                      <b>{item.label}</b>
                      <p>{item.value}</p>
                      <small>{item.source}</small>
                    </article>
                  ))}
                </div>

                {!selectedIntervention ? (
                  <div className="cr-mission-create">
                    <Sparkles />
                    <div>
                      <span className="cr-section-label">NEXT BEST ACTION</span>
                      <h3>Turn this alert into a recovery mission.</h3>
                      <p>
                        DayForge will create a real stale-customer ops task and
                        a grounded draft. It will not contact anyone.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy || !profile.data}
                      onClick={() =>
                        void perform(async () => {
                          const created = await createIntervention.mutateAsync({
                            snapshotId: selectedCustomer.id,
                            requestId: crypto.randomUUID(),
                          });
                          setSelectedInterventionId(created.id);
                          await refreshInterventions();
                          setNotice(
                            `Recovery mission linked to ops task ${created.opsTaskId}`
                          );
                        })
                      }
                    >
                      <Sparkles /> Prepare win-back mission
                    </button>
                    {!profile.data ? (
                      <small>Save the recovery identity above first.</small>
                    ) : null}
                  </div>
                ) : (
                  <div className="cr-mission">
                    <div className="cr-mission-head">
                      <div>
                        <span className="cr-section-label">
                          RECOVERY MISSION · OPS{" "}
                          {selectedIntervention.opsTaskId}
                        </span>
                        <h3>{humanize(selectedIntervention.status)}</h3>
                      </div>
                      <span>{selectedIntervention.draft.channel}</span>
                    </div>

                    {selectedIntervention.status === "recovered" ? (
                      <div className="cr-recovered">
                        <DollarSign />
                        <div>
                          <span>ATTRIBUTED RECOVERY</span>
                          <b>
                            {formatChurnMoney(
                              selectedIntervention.recoveredRevenueCents
                            )}
                          </b>
                          <p>
                            Paid order {selectedIntervention.recoveredOrderId} ·{" "}
                            {selectedIntervention.recoveredAt
                              ? formatDate(selectedIntervention.recoveredAt)
                              : "date unavailable"}
                          </p>
                        </div>
                      </div>
                    ) : null}

                    <label className="cr-draft">
                      <span>
                        Draft v{selectedIntervention.draft.version} ·{" "}
                        {selectedIntervention.draft.status}
                      </span>
                      <textarea
                        rows={6}
                        maxLength={320}
                        value={draftMessage}
                        disabled={
                          !["draft_pending_review", "approved"].includes(
                            selectedIntervention.status
                          )
                        }
                        onChange={event => setDraftMessage(event.target.value)}
                      />
                      <small>{draftMessage.length}/320 · Nothing sent</small>
                    </label>
                    <div className="cr-facts-used">
                      {selectedIntervention.draft.factsUsed.map(fact => (
                        <span key={fact}>
                          <ClipboardCheck /> {fact}
                        </span>
                      ))}
                    </div>
                    <div className="cr-actions">
                      <button
                        type="button"
                        disabled={
                          busy ||
                          !draftMessage.trim() ||
                          draftMessage === selectedIntervention.draft.message ||
                          !["draft_pending_review", "approved"].includes(
                            selectedIntervention.status
                          )
                        }
                        onClick={() =>
                          void perform(async () => {
                            await reviseDraft.mutateAsync({
                              interventionId: selectedIntervention.id,
                              requestId: crypto.randomUUID(),
                              message: draftMessage,
                            });
                            await refreshInterventions();
                            setNotice("New draft version saved for review");
                          })
                        }
                      >
                        <Save /> Save revision
                      </button>
                      <button
                        type="button"
                        className="is-approve"
                        disabled={
                          busy ||
                          selectedIntervention.status !==
                            "draft_pending_review" ||
                          draftMessage !== selectedIntervention.draft.message
                        }
                        onClick={() =>
                          void perform(async () => {
                            await approveDraft.mutateAsync({
                              interventionId: selectedIntervention.id,
                              draftId: selectedIntervention.draft.id,
                              requestId: crypto.randomUUID(),
                              confirmation: APPROVAL_CONFIRMATION,
                            });
                            await refreshInterventions();
                            setNotice("Exact draft approved. Nothing sent.");
                          })
                        }
                      >
                        <FileCheck2 /> Approve exact draft
                      </button>
                    </div>

                    <div className="cr-permission">
                      <div>
                        <ShieldCheck />
                        <span>
                          <b>Contact permission</b>
                          <small>
                            Current state:{" "}
                            {humanize(selectedIntervention.permission.status)}
                          </small>
                        </span>
                      </div>
                      <p>
                        Human approval is not consent. Record only permission
                        you can substantiate; unknown, expired, or opted-out
                        records block the contact tool.
                      </p>
                      <div className="cr-permission-fields">
                        <label>
                          Evidence / source reference
                          <input
                            value={permissionSource}
                            onChange={event =>
                              setPermissionSource(event.target.value)
                            }
                            placeholder="Where and how consent was captured"
                          />
                        </label>
                        <label>
                          Captured date
                          <input
                            type="date"
                            value={permissionDate}
                            max={todayInput()}
                            onChange={event =>
                              setPermissionDate(event.target.value)
                            }
                          />
                        </label>
                        <button
                          type="button"
                          disabled={busy || permissionSource.trim().length < 3}
                          onClick={() =>
                            void perform(async () => {
                              await setPermission.mutateAsync({
                                interventionId: selectedIntervention.id,
                                requestId: crypto.randomUUID(),
                                status: "opted_in",
                                sourceReference: permissionSource,
                                capturedAt: new Date(
                                  `${permissionDate}T00:00:00`
                                ),
                                expiresAt: null,
                              });
                              await refreshInterventions();
                              setNotice(
                                "Documented SMS win-back opt-in recorded"
                              );
                            })
                          }
                        >
                          <UserRoundCheck /> Record verified opt-in
                        </button>
                        <button
                          type="button"
                          className="is-opt-out"
                          disabled={busy || permissionSource.trim().length < 3}
                          onClick={() =>
                            void perform(async () => {
                              await setPermission.mutateAsync({
                                interventionId: selectedIntervention.id,
                                requestId: crypto.randomUUID(),
                                status: "opted_out",
                                sourceReference: permissionSource,
                                capturedAt: new Date(
                                  `${permissionDate}T00:00:00`
                                ),
                                expiresAt: null,
                              });
                              await refreshInterventions();
                              setNotice(
                                "Opt-out recorded; contact remains blocked"
                              );
                            })
                          }
                        >
                          Record opt-out
                        </button>
                      </div>
                    </div>

                    <div className="cr-contact-gate">
                      <MessageSquareText />
                      <div>
                        <span className="cr-section-label">
                          HUMAN SEND GATE
                        </span>
                        <h4>
                          DayForge opens your SMS composer. It never auto-sends.
                        </h4>
                        <p>
                          Approved content + current documented opt-in are both
                          required. Provider delivery remains unverified until a
                          future compliant messaging integration exists.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={
                          busy ||
                          selectedIntervention.status !== "approved" ||
                          !selectedIntervention.permission.composerAllowed
                        }
                        onClick={() =>
                          void perform(async () => {
                            const contact = await prepareContact.mutateAsync({
                              interventionId: selectedIntervention.id,
                              draftId: selectedIntervention.draft.id,
                              contentHash:
                                selectedIntervention.draft.contentHash,
                              requestId: crypto.randomUUID(),
                            });
                            window.location.href = contact.smsUrl;
                            setNotice(
                              `Composer opened for ${contact.phoneMasked}; DayForge did not send it`
                            );
                          })
                        }
                      >
                        <ExternalLink /> Open approved SMS
                      </button>
                      <button
                        type="button"
                        className="is-contacted"
                        disabled={
                          busy ||
                          selectedIntervention.status !== "approved" ||
                          !selectedIntervention.permission.composerAllowed
                        }
                        onClick={() =>
                          void perform(async () => {
                            await markContacted.mutateAsync({
                              interventionId: selectedIntervention.id,
                              draftId: selectedIntervention.draft.id,
                              contentHash:
                                selectedIntervention.draft.contentHash,
                              requestId: crypto.randomUUID(),
                              confirmation: CONTACT_CONFIRMATION,
                            });
                            await refreshInterventions();
                            setNotice(
                              "Manual contact reported; delivery is not claimed as verified"
                            );
                          })
                        }
                      >
                        <CheckCircle2 /> I sent this exact message
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <footer className="cr-footer">
          <ShieldCheck />
          <p>
            Churn Radar uses completed tenant order records, labels calculations
            and estimates, suppresses customers with active orders, and reports
            missing evidence instead of inventing it.
          </p>
        </footer>
      </div>
    </main>
  );
}
