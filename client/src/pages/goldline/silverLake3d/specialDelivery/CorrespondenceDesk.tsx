import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";
import {
  TESSA_PARK_FIXTURE,
  buildSableRecall,
  composeRookDraft,
  deskStateLabel,
  formatDay,
  whyNow,
  type DeskCustomer,
  type RecallEntry,
} from "@shared/correspondenceDesk";
import styles from "./special-delivery.module.css";

/**
 * Rook's correspondence desk. Plain, readable and real: this is not part of the game.
 *
 * One customer. Sable's recall comes first (only what a record holds, dated, with its source, and what is not known);
 * Rook's draft is written from it. You can edit it, save it for later, take it to the Letter Desk (which owns consent,
 * the hand-off to your messaging app and "I sent it"), set it aside, or pass on this customer for now.
 * In the synthetic preview the desk shows a labelled fixture and nothing is written anywhere.
 */

export type UnfinishedDeskDraft = { customerId: string; draftBody: string; updatedAt: string } | null;

export function CorrespondenceDesk(props: {
  synthetic: boolean;
  territoryId: string;
  target: CozyProjectedTarget | null;
  unfinished: UnfinishedDeskDraft;
  onSaveDraft(target: CozyProjectedTarget, draft: string): Promise<void> | void;
  onOpenLetterDesk(target: CozyProjectedTarget, draft: string): void;
  onClose(): void;
  onNotNow(): void;
}) {
  const { synthetic, target } = props;
  const real = !synthetic && target ? target : null;
  const recallQuery = trpc.system.goldlineWorld.sableRecall.useQuery(
    { territoryId: props.territoryId, customerId: real?.customerId ?? "" },
    { enabled: Boolean(real), staleTime: 10_000 }
  );
  const recordPass = trpc.system.goldlineWorld.recordReunionQuestEvent.useMutation();
  const utils = trpc.useUtils();

  const customer: DeskCustomer | null = synthetic
    ? TESSA_PARK_FIXTURE.customer
    : real
      ? {
          customerId: real.customerId,
          displayName: real.displayName,
          paidOrders: real.paidOrders,
          lastOrderDate: real.lastOrderDate,
          daysSinceLastOrder: Number.isFinite(real.daysSinceLastOrder) ? real.daysSinceLastOrder : null,
          lastOrderSummary: real.lastOrderSummary,
        }
      : null;

  const entries: RecallEntry[] = useMemo(() => {
    if (synthetic) return TESSA_PARK_FIXTURE.recallEntries;
    return ((recallQuery.data as { entries?: RecallEntry[] } | undefined)?.entries ?? []) as RecallEntry[];
  }, [synthetic, recallQuery.data]);
  const recall = useMemo(() => buildSableRecall(entries), [entries]);
  const rook = useMemo(
    () => (customer ? composeRookDraft({ displayName: customer.displayName, recall, service: "laundry", fallback: real?.suggestedMessage ?? null }) : null),
    [customer, recall, real?.suggestedMessage]
  );

  const saved = props.unfinished && customer && props.unfinished.customerId === customer.customerId ? props.unfinished : null;
  const [draft, setDraft] = useState<string>("");
  const [savedNow, setSavedNow] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [previewHandoff, setPreviewHandoff] = useState(false);
  useEffect(() => {
    if (saved) setDraft(saved.draftBody);
    else if (rook) setDraft(d => d || rook.draft);
  }, [saved, rook]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const loading = Boolean(real) && recallQuery.isLoading;
  // the preview never opens anything, so it never claims a hand-off happened
  const message = synthetic ? null : (real?.silverLakeStatus?.message ?? null);
  const replyObserved = synthetic ? false : real?.silverLakeStatus?.reply === "customer_reply_observed" || recall.replyRecorded;
  const orderObserved = synthetic ? false : real?.silverLakeStatus?.order === "new_completed_order";
  const state = deskStateLabel({ saved: Boolean(saved) || savedNow, message, replyObserved, orderObserved });

  if (!customer) {
    return (
      <div className={styles.deskWrap} role="dialog" aria-label="Rook's desk">
        <section className={styles.desk}>
          <header className={styles.deskHead}>
            <div>
              <span className={styles.deskKicker}>Rook's desk · your business</span>
              <h2>Nothing needs you here today</h2>
            </div>
            <button type="button" className={styles.deskClose} onClick={props.onClose} aria-label="Back to the courtyard">
              ✕
            </button>
          </header>
          <p className={styles.deskEmpty}>
            No customer in Silver Lake is waiting on a note right now. When someone who used to order goes quiet, Rook will put them here.
          </p>
          <div className={styles.deskActions}>
            <button type="button" onClick={props.onClose}>
              Back to the courtyard
            </button>
          </div>
        </section>
      </div>
    );
  }

  const first = customer.displayName.split(" ")[0];
  return (
    <div className={styles.deskWrap} role="dialog" aria-label={`Rook's desk: ${customer.displayName}`} data-testid="correspondence-desk">
      <section className={styles.desk}>
        <header className={styles.deskHead}>
          <div>
            <span className={styles.deskKicker}>Rook's desk · your business</span>
            <h2>{customer.displayName}</h2>
            {synthetic ? (
              <span className={styles.fixtureBadge} data-testid="desk-fixture-badge">
                {TESSA_PARK_FIXTURE.label}
              </span>
            ) : (
              <span className={styles.realBadge}>A real customer of yours. Nothing here is make-believe.</span>
            )}
          </div>
          <button type="button" className={styles.deskClose} onClick={props.onClose} aria-label="Back to the courtyard">
            ✕
          </button>
        </header>

        <p className={styles.deskWhy} data-testid="desk-why">
          {whyNow(customer)}
        </p>

        <article className={styles.sable} aria-label="Sable: what's on record" data-testid="desk-sable">
          <h3>
            <span className={styles.who}>Sable</span> · previous conversation
          </h3>
          {loading ? <p className={styles.muted}>Looking it up…</p> : null}
          {!loading && recall.promise ? (
            <blockquote data-testid="desk-promise">
              <b>{formatDay(recall.promise.at)}</b> — You said: “{recall.promise.quote}”
              <cite>{recall.promise.source}</cite>
            </blockquote>
          ) : null}
          {!loading && !recall.promise ? (
            <ul className={styles.recallList}>
              {recall.entries
                .filter(e => e.kind !== "order")
                .slice(-3)
                .map((e, i) => (
                  <li key={i}>
                    <b>{formatDay(e.at)}</b> {e.text ? `“${e.text}”` : labelFor(e)} <cite>{e.source}</cite>
                  </li>
                ))}
            </ul>
          ) : null}
          {!loading ? (
            <ul className={styles.unknowns} data-testid="desk-unknowns">
              {recall.unknowns.map(u => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          ) : null}
          {recallQuery.isError ? <p className={styles.muted}>Sable couldn't read the record just now. Nothing is assumed.</p> : null}
        </article>

        <article className={styles.rook} aria-label="Rook's draft">
          <h3>
            <span className={styles.who}>Rook</span> · draft
          </h3>
          <label className={styles.srOnly} htmlFor="desk-draft">
            Message to {first}
          </label>
          <textarea
            id="desk-draft"
            value={draft}
            onChange={e => {
              setDraft(e.target.value);
              setSavedNow(false);
              setPreviewHandoff(false);
            }}
            rows={4}
            data-testid="desk-draft"
          />
          {rook ? <p className={styles.rookNote}>Rook: {rook.note}</p> : null}
        </article>

        <p className={styles.deskState} role="status" data-testid="desk-state">
          {previewHandoff
            ? "Preview only: on your phone this opens your messaging app with the message filled in. Nothing has been sent."
            : `${state}${note ? ` ${note}` : ""}`}
        </p>

        <div className={styles.deskActions}>
          <button
            type="button"
            className={styles.primary}
            disabled={!draft.trim()}
            onClick={() => {
              if (synthetic) {
                setPreviewHandoff(true);
                return;
              }
              if (real) props.onOpenLetterDesk(real, draft.trim());
            }}
            data-testid="desk-continue"
          >
            Continue to send from your phone
          </button>
          <button
            type="button"
            disabled={!draft.trim()}
            onClick={async () => {
              if (!synthetic && real) await props.onSaveDraft(real, draft.trim());
              setSavedNow(true);
              setPreviewHandoff(false);
              setNote(synthetic ? "(Preview: saved on this page only.)" : null);
            }}
            data-testid="desk-save"
          >
            Save for later
          </button>
          <button type="button" onClick={props.onNotNow} data-testid="desk-not-now">
            Not now
          </button>
          <button
            type="button"
            className={styles.quiet}
            disabled={recordPass.isPending}
            onClick={async () => {
              if (synthetic) {
                setPreviewHandoff(false);
                setNote(`(Preview: you passed on ${first}. Nothing is recorded.)`);
                return;
              }
              if (!real) return;
              try {
                await recordPass.mutateAsync({ territoryId: props.territoryId, customerId: real.customerId, templateId: "rook_desk", kind: "passed" });
                await utils.system.goldlineWorld.reunionQuestEvents.invalidate();
                props.onClose();
              } catch (err) {
                setNote(`The pass was not recorded, so nothing changed. ${err instanceof Error ? err.message : ""}`.trim());
              }
            }}
            data-testid="desk-pass"
          >
            Pass on {first} for a week
          </button>
          <button type="button" className={styles.quiet} onClick={props.onClose} data-testid="desk-back">
            Back to the courtyard
          </button>
        </div>
      </section>
    </div>
  );
}

function labelFor(e: RecallEntry) {
  switch (e.kind) {
    case "handoff_opened":
      return "You opened a message to them in your messaging app.";
    case "reported_sent":
      return "You reported sending a message.";
    case "observed_sent":
      return "A message to them was observed sent.";
    case "reply":
      return "They replied.";
    default:
      return "";
  }
}
