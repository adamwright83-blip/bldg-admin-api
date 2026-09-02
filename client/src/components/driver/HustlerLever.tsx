/**
 * The Hustler Lever — a carnival machine that deals you one real customer.
 *
 * Pull it and a genuinely dormant customer drops out as a mission: their real
 * order history, a grounded draft message, and the five steps to actually send
 * it from your own phone. Send it, and the meter moves.
 *
 * WHAT THIS IS NOT
 *
 * Goldline never sends anything. `openComposer` returns an `sms:` URL that
 * opens YOUR messaging app with the draft in it; you send it from your own
 * number, then come back and confirm you did. That is why the meter reads as
 * effort rather than delivery — an attestation is honest evidence of work you
 * controlled, and nothing here pretends to know the message arrived.
 *
 * And sending is not recovery. Every screen here says so, because the whole
 * point of a truthful save file is that a sent text leaves the customer exactly
 * as dormant as they were until a real paid order comes back.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  TIER_LABELS,
  nextNotchHint,
  projectHustlerDay,
  type HustlerDayMeter,
} from "@shared/hustlerDayMeter";
import type { LeverPull } from "@shared/hustlerLever";

const APPROVE_CONFIRMATION =
  "I reviewed this exact message and approve it for this customer" as const;
const SENT_CONFIRMATION =
  "I manually sent this exact approved message to this customer" as const;

/** Reasons the machine has nothing, said in terms the operator can act on. */
const EMPTY_COPY: Record<string, string> = {
  no_scan: "No customer scan yet. Run one from Churn Radar to load the machine.",
  all_active: "Everyone worth calling is already mid-order. Nothing to rekindle.",
  all_engaged: "Nobody is overdue enough yet. Come back when a cadence lapses.",
  all_in_progress: "Every eligible customer is already a mission you started.",
};

function newRequestId(): string {
  return crypto.randomUUID();
}

