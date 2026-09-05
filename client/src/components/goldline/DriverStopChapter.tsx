import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  ChevronRight,
  Flame,
  MapPin,
  PackageCheck,
  PackageOpen,
  X,
} from "lucide-react";
import type { DayPlanStop } from "@/pages/driver/goldlineDayPlanModel";
import "./driver-chapter.css";

export function DriverStopChapter({
  stop,
  onClose,
  onResolve,
  onEnter,
  onJournal,
  onPlay,
}: {
  stop: DayPlanStop;
  onClose: () => void;
  onResolve?: (stop: DayPlanStop) => Promise<boolean>;
  onEnter: () => void;
  onJournal: () => void;
  onPlay: () => void;
}) {
  const [returnFocus] = useState(
    () => document.activeElement as HTMLElement | null
  );
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const complete = saved || stop.status === "completed";
  const action = stop.action;
  const canResolve = Boolean(
    action &&
      action.type !== "commercial" &&
      onResolve &&
      stop.status !== "blocked" &&
      stop.status !== "cancelled"
  );
  const paymentBlocked = action?.type === "order" && !action.eligible;
  const isPickup = stop.kind === "pickup";
  const operational = isPickup || stop.kind === "dropoff";
  const label = operational
    ? isPickup
      ? "CONFIRM PICKUP"
      : "CONFIRM DELIVERY"
    : "COMPLETE TASK";
  const statement = operational
    ? isPickup
      ? "I have physically collected this customer's order."
      : "I have physically handed this order to the customer or their approved location."
    : "I have completed this task in the real world.";
  const cityUrl = `https://admin.bldg.chat/growth/lantern-city${stop.physicalEntityId ? `?entity=${encodeURIComponent(stop.physicalEntityId)}` : ""}`;
  async function resolve() {
    if (!confirmed || pending.current || !canResolve || paymentBlocked) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (await onResolve?.(stop)) setSaved(true);
      else
        setError(
          "That outcome was not saved. Your stop is still open; try again when ready."
        );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save. Your stop is still open."
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="chapter-shade" />
        <Dialog.Content
          className={`stop-chapter ${saved ? "stop-chapter--sealed" : ""}`}
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (returnFocus?.isConnected) returnFocus.focus();
            else
              document
                .querySelector<HTMLButtonElement>(".gdp-next-up button")
                ?.focus();
          }}
          onEscapeKeyDown={event => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={event => {
            if (busy) event.preventDefault();
          }}
        >
          <header>
            <span className="chapter-eyebrow">
              {complete ? "CHAPTER SEALED" : "YOUR NEXT CHAPTER"}
            </span>
            <Dialog.Close disabled={busy} aria-label="Close stop">
              <X />
            </Dialog.Close>
          </header>
          <div className="chapter-emblem">
            {complete ? (
              <Check />
            ) : isPickup ? (
              <PackageOpen />
            ) : (
              <PackageCheck />
            )}
          </div>
          <Dialog.Title>
            {saved ? "One promise kept." : stop.title}
          </Dialog.Title>
          <Dialog.Description>
            {saved
              ? `${stop.title} · outcome saved`
              : `${stop.kind === "dropoff" ? "DELIVERY" : stop.kind.toUpperCase()} · ${stop.timeLabel}`}
          </Dialog.Description>
          {complete ? (
            <>
              <div className="chapter-receipt">
                <Check size={18} />
                <div>
                  <strong>
                    {operational
                      ? isPickup
                        ? "Pickup recorded"
                        : "Delivery recorded"
                      : "Task recorded"}
                  </strong>
                  <p>
                    {stop.source === "cleancloud"
                      ? "Your imported route reflects this outcome. External billing stays with its source system."
                      : "This outcome is saved to the shared business record. Your day can move forward."}
                  </p>
                </div>
              </div>
              <a
                className="chapter-city"
                href={cityUrl}
                target="_blank"
                rel="noreferrer"
              >
                <span>
                  <strong>FOLLOW THE CONSEQUENCE</strong>
                  <small>
                    Open {stop.physicalEntityId ? "this place in" : ""} Lantern
                    City
                  </small>
                </span>
                <ChevronRight />
              </a>
              <div className="chapter-actions">
                <button className="chapter-primary" onClick={onClose}>
                  NEXT CHAPTER <ChevronRight size={18} />
                </button>
                <button onClick={onPlay}>
                  <Flame size={17} /> PLAY LANTERN RUN
                </button>
              </div>
            </>
          ) : (
            <>
              {stop.address ? (
                <div className="chapter-address">
                  <MapPin />
                  <span>{stop.address}</span>
                </div>
              ) : (
                <p className="chapter-muted">
                  {operational
                    ? "No address is recorded. Check the order in field operations before setting out."
                    : "A flexible chapter in your day."}
                </p>
              )}
              {stop.navigationUrl && (
                <a
                  className="chapter-primary"
                  href={stop.navigationUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin size={18} /> OPEN DIRECTIONS
                </a>
              )}
              {stop.whySurfaced && (
                <p className="chapter-muted">{stop.whySurfaced}</p>
              )}
              {canResolve ? (
                <>
                  <label className="chapter-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={event => setConfirmed(event.target.checked)}
                      disabled={busy || paymentBlocked}
                    />
                    <span>{statement}</span>
                  </label>
                  {paymentBlocked && (
                    <p role="status" className="chapter-error">
                      Payment needs to be resolved before this delivery can be
                      completed.
                    </p>
                  )}
                  <button
                    className="chapter-primary"
                    disabled={!confirmed || busy || paymentBlocked}
                    onClick={resolve}
                  >
                    {busy ? "SAVING OUTCOME…" : label}
                    <Check size={18} />
                  </button>
                </>
              ) : (
                <button className="chapter-primary" onClick={onEnter}>
                  OPEN{" "}
                  {action?.type === "commercial"
                    ? "SALES MISSION"
                    : "FIELD OPERATIONS"}
                  <ChevronRight size={18} />
                </button>
              )}
              {error && (
                <p className="chapter-error" role="alert">
                  {error}
                </p>
              )}
              <button className="chapter-secondary" onClick={onJournal}>
                RECORD AN OBSERVATION
              </button>
            </>
          )}
          <small className="chapter-footnote">
            {stop.sourceLabel} · {stop.timeLabel}
          </small>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
