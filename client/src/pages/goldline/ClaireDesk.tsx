import { useCallback, useEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Box, Map, Settings, Users, Wallet, X } from "lucide-react";
import { isCustomerHostView, resolveJoystickHostView } from "@shared/joystickHostRouting";
import { PRODUCT_NAME } from "@shared/productIdentity";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { CLAIRE_DAILY_CALL_DEFAULTS, matchesClaireDailyCallDefaults, type ClaireDailyCallPurpose } from "../../../../shared/claireDailyCallDefaults";
import { ChapterHost } from "@/story/ChapterHost";
import { storyGameFor } from "@/story/games/registry";
import { storyClient } from "@/story/storyClient";
import { tomorrowLine } from "@/story/tomorrowLine";
import { useRefreshStoryTonight, useStoryTonight } from "@/story/useStoryTonight";
import { chapterEyebrow, heroLines, HOME_ART, homeNavFor, metricView, type HomeNavItem, type StoryEnabled } from "../storyHome/homeModel";
import { WonTonight } from "../storyHome/StoryHome";
import { ClaireDailyCallSettings } from "./ClaireDailyCallSettings";
import { ClaireStrategicCallConsent } from "./ClaireStrategicCallConsent";
import { ClaireStrategicProposal } from "./ClaireStrategicProposal";
import { OpenComms, type CommsPhase } from "./claireDesk/OpenComms";
import { SignupKnowledge } from "./claireDesk/SignupKnowledge";
import { DaphnePresentationConsent } from "./claireDesk/DaphnePresentationConsent";
import { callSheetWithheldCopy } from "./claireDesk/callSheetFreshness";
import "../storyHome/StoryHome.css";
import "./claireDesk/claireDesk.css";

/**
 * The desk renders on the admin host and on a customer's JOYSTICK host. On the customer host Home is the Day Line page
 * and only routes that host serves appear in the bar, so no link here leads to a refusal. A tenant member gets the
 * tenant routes on either host: the admin host sends them away from admin paths.
 */
const hostView = (path: string) => resolveJoystickHostView(typeof window === "undefined" ? "" : window.location.hostname, path);
const HOME_PATH = isCustomerHostView(hostView("/")) ? "/play" : "/";
export const barNavFor = (role: string | null | undefined): HomeNavItem[] =>
  homeNavFor(role).filter(item => hostView(item.path) !== "customer-forbidden");

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
 * JOYSTICK · Claire. One frame over the city at night, in two lanes that never mix: tonight's story on the left (words
 * only from `system.story.tonight`), Claire's Day Line on the right (business only: the one mission, real decisions,
 * one input to her). Everything else on the desk sits one link away in a drawer. Every figure comes from stored
 * evidence; unknown values are left out or read "Not wired yet".
 */