export function HustlerLever({ onClose }: { onClose?: () => void }) {
  const utils = trpc.useUtils();
  const current = trpc.system.hustlerLever.current.useQuery(undefined, {
    staleTime: 15_000,
  });

  const pull = trpc.system.hustlerLever.pull.useMutation();
  const humanize = trpc.system.hustlerLever.humanize.useMutation();
  const approve = trpc.system.hustlerLever.approve.useMutation();
  const recordPermission = trpc.system.hustlerLever.recordPermission.useMutation();
  const openComposer = trpc.system.hustlerLever.openComposer.useMutation();
  const confirmSent = trpc.system.hustlerLever.confirmSent.useMutation();

  const [draftText, setDraftText] = useState<string | null>(null);
  const [permissionSource, setPermissionSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  const mission = current.data?.mission ?? null;
  const busy =
    pull.isPending ||
    humanize.isPending ||
    approve.isPending ||
    recordPermission.isPending ||
    openComposer.isPending ||
    confirmSent.isPending;

  /*
    The meter is derived here from what the day actually recorded, not stored.
    `hardActions` is not wired yet — visits and pickups land through a different
    seam — so it is honestly zero rather than guessed at.
  */
  const meter: HustlerDayMeter = useMemo(
    () =>
      projectHustlerDay({
        outreachSent: current.data?.contactedToday ?? 0,
        hardActions: 0,
      }),
    [current.data?.contactedToday]
  );

  const refresh = async () => {
    await utils.system.hustlerLever.current.invalidate();
  };

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (caught) {
      /*
        Show the real reason. The grounded-message firewall rejects discount
        and coupon language, so a humanized rewrite containing "10% off" fails
        here — and the operator needs to know THAT, not a generic failure.
      */
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    }
  };

  const handlePull = (direction: LeverPull) =>
    run(async () => {
      setEmpty(null);
      const result = await pull.mutateAsync({
        pull: direction,
        requestId: newRequestId(),
      });
      if (!result.mission && result.empty) setEmpty(result.empty);
      if (result.mission) setDraftText(result.mission.draft?.message ?? "");
    });

  const handleSend = () =>
    run(async () => {
      if (!mission?.draft) return;
      const prepared = await openComposer.mutateAsync({
        interventionId: mission.id,
        draftId: mission.draft.id,
        contentHash: mission.draft.contentHash,
        requestId: newRequestId(),
      });
      // Opens the operator's own messaging app. Goldline sends nothing.
      window.location.href = prepared.smsUrl;
    });

  const handleConfirmSent = () =>
    run(async () => {
      if (!mission?.draft) return;
      await confirmSent.mutateAsync({
        interventionId: mission.id,
        draftId: mission.draft.id,
        contentHash: mission.draft.contentHash,
        requestId: newRequestId(),
        confirmation: SENT_CONFIRMATION,
      });
      setCelebrating(true);
      window.setTimeout(() => setCelebrating(false), 900);
      setDraftText(null);
    });

  const tier = TIER_LABELS[meter.tier];
  const hint = nextNotchHint(meter);

  return (
    <section
      className={`hustler-lever${celebrating ? " is-celebrating" : ""}`}
      data-testid="hustler-lever"
      aria-label="Hustler meter and reactivation lever"
    >
      <header className="hl-head">
        <div className="hl-tier" data-tier={meter.tier}>
          <strong>{tier.name}</strong>
          <small>{tier.blurb}</small>
        </div>
        {onClose ? (
          <button type="button" className="hl-close" onClick={onClose}>
            CLOSE
          </button>
        ) : null}
      </header>

      <div className="hl-meter" role="img" aria-label={`Today: ${tier.name}. ${meter.because}`}>
        <div className="hl-track">
          <i style={{ height: `${Math.round(meter.progressToNext * 100)}%` }} />
        </div>
        <p className="hl-because">{meter.because}</p>
        {hint ? <p className="hl-hint">{hint}</p> : null}
      </div>

      {!mission ? (
        <div className="hl-pulls">
          <p className="hl-prompt">Pull for a customer worth winning back.</p>
          <button
            type="button"
            className="hl-pull is-warm"
            disabled={busy}
            onClick={() => handlePull("warm")}
          >
            <b>WARM LEAD</b>
            <small>Strong past relationship</small>
          </button>
          <button
            type="button"
            className="hl-pull is-big"
            disabled={busy}
            onClick={() => handlePull("big_swing")}
          >
            <b>BIG SWING</b>
            <small>Higher value, harder win</small>
          </button>
          {empty ? <p className="hl-empty">{EMPTY_COPY[empty] ?? empty}</p> : null}
        </div>
      ) : (
        <div className="hl-mission" data-testid="hustler-lever-mission">
          <div className="hl-customer">
            <strong>{mission.customer.customerName}</strong>
            <small>
              {mission.customer.historyOrderCount} previous orders ·{" "}
              {mission.customer.daysSinceLastOrder ?? "?"} days since last order
            </small>
          </div>

          {mission.status === "draft_pending_review" ? (
            <>
              <label className="hl-humanize">
                <span>MAKE IT HUMAN</span>
                <small>Change at least one line so this sounds like you.</small>
                <textarea
                  rows={5}
                  value={draftText ?? mission.draft?.message ?? ""}
                  onChange={event => setDraftText(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={busy || !draftText?.trim()}
                onClick={() =>
                  run(async () => {
                    await humanize.mutateAsync({
                      interventionId: mission.id,
                      requestId: newRequestId(),
                      message: (draftText ?? "").trim(),
                    });
                  })
                }
              >
                SAVE MY VERSION
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (!mission.draft) return;
                    await approve.mutateAsync({
                      interventionId: mission.id,
                      draftId: mission.draft.id,
                      requestId: newRequestId(),
                      confirmation: APPROVE_CONFIRMATION,
                    });
                  })
                }
              >
                APPROVE THIS MESSAGE
              </button>
            </>
          ) : null}

          {mission.status === "approved" && !mission.permission.composerAllowed ? (
            <div className="hl-permission">
              <p>
                Record how you have permission to text {mission.customer.customerName}.
              </p>
              <input
                value={permissionSource}
                onChange={event => setPermissionSource(event.target.value)}
                placeholder="e.g. asked me to follow up at pickup on 8/14"
              />
              <button
                type="button"
                disabled={busy || permissionSource.trim().length < 3}
                onClick={() =>
                  run(async () => {
                    await recordPermission.mutateAsync({
                      interventionId: mission.id,
                      requestId: newRequestId(),
                      status: "opted_in",
                      sourceReference: permissionSource.trim(),
                    });
                  })
                }
              >
                RECORD PERMISSION
              </button>
            </div>
          ) : null}

          {mission.status === "approved" && mission.permission.composerAllowed ? (
            <>
              <button type="button" className="hl-send" disabled={busy} onClick={handleSend}>
                OPEN MY TEXT APP
              </button>
              <button type="button" disabled={busy} onClick={handleConfirmSent}>
                I SENT IT
              </button>
            </>
          ) : null}

          {mission.status === "contacted" ? (
            <p className="hl-sent">
              Signal sent. The lantern stays dormant until a real order returns.
            </p>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="hl-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
