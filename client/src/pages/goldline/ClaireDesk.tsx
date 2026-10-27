import { useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";
import { CLAIRE_DAILY_CALL_DEFAULTS, matchesClaireDailyCallDefaults, type ClaireDailyCallPurpose } from "../../../../shared/claireDailyCallDefaults";
import { ClaireDailyCallSettings } from "./ClaireDailyCallSettings";
import { ClaireStrategicCallConsent } from "./ClaireStrategicCallConsent";
import { ClaireStrategicProposal } from "./ClaireStrategicProposal";
import { OpenComms } from "./claireDesk/OpenComms";
import { ClaireComposer } from "@/components/claire/ClaireComposer";
import { DaphnePresentationConsent } from "./claireDesk/DaphnePresentationConsent";
import { callSheetWithheldCopy } from "./claireDesk/callSheetFreshness";
import "./claireDesk/claireDesk.css";

const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const dayLabel = (date: string, today: string, tomorrow: string) =>
  date === today ? "Today" : date === tomorrow ? "Tomorrow" : new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
const STATUS: Record<string, string> = {
  awaiting_approval: "Needs your approval",
  needs_reschedule: "Time passed — reschedule",
  committed: "On your Day Line",
  completed: "Done",
};

function ClaireEvidenceReceipts({
  evidence,
}: {
  evidence: Array<{
    id: string;
    source: string;
    description: string;
    value: number | string | null;
  }>;
}) {
  const receipts = evidence.filter(item => item.source === "analyzeBusinessData");
  if (!receipts.length) {
    return (
      <p className="cd-note" data-testid="claire-approval-evidence-absent">
        No analyzeBusinessData receipt is attached. Approval will not invent one.
      </p>
    );
  }
  return (
    <>
      {receipts.map(item => (
        <p key={item.id} className="cd-note" data-testid="claire-source-backed-receipt" data-evidence-source="analyzeBusinessData">
          analyzeBusinessData: {String(item.value ?? item.description)} Receipt {item.id}.
        </p>
      ))}
    </>
  );
}

/**
 * JOYSTICK · Claire Desk. An operating cockpit: objective, opportunity, the one
 * mission, its runway, what Claire prepared, and what actually happened. Every
 * figure comes from stored evidence; unknown values are left out.
 */
export default function ClaireDesk() {
  const utils = trpc.useUtils();
  const mission = trpc.system.weeklyMission.deskMission.useQuery(undefined, { retry: false, staleTime: 15_000 });
  const respond = trpc.system.weeklyMission.respondToPreparedProposal.useMutation();
  const confirm = trpc.system.claire.confirmTomorrow.useMutation();
  const relationshipClosing = trpc.system.claireRelationshipOffboarding.preview.useQuery(undefined, { enabled: false, retry: false });
  const [approval, setApproval] = useState<{ state: "idle" | "saving" | "ok" | "error"; text?: string }>({ state: "idle" });
  const [confirmState, setConfirmState] = useState<{ state: "idle" | "saving" | "ok" | "error"; text?: string }>({ state: "idle" });

  const refresh = useCallback(() => {
    void utils.system.weeklyMission.deskMission.invalidate();
    void utils.system.weeklyMission.preparedProposal.invalidate();
    void utils.system.weeklyMission.dailyCallStatus.invalidate();
  }, [utils]);

  const m = mission.data;
  // Lead with work that can still happen; expired work stays visible but never leads unless it is all there is.
  const primary =
    m?.items.find(i => i.status !== "completed" && i.status !== "needs_reschedule") ??
    m?.items.find(i => i.status === "needs_reschedule") ??
    null;
  const secondary = m?.items.filter(i => i.status !== "completed" && i.id !== primary?.id)[0] ?? null;
  const pendingTomorrow = m?.items.filter(i => i.status === "awaiting_approval" && i.date === m.tomorrow) ?? [];
  const withheldSheet = m?.winBack ? callSheetWithheldCopy(m.winBack) : null;

  async function approve(itemId: string) {
    if (!m?.pendingApproval) return;
    setApproval({ state: "saving" });
    try {
      // Always approve against the latest stored revision; Claire re-prepares hourly.
      const fresh = await utils.system.weeklyMission.deskMission.fetch();
      const scope = fresh.pendingApproval;
      if (!scope || !scope.itemIds.includes(itemId)) throw new Error("This mission changed since you opened it. Review the updated mission.");
      const r = await respond.mutateAsync({ proposalId: scope.proposalId, revision: scope.revision, action: "approve", itemIds: [itemId] });
      if (r.failedItems.length) throw new Error(r.speech);
      setApproval({ state: "ok", text: r.speech });
    } catch (e) {
      setApproval({ state: "error", text: e instanceof Error ? e.message : "Approval was not saved. Nothing changed." });
    } finally {
      refresh();
    }
  }

  async function confirmTomorrow() {
    if (!m?.timeZone) {
      setConfirmState({ state: "error", text: "Tomorrow was not saved. The business timezone is not loaded." });
      return;
    }
    setConfirmState({ state: "saving" });
    try {
      const r = await confirm.mutateAsync({ timeZone: m.timeZone });
      if (!r.verified) throw new Error("The save could not be read back, so it is not confirmed.");
      setConfirmState({
        state: "ok",
        text: `Saved tomorrow's plan snapshot for ${m?.tomorrowLabel ?? "tomorrow"} at ${new Date(r.confirmedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}: ${r.itemCount} item${r.itemCount === 1 ? "" : "s"}.${
          pendingTomorrow.length ? ` Still needs your approval: ${pendingTomorrow.map(i => i.title).join("; ")}.` : ""
        }`,
      });
    } catch (e) {
      setConfirmState({ state: "error", text: e instanceof Error ? e.message : "Tomorrow was not saved." });
    } finally {
      refresh();
    }
  }

  const claireLine = !m
    ? null
    : primary?.status === "awaiting_approval"
      ? `I've prepared "${primary.title}". It needs your OK before it goes on the Day Line.`
      : primary?.status === "needs_reschedule"
        ? `"${primary.title}" didn't happen in time. Tell me which day it should move to.`
      : primary
        ? `${primary.title} is on your Day Line ${dayLabel(primary.date, m.businessDate, m.tomorrow).toLowerCase()}${primary.when ? ` (${primary.when})` : ""}.`
        : "Nothing is prepared for the next two days yet.";

  return (
    <div className="cd-root" data-testid="claire-desk">
      <nav className="cd-rail" aria-label="JOYSTICK">
        <img src="/assets/joystick-home/joystick-logo.webp" alt="JOYSTICK" className="cd-logo" />
        <a href="/play" aria-label="Day Line">◎<span>Day Line</span></a>
        <a href="/claire" aria-current="page" aria-label="Claire">✦<span>Claire</span></a>
        <a href="/driver" aria-label="Driver">➤<span>Driver</span></a>
      </nav>

      <main className="cd-main">
        {mission.isLoading ? <p className="cd-muted">Loading Claire's picture…</p> : null}
        {mission.error ? <p role="alert" className="cd-error">Claire's mission couldn't load: {mission.error.message}</p> : null}

        {m ? (
          <>
            <header className="cd-hero" data-testid="claire-desk-objective">
              <div className="cd-hero-map" aria-hidden />
              <div className="cd-hero-copy">
                <p className="cd-kicker">THE OBJECTIVE</p>
                <h1>{m.objective ?? "No objective set yet"}</h1>
                {m.rationale ? (
                  <>
                    <p className="cd-kicker cd-mt">THE OPPORTUNITY</p>
                    <p className="cd-opportunity" data-testid="claire-desk-opportunity">{m.rationale.diagnosis}</p>
                  </>
                ) : null}
                {m.area ? <span className="cd-chip">{m.area}</span> : null}
              </div>
            </header>

            <section className="cd-missions" aria-label="Mission">
              {primary ? (
                <article className="cd-card cd-primary" data-testid="claire-desk-primary-mission">
                  <p className="cd-kicker">THE MISSION · {dayLabel(primary.date, m.businessDate, m.tomorrow)}</p>
                  <h2>{primary.title}</h2>
                  {primary.objective ? <p>{primary.objective}</p> : null}
                  <p className="cd-meta">
                    <span className={`cd-status cd-status-${primary.status}`}>{STATUS[primary.status]}</span>
                    {primary.when ? <span>{primary.when}</span> : null}
                  </p>
                  {primary.status === "awaiting_approval" ? (
                    <div className="cd-approve" data-testid="claire-approval-control">
                      {/offer/i.test(primary.objective ?? "") ? (
                        <p className="cd-note">No offer is approved. Calls can be plain check-ins; any discount is your decision, and Claire won't promise one.</p>
                      ) : null}
                      <ClaireEvidenceReceipts evidence={m.rationale?.evidence ?? []} />
                      <button type="button" className="cd-gold" disabled={approval.state === "saving"} onClick={() => void approve(primary.id)} data-testid="approve-primary-mission">
                        {approval.state === "saving" ? "Saving approval…" : "Approve this mission"}
                      </button>
                      <p className="cd-fine">Approves only this mission. It adds it to your Day Line; it contacts no one.</p>
                    </div>
                  ) : null}
                  {primary.status === "needs_reschedule" ? (
                    <p className="cd-note" data-testid="claire-desk-needs-reschedule">
                      Its time has passed, so it can't be approved as planned. Move it to a new day in the full week plan below, or tell Claire on comms when it should happen.
                    </p>
                  ) : null}
                  {approval.state === "ok" || approval.state === "error" ? (
                    <p role={approval.state === "error" ? "alert" : "status"} className={approval.state === "error" ? "cd-error" : "cd-ok"} data-testid="approve-result">
                      {approval.text}
                    </p>
                  ) : null}
                </article>
              ) : (
                <article className="cd-card cd-primary"><p className="cd-muted">No mission prepared. Open comms and ask Claire what she's found.</p></article>
              )}
              {secondary ? (
                <article className="cd-card cd-secondary" data-testid="claire-desk-secondary-mission">
                  <p className="cd-kicker">ALSO · {dayLabel(secondary.date, m.businessDate, m.tomorrow)}</p>
                  <h3>{secondary.title}</h3>
                  {secondary.objective ? <p className="cd-small">{secondary.objective}</p> : null}
                  <span className={`cd-status cd-status-${secondary.status}`}>{STATUS[secondary.status]}</span>
                </article>
              ) : null}
            </section>

            {withheldSheet ? (
              <section className="cd-card" aria-label="Call sheet" data-testid="claire-desk-call-sheet-withheld">
                <p className="cd-kicker">CLAIRE PREPARED · CALL SHEET</p>
                <h3>{withheldSheet.heading}</h3>
                <p className="cd-muted">{withheldSheet.body}</p>
                <p className="cd-fine">Claire does not name customers for outreach until the book is current and consent is on file.</p>
              </section>
            ) : null}
            {m.winBack?.contacts.length ? (
              <section className="cd-card" aria-label="Call sheet" data-testid="claire-desk-call-sheet">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <p className="cd-kicker">CLAIRE PREPARED · CALL SHEET</p>
                    <h3>
                      Lapsed {m.winBack.area} customers — {m.winBack.contacts.length} of {m.winBack.lapsedCount}, highest spend first
                    </h3>
                  </div>
                  <a
                    href="/admin/claire/scheduled-outreach"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#b45309",
                      background: "#fef3c7",
                      padding: "4px 8px",
                      borderRadius: "6px",
                      textDecoration: "none",
                    }}
                  >
                    ⏰ Scheduled Outreach Outbox
                  </a>
                </div>
                <ul className="cd-sheet">
                  {m.winBack.contacts.map(c => (
                    <li key={c.identityId}>
                      <strong>{c.name}</strong>
                      <span>
                        {c.paidOrders} paid order{c.paidOrders === 1 ? "" : "s"} · {money(c.lifetimeCents)} recorded
                        {c.lastOrderDate ? ` · last ${c.lastOrderDate}` : ""}
                        {c.medianGapDays ? ` · usually every ${c.medianGapDays} days` : ""}
                      </span>
                      <span className="cd-contact">
                        {c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : null}
                        {c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : null}
                        {!c.phone && !c.email ? "No contact on file" : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="cd-fine">Recorded revenue, not profit. Claire never contacts customers; you do.</p>
              </section>
            ) : null}

            <section className="cd-card" aria-label="Runway" data-testid="claire-desk-runway">
              <p className="cd-kicker">THE RUNWAY</p>
              {m.items.length ? (
                <ol className="cd-runway">
                  {m.items.map(i => (
                    <li key={i.id} className={`cd-runway-${i.status}`}>
                      <span className="cd-when">{dayLabel(i.date, m.businessDate, m.tomorrow)}{i.when ? ` · ${i.when}` : ""}</span>
                      <span>{i.title}</span>
                      <small>{STATUS[i.status]}</small>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="cd-muted">Nothing scheduled for today or tomorrow.</p>
              )}
            </section>

            <section className="cd-card" aria-label="Readiness" data-testid="claire-desk-readiness">
              <p className="cd-kicker">READINESS</p>
              {m.preparation.saved.length || m.preparation.planned.length || m.uncertain.length ? (
                <ul className="cd-ready">
                  {m.preparation.saved.map(p => <li key={p.savedAt + p.need}>✓ {p.need} <small>(your reminder, saved)</small></li>)}
                  {m.preparation.planned.slice(0, 3).map(p => <li key={p}>{p}</li>)}
                  {m.uncertain.slice(0, 2).map(u => <li key={u} className="cd-muted">? {u}</li>)}
                </ul>
              ) : (
                <p className="cd-muted">Nothing to prepare is on record.</p>
              )}
            </section>

            <section className="cd-card" aria-label="Heard" data-testid="claire-desk-heard">
              <p className="cd-kicker">HEARD</p>
              {m.heard.length ? (
                <ul className="cd-ready">
                  {m.heard.map(h => (
                    <li key={h.id}>
                      ✓ {h.rule} <small>(you said, {h.heardOn}: “{h.quote}”)</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cd-muted">No standing rules saved yet. Tell Claire how you want calls to go and it shows here once it is saved.</p>
              )}
              {m.promised.length ? (
                <ul className="cd-ready">
                  {m.promised.map(p => (
                    <li key={p.id}>
                      {p.status === "consumed" ? "✓ Kept" : "Prepared"} for {p.forDate}: {p.summary.join(", ")}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <OpenComms onChanged={refresh} />

            <section className="cd-card cd-confirm" aria-label="Confirm tomorrow" data-testid="confirm-tomorrow">
              {pendingTomorrow.length ? (
                <p className="cd-note">Confirming saves tomorrow's plan snapshot only. It does not approve: {pendingTomorrow.map(i => i.title).join("; ")}.</p>
              ) : null}
              {m.tomorrowConfirmedAt && confirmState.state === "idle" ? (
                <p className="cd-ok" data-testid="confirm-tomorrow-already">Tomorrow already confirmed at {new Date(m.tomorrowConfirmedAt).toLocaleString()}.</p>
              ) : null}
              <button type="button" className="cd-navy" disabled={confirmState.state === "saving"} onClick={() => void confirmTomorrow()} data-testid="confirm-tomorrow-button">
                {confirmState.state === "saving" ? "Saving…" : confirmState.state === "error" ? "Retry confirm tomorrow" : m.tomorrowConfirmedAt ? "Confirm tomorrow again" : "CONFIRM TOMORROW"}
              </button>
              {confirmState.text ? (
                <p role={confirmState.state === "error" ? "alert" : "status"} className={confirmState.state === "error" ? "cd-error" : "cd-ok"} data-testid="confirm-tomorrow-result">
                  {confirmState.state === "error" ? `Not saved: ${confirmState.text}` : confirmState.text}
                </p>
              ) : null}
            </section>

            <section className="cd-card" aria-label="Outcome" data-testid="claire-desk-outcome">
              <p className="cd-kicker">THE OUTCOME · THIS WEEK</p>
              {m.outcomes.length ? (
                <ul className="cd-ready">{m.outcomes.slice(-5).map(o => <li key={o}>{o}</li>)}</ul>
              ) : (
                <p className="cd-muted">No results reported yet this week. Tell Claire on comms what happened after each call.</p>
              )}
              <p className="cd-fine">Reported by you unless marked verified. Paid orders appear once CleanCloud syncs.</p>
            </section>

            <ActivateRoutine calls={m.dailyCalls} onChanged={refresh} />

            <section className="cd-card" aria-label="Call settings">
              <p className="cd-kicker">CALL SETTINGS</p>
              <ClaireDailyCallSettings />
              <ClaireStrategicCallConsent />
            </section>

            <DaphnePresentationConsent />

            <section className="cd-card" aria-label="Full week plan">
              <p className="cd-kicker">FULL WEEK PLAN</p>
              <ClaireStrategicProposal />
            </section>
          </>
        ) : null}

        <details data-testid="claire-relationship-closing" className="cd-card">
          <summary>Relationship closing</summary>
          <p className="cd-small">Preview the safe closing record Claire can produce. It never deletes or changes business records.</p>
          <button type="button" disabled={relationshipClosing.isFetching} onClick={() => void relationshipClosing.refetch()}>
            {relationshipClosing.isFetching ? "Building closing record…" : "Preview relationship closing"}
          </button>
          {relationshipClosing.error ? <p role="alert" className="cd-error">{relationshipClosing.error.message}</p> : null}
          {relationshipClosing.data ? <p data-testid="claire-relationship-closing-preview">{relationshipClosing.data.closingMessage}</p> : null}
        </details>
      </main>

      <aside className="cd-claire" aria-label="Claire">
        <div className="cd-portrait" aria-hidden>C</div>
        <p className="cd-name">CLAIRE <small>Chief of staff</small></p>
        {claireLine ? <p className="cd-says" data-testid="claire-desk-says">“{claireLine}”</p> : null}
        <ClaireComposer variant="desk" onTurn={refresh} />
        {m?.recentChange ? <p className="cd-small">Latest change: {m.recentChange}</p> : null}
        {m?.rationale ? (
          <details className="cd-why" data-testid="claire-desk-why">
            <summary>Why this plan?</summary>
            <p>{m.rationale.approach}</p>
            {m.rationale.evidence.length ? (
              <ul className="cd-small">
                {m.rationale.evidence.map(e => <li key={e.description}>{e.description} <em>({e.classification.replace("_", " ")})</em></li>)}
              </ul>
            ) : null}
            {m.rationale.completionCondition ? <p className="cd-small">Done when: {m.rationale.completionCondition}</p> : null}
            {m.adaptations.length ? <p className="cd-small">{m.adaptations[0]}</p> : null}
          </details>
        ) : null}
        <div className="cd-claire-map" aria-hidden />
      </aside>
    </div>
  );
}

type DailyCalls = { timeZone: string | null } & Record<string, unknown>;

/** One tap per purpose, each its own explicit permission, with readback of when Claire will first call. */
function ActivateRoutine({ calls, onChanged }: { calls: unknown; onChanged: () => void }) {
  const grant = trpc.system.weeklyMission.grantDailyCalls.useMutation();
  const [result, setResult] = useState<Record<string, string>>({});
  const data = calls as DailyCalls | null;
  const zone = data?.timeZone ?? null;
  const plans = (["morning_readiness", "evening_debrief"] as const).map(purpose => ({
    purpose,
    ...CLAIRE_DAILY_CALL_DEFAULTS[purpose],
  }));
  const saved = (purpose: ClaireDailyCallPurpose) =>
    data?.[purpose] as { enabled?: boolean; grant?: { weekdays: number[]; localStart: string; localEnd: string } | null } | undefined;
  const needsUpdate = (purpose: ClaireDailyCallPurpose) =>
    Boolean(saved(purpose)?.enabled) && !matchesClaireDailyCallDefaults(purpose, saved(purpose)?.grant);
  // Existing, previously consented schedules remain in force until the operator
  // explicitly chooses the corrected one. Surface that correction prominently.
  const off = plans.filter(p => !saved(p.purpose)?.enabled || needsUpdate(p.purpose) || result[p.purpose]);
  if (!data || !off.length) return null;
  return (
    <section className="cd-card cd-activate" aria-label="Daily routine" data-testid="activate-routine">
      <p className="cd-kicker">DAILY ROUTINE</p>
      <p className="cd-small">Recommended. Each call is its own permission; allowing one never allows the other. Times are {zone ?? "business time"}.</p>
      {off.map(p => (
        <div key={p.purpose} className="cd-activate-row">
          <span>
            <strong>{p.label}</strong> — {p.when}
            {needsUpdate(p.purpose) ? <small> · Previously saved schedule differs. Update it to use this daily routine.</small> : null}
          </span>
          {result[p.purpose] ? null : <button
            type="button"
            className="cd-gold"
            disabled={grant.isPending || !zone}
            data-testid={`activate-${p.purpose}`}
            onClick={() =>
              void grant
                .mutateAsync({ purpose: p.purpose, weekdays: [...p.weekdays], localStart: p.start, localEnd: p.end, timeZone: zone!, consent: true })
                .then(r => {
                  const when = r.status?.nextScheduled ?? r.status?.nextWindow;
                  setResult(v => ({ ...v, [p.purpose]: when ? `Verified. First call window: ${new Date(when).toLocaleString()}.` : "Allowed, but no upcoming window was found." }));
                })
                .catch(e => setResult(v => ({ ...v, [p.purpose]: `Not allowed: ${e instanceof Error ? e.message : "nothing changed"}` })))
                .finally(onChanged)
            }
          >
            {needsUpdate(p.purpose) ? "Update" : "Allow"} {p.label.toLowerCase()} calls
          </button>}
          {result[p.purpose] ? <p role="status" className="cd-small" data-testid={`activate-${p.purpose}-result`}>{result[p.purpose]}</p> : null}
        </div>
      ))}
    </section>
  );
}