export default function ClaireDesk() {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const mission = trpc.system.weeklyMission.deskMission.useQuery(undefined, { retry: false, staleTime: 15_000 });
  const respond = trpc.system.weeklyMission.respondToPreparedProposal.useMutation();
  const confirm = trpc.system.claire.confirmTomorrow.useMutation();
  const relationshipClosing = trpc.system.claireRelationshipOffboarding.preview.useQuery(undefined, { enabled: false, retry: false });
  const story = useStoryTonight(true);
  const refreshTonight = useRefreshStoryTonight();
  const [approval, setApproval] = useState<{ state: "idle" | "saving" | "ok" | "error"; text?: string }>({ state: "idle" });
  const [confirmState, setConfirmState] = useState<{ state: "idle" | "saving" | "ok" | "error"; text?: string }>({ state: "idle" });
  const [deskOpen, setDeskOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("desk") === "open");
  const [why, setWhy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState<CommsPhase>("idle");
  const [draft, setDraft] = useState<{ id: number; text: string } | null>(null);
  const deskOpener = useRef<HTMLElement | null>(null);
  const drawer = useRef<HTMLElement>(null);

  const refresh = useCallback(() => {
    void utils.system.weeklyMission.deskMission.invalidate();
    void utils.system.weeklyMission.preparedProposal.invalidate();
    void utils.system.weeklyMission.dailyCallStatus.invalidate();
  }, [utils]);

  const openDesk = (section?: string) => {
    deskOpener.current = document.activeElement as HTMLElement | null;
    setDeskOpen(true);
    window.requestAnimationFrame(() => {
      const target = section ? document.getElementById(section) : null;
      if (target) target.scrollIntoView({ block: "start" });
      drawer.current?.querySelector<HTMLElement>(".cd-drawer-close")?.focus({ preventScroll: Boolean(target) });
    });
  };
  const closeDesk = useCallback(() => {
    setDeskOpen(false);
    deskOpener.current?.focus();
  }, []);

  // Esc closes the drawer first, then returns Home. A chapter in play handles its own Esc; typing in a field never leaves.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || playing) return;
      if (deskOpen) return closeDesk();
      if ((event.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      navigate(HOME_PATH);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDesk, deskOpen, navigate, playing]);

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

  const tonight = story.data?.enabled ? story.data : null;
  const chapter = tonight?.state === "available" ? tonight.chapter : null;
  // Expired work has a real Reschedule control in the full week plan; work still pending moves by telling Claire.
  const moveToDay = () =>
    primary?.status === "needs_reschedule"
      ? openDesk("cd-week-plan")
      : primary
        ? setDraft(d => ({ id: (d?.id ?? 0) + 1, text: `Move "${primary.title}" to ` }))
        : undefined;

  return (
    <div className="cd-root" data-testid="claire-desk" data-playing={playing || undefined}>
      <Skyline lit={Boolean(tonight?.chapter)} />
      <div className="cd-frame">
        <TopBar />
        <KpiStrip />

        <div className="cd-lanes">
          {tonight ? (
            <StoryLane tonight={tonight} playing={playing} onPlay={() => setPlaying(true)} onAnswered={() => void refreshTonight()} />
          ) : null}

          <aside className="cd-dock" aria-label="Claire · Day Line">
            <header className="cd-dock-head">
              <ClairePortrait />
              <div className="cd-dock-id">
                <p className="cd-name">
                  CLAIRE <span>· DAY LINE</span>
                </p>
                <Waveform phase={phase} />
              </div>
            </header>

            {mission.isLoading ? <p className="cd-muted">Loading Claire's picture…</p> : null}
            {mission.error ? <p role="alert" className="cd-error">Claire's mission couldn't load: {mission.error.message}</p> : null}

            {m ? (
              <>
                <div className="cd-dock-mission" data-testid={primary ? "claire-desk-primary-mission" : undefined}>
                  {claireLine ? <p className="cd-says" data-testid="claire-desk-says">{claireLine}</p> : null}
                  {primary ? (
                    <p className="cd-meta">
                      <span className={`cd-status cd-status-${primary.status}`}>{STATUS[primary.status]}</span>
                      <span>{dayLabel(primary.date, m.businessDate, m.tomorrow)}</span>
                      {primary.when ? <span>{primary.when}</span> : null}
                    </p>
                  ) : null}
                  {primary?.status === "awaiting_approval" ? (
                    <div className="cd-approve" data-testid="claire-approval-control">
                      {/offer/i.test(primary.objective ?? "") ? (
                        <p className="cd-fine">No offer is approved. Calls can be plain check-ins; any discount is your decision, and Claire won't promise one.</p>
                      ) : null}
                      <div className="cd-approve-row">
                        <button type="button" className="cd-gold" disabled={approval.state === "saving"} onClick={() => void approve(primary.id)} data-testid="approve-primary-mission">
                          {approval.state === "saving" ? "Saving approval…" : "Approve this mission"}
                        </button>
                        <span className="cd-fine">Adds it to your Day Line. Contacts no one.</span>
                      </div>
                    </div>
                  ) : null}
                  {primary?.status === "needs_reschedule" ? (
                    <p className="cd-note" data-testid="claire-desk-needs-reschedule">
                      Its time has passed, so it can't be approved as planned. Pick a new day with “Move it to another day”, or tell Claire below when it should happen.
                    </p>
                  ) : null}
                  {approval.state === "ok" || approval.state === "error" ? (
                    <p role={approval.state === "error" ? "alert" : "status"} className={approval.state === "error" ? "cd-error" : "cd-ok"} data-testid="approve-result">
                      {approval.text}
                    </p>
                  ) : null}
                </div>

                <div className="cd-decisions" aria-label="Decisions" data-testid="confirm-tomorrow">
                  <div className="cd-chips">
                    <button type="button" className="cd-chip" disabled={confirmState.state === "saving"} onClick={() => void confirmTomorrow()} data-testid="confirm-tomorrow-button">
                      {confirmState.state === "saving" ? "Saving…" : confirmState.state === "error" ? "Retry confirm tomorrow" : m.tomorrowConfirmedAt ? "Confirm tomorrow again" : "Confirm tomorrow"}
                    </button>
                    {primary?.status === "awaiting_approval" || primary?.status === "needs_reschedule" ? (
                      <button type="button" className="cd-chip" onClick={moveToDay} data-testid="claire-desk-move">
                        Move it to another day
                      </button>
                    ) : null}
                    {m.rationale ? (
                      <button type="button" className="cd-chip" aria-expanded={why} aria-controls="cd-why" onClick={() => setWhy(v => !v)} data-testid="claire-desk-why-toggle">
                        Why this one?
                      </button>
                    ) : null}
                  </div>
                  {pendingTomorrow.length ? (
                    <p className="cd-fine">Confirming saves tomorrow's plan snapshot only. It does not approve: {pendingTomorrow.map(i => i.title).join("; ")}.</p>
                  ) : null}
                  {m.tomorrowConfirmedAt && confirmState.state === "idle" ? (
                    <p className="cd-fine cd-ok" data-testid="confirm-tomorrow-already">Tomorrow already confirmed at {new Date(m.tomorrowConfirmedAt).toLocaleString()}.</p>
                  ) : null}
                  {confirmState.text ? (
                    <p role={confirmState.state === "error" ? "alert" : "status"} className={confirmState.state === "error" ? "cd-error" : "cd-ok"} data-testid="confirm-tomorrow-result">
                      {confirmState.state === "error" ? `Not saved: ${confirmState.text}` : confirmState.text}
                    </p>
                  ) : null}
                </div>

                {m.rationale && why ? (
                  <div className="cd-why" id="cd-why" data-testid="claire-desk-why">
                    <p>{m.rationale.approach}</p>
                    {m.rationale.evidence.length ? (
                      <ul className="cd-small">
                        {m.rationale.evidence.map(e => <li key={e.description}>{e.description} <em>({e.classification.replace("_", " ")})</em></li>)}
                      </ul>
                    ) : null}
                    {primary?.status === "awaiting_approval" ? <ClaireEvidenceReceipts evidence={m.rationale.evidence} /> : null}
                    {m.rationale.completionCondition ? <p className="cd-small">Done when: {m.rationale.completionCondition}</p> : null}
                    {m.adaptations.length ? <p className="cd-small">{m.adaptations[0]}</p> : null}
                  </div>
                ) : null}
              </>
            ) : null}

            <SignupKnowledge timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"} />

            <OpenComms onChanged={refresh} onPhase={setPhase} draft={draft} />

            <button type="button" className="cd-desk-link" onClick={() => openDesk()} aria-controls="cd-desk-drawer" aria-expanded={deskOpen} data-testid="claire-desk-drawer-open">
              Desk: runway, call sheet, settings <ArrowRight aria-hidden />
            </button>
          </aside>
        </div>
      </div>

      <aside ref={drawer} id="cd-desk-drawer" className="cd-drawer" aria-label="The desk" hidden={!deskOpen} data-testid="claire-desk-drawer">
        <header className="cd-drawer-head">
          <p className="cd-kicker">THE DESK</p>
          <button type="button" className="cd-drawer-close" onClick={closeDesk} aria-label="Close the desk" data-testid="claire-desk-drawer-close">
            <X aria-hidden />
          </button>
        </header>

        {m ? (
          <>
            <section className="cd-card" data-testid="claire-desk-objective">
              <p className="cd-kicker">THE OBJECTIVE</p>
              <h2>{m.objective ?? "No objective set yet"}</h2>
              {m.rationale ? (
                <>
                  <p className="cd-kicker cd-mt">THE OPPORTUNITY</p>
                  <p className="cd-opportunity" data-testid="claire-desk-opportunity">{m.rationale.diagnosis}</p>
                </>
              ) : null}
              {m.area ? <span className="cd-area">{m.area}</span> : null}
              {m.recentChange ? <p className="cd-small">Latest change: {m.recentChange}</p> : null}
            </section>

            {secondary ? (
              <article className="cd-card cd-secondary" data-testid="claire-desk-secondary-mission">
                <p className="cd-kicker">ALSO · {dayLabel(secondary.date, m.businessDate, m.tomorrow)}</p>
                <h3>{secondary.title}</h3>
                {secondary.objective ? <p className="cd-small">{secondary.objective}</p> : null}
                <span className={`cd-status cd-status-${secondary.status}`}>{STATUS[secondary.status]}</span>
              </article>
            ) : null}

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
                <div className="cd-sheet-head">
                  <div>
                    <p className="cd-kicker">CLAIRE PREPARED · CALL SHEET</p>
                    <h3>
                      Lapsed {m.winBack.area} customers — {m.winBack.contacts.length} of {m.winBack.lapsedCount}, highest spend first
                    </h3>
                  </div>
                  <a href="/admin/claire/scheduled-outreach" className="cd-outbox">
                    Scheduled Outreach Outbox
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

            <section className="cd-card" aria-label="Outcome" data-testid="claire-desk-outcome">
              <p className="cd-kicker">THE OUTCOME · THIS WEEK</p>
              {m.outcomes.length ? (
                <ul className="cd-ready">{m.outcomes.slice(-5).map(o => <li key={o}>{o}</li>)}</ul>
              ) : (
                <p className="cd-muted">No results reported yet this week. Tell Claire what happened after each call.</p>
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

            <section className="cd-card" aria-label="Full week plan" id="cd-week-plan">
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
      </aside>

      {playing && tonight && chapter ? (
        <ChapterHost
          client={storyClient()}
          chapterNumber={chapter.number}
          chapterCount={tonight.chapterCount}
          title={chapter.title}
          onClose={() => {
            setPlaying(false);
            void refreshTonight();
          }}
        />
      ) : null}
    </div>
  );
}

const NAV_ICONS: Record<HomeNavItem["key"], ComponentType<SVGProps<SVGSVGElement>>> = {
  city: Map,
  customers: Users,
  operations: Box,
  money: Wallet,
  settings: Settings,
};

function TopBar() {
  const { user } = useAuth();
  return (
    <header className="cd-bar">
      <Link href={HOME_PATH} className="cd-wordmark" aria-label={`${PRODUCT_NAME} home`}>
        {PRODUCT_NAME}
      </Link>
      <nav className="cd-nav" aria-label="Main">
        {barNavFor(user?.role).map(item => {
          const Icon = NAV_ICONS[item.key];
          return (
            <Link key={item.key} href={item.path} className="cd-nav-icon" aria-label={item.label} title={item.label}>
              <Icon aria-hidden="true" />
            </Link>
          );
        })}
      </nav>
      <Link href={HOME_PATH} className="cd-comms-pill" aria-label="Close comms and return Home (Esc)" data-testid="claire-desk-home">
        <span className="cd-comms-pill-dot" aria-hidden />
        COMMS OPEN <span className="cd-comms-pill-key">· ESC</span>
      </Link>
    </header>
  );
}

/** The business at a glance, the same reads as Home. Truthful numbers only: unsourced reads "Not wired yet". */
function KpiStrip() {
  const snapshot = trpc.system.accountSnapshot.get.useQuery(undefined, { retry: 1, staleTime: 60_000, refetchInterval: 120_000 });
  const data = snapshot.data;
  const stats = [
    { key: "week", label: "WTD", view: metricView(data?.week.revenueCents, "cents"), against: data?.week.comparison.label },
    { key: "month", label: "MTD", view: metricView(data?.month.revenueCents, "cents"), against: data?.month.comparison.label },
    { key: "orders", label: "Orders (MTD)", view: metricView(data?.month.orders, "count"), against: data?.month.comparison.label },
    { key: "new", label: "New customers (MTD)", view: metricView(data?.month.newCustomers, "count"), against: data?.month.comparison.label },
  ];
  return (
    <section className="cd-kpis" aria-label="Business snapshot" data-testid="claire-desk-snapshot">
      {stats.map(stat => (
        <span key={stat.key} className="cd-kpi">
          {stat.label}{" "}
          <strong
            className={stat.view.wired ? undefined : "is-not-wired"}
            title={stat.view.recorded ? "What the books hold so far; not every source is confirmed for this stretch." : undefined}
          >
            {stat.view.text}
          </strong>
          {stat.view.change ? (
            <span className={`cd-kpi-change is-${stat.view.change.direction}`} title={stat.against ? `Against ${stat.against}` : undefined}>
              {stat.view.change.text}
            </span>
          ) : null}
        </span>
      ))}
    </section>
  );
}

/**
 * Tonight's chapter. Story words come only from `system.story.tonight`; no business number appears here. A won
 * chapter's open question is answered right here (tenant members never reach the story Home, and the question is only
 * served the night it was won); once answered here, what the answer earned stays in view.
 */
export function StoryLane({
  tonight,
  playing,
  onPlay,
  onAnswered,
}: {
  tonight: StoryEnabled;
  playing: boolean;
  onPlay: () => void;
  onAnswered: () => void;
}) {
  const [answeredHere, setAnsweredHere] = useState(false);
  const chapter = tonight.chapter;
  if (tonight.state === "season_complete" || !chapter) {
    return (
      <section className="cd-story" aria-label="Tonight's chapter" data-testid="claire-desk-story" data-state="season_complete">
        <p className="cd-eyebrow">SEASON COMPLETE</p>
        <h1 className="cd-title is-settled">{tonight.seasonTitle}</h1>
        <p className="cd-hook">Every chapter of this season is played.</p>
      </section>
    );
  }
  if (tonight.state === "won_tonight") {
    const open = Boolean(chapter.question && !chapter.question.answered);
    if (open || answeredHere) {
      return (
        <section className="cd-story" aria-label="Tonight's chapter" data-testid="claire-desk-story" data-state="won_tonight">
          <WonTonight
            chapter={chapter}
            chapterCount={tonight.chapterCount}
            onAnswered={() => {
              setAnsweredHere(true);
              onAnswered();
            }}
          />
        </section>
      );
    }
    const tomorrow = tomorrowLine(chapter.closing?.tomorrow, chapter.number, tonight.chapterCount);
    return (
      <section className="cd-story" aria-label="Tonight's chapter" data-testid="claire-desk-story" data-state="won_tonight">
        <p className="cd-eyebrow">
          {chapterEyebrow(chapter.number)} · REMEMBERED
        </p>
        <h1 className="cd-title is-settled">{chapter.title}</h1>
        {tomorrow ? <p className="cd-hook">{tomorrow}</p> : null}
      </section>
    );
  }
  const hook = heroLines(chapter.before).hook[0] ?? null;
  const game = storyGameFor(chapter.gameKey);
  const poster = game?.poster;
  return (
    <section className="cd-story" aria-label="Tonight's chapter" data-testid="claire-desk-story" data-state="available">
      <p className="cd-eyebrow">{chapterEyebrow(chapter.number)} · TONIGHT</p>
      <h1 className="cd-title">{chapter.title}</h1>
      {hook ? <p className="cd-hook">{hook.text}</p> : null}
      <button type="button" className="cd-cctv" onClick={onPlay} disabled={playing} data-testid="claire-desk-play">
        {poster ? (
          <span className="cd-cctv-image">
            <img src={poster.src} alt={poster.alt} width={720} height={496} />
          </span>
        ) : null}
        <span className="cd-cctv-action">
          <span>{game?.launchLabel ?? "Play tonight’s chapter"}</span>
          <span className="cd-cctv-time">
            About 5 min <ArrowRight aria-hidden />
          </span>
        </span>
      </button>
    </section>
  );
}

function ClairePortrait() {
  const [missing, setMissing] = useState(false);
  return (
    <span className="cd-portrait" aria-hidden="true">
      {missing ? "C" : <img src={HOME_ART.claire} alt="" onError={() => setMissing(true)} />}
    </span>
  );
}

const WAVE = [8, 14, 20, 12, 24, 18, 10, 22, 16, 26, 12, 20, 8, 18, 24, 14, 10, 22, 18, 12, 26, 16, 8, 20, 14, 24, 10, 18];

/** Claire's line, drawn: quiet while comms is closed, alive while she speaks, listening in between. */
function Waveform({ phase }: { phase: CommsPhase }) {
  return (
    <span className="cd-wave" data-phase={phase} aria-hidden="true">
      {WAVE.map((h, i) => (
        <span key={i} style={{ height: h, animationDelay: `${((i * 37) % 11) / 10}s` }} />
      ))}
    </span>
  );
}

/** The city at night, with tonight's story building lit when there is a chapter. Decoration only. */
function Skyline({ lit }: { lit: boolean }) {
  return (
    <svg className="cd-sky" aria-hidden="true" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMax slice">
      <defs>
        <radialGradient id="cd-sky-fill" cx="72%" cy="38%" r="70%">
          <stop offset="0" stopColor="#1c3542" />
          <stop offset="1" stopColor="#0b151b" />
        </radialGradient>
        <radialGradient id="cd-sky-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ecc983" stopOpacity=".55" />
          <stop offset="1" stopColor="#ecc983" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="cd-sky-fade" x1="0" x2="1">
          <stop offset="0" stopColor="#0b151b" />
          <stop offset=".42" stopColor="#0b151b" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="1440" height="900" fill="url(#cd-sky-fill)" />
      <g fill="#13242d">
        <rect x="560" y="520" width="70" height="380" />
        <rect x="640" y="470" width="54" height="430" />
        <rect x="704" y="560" width="90" height="340" />
        <rect x="810" y="430" width="60" height="470" />
        <rect x="1010" y="500" width="80" height="400" />
        <rect x="1100" y="410" width="64" height="490" />
        <rect x="1176" y="540" width="96" height="360" />
        <rect x="1284" y="470" width="58" height="430" />
        <rect x="1352" y="580" width="88" height="320" />
      </g>
      <g fill="#192f3a">
        <rect x="600" y="640" width="120" height="260" />
        <rect x="740" y="610" width="96" height="290" />
        <rect x="1060" y="630" width="140" height="270" />
        <rect x="1220" y="660" width="110" height="240" />
      </g>
      {lit ? <circle cx="935" cy="250" r="190" fill="url(#cd-sky-glow)" /> : null}
      <rect x="902" y="230" width="66" height="670" fill="#1d3846" />
      <rect x="912" y="214" width="46" height="18" fill="#1d3846" />
      {lit ? <rect className="cd-sky-lit" x="906" y="240" width="58" height="16" fill="#ecc983" /> : null}
      <g fill="#d8ac59" opacity=".28">
        <rect x="912" y="290" width="8" height="6" />
        <rect x="932" y="330" width="8" height="6" />
        <rect x="948" y="370" width="8" height="6" />
        <rect x="916" y="430" width="8" height="6" />
        <rect x="940" y="500" width="8" height="6" />
        <rect x="1118" y="460" width="6" height="5" />
        <rect x="1300" y="520" width="6" height="5" />
        <rect x="660" y="520" width="6" height="5" />
        <rect x="826" y="480" width="6" height="5" />
      </g>
      <rect width="1440" height="900" fill="url(#cd-sky-fade)" />
    </svg>
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
