import { trpc } from "@/lib/trpc";
import { LANTERN_CITY_V5_ASSETS } from "@/components/goldline/lanternCityV5Assets";
import {
  ARSENAL_TOOLS,
  cooldownVerdict,
  goldenSealCost,
  rekindlingStateFor,
  sentLine,
  type ArsenalToolId,
} from "@shared/rekindlingArsenal";

const TOOL_ART: Record<ArsenalToolId, string> = {
  signal_flare: LANTERN_CITY_V5_ASSETS.arsenal.signalFlare,
  recall_bell: LANTERN_CITY_V5_ASSETS.arsenal.recallBell,
  courier_sprite: LANTERN_CITY_V5_ASSETS.arsenal.courierSprite,
  golden_seal: LANTERN_CITY_V5_ASSETS.arsenal.goldenSeal,
};
/** Legacy V5 callback vocabulary retained for its existing caller. */
export type RekindlingToolId =
  | ArsenalToolId
  | "signal"
  | "bell"
  | "courier"
  | "seal";

/** Only Signal Flare has a legitimate path today: the existing reviewed Churn Radar outreach flow. */
export function RekindlingArsenal({
  customerLabel,
  customerIdentityKey = null,
  businessDate = new Date().toISOString().slice(0, 10),
  goldenSealDiscountPercent = null,
  typicalOrderCents = null,
  onSelectTool,
  onClose,
  onInspect,
}: {
  customerLabel: string;
  customerIdentityKey?: string | null;
  businessDate?: string;
  goldenSealDiscountPercent?: number | null;
  typicalOrderCents?: number | null;
  onSelectTool: (tool: ArsenalToolId) => void;
  onClose: () => void;
  onInspect?: () => void;
}) {
  const interventions = trpc.system.churnRadar.interventions.useQuery();
  const intervention = interventions.data?.find(
    item => item.customer.customerKey === customerIdentityKey
  );
  const reached =
    intervention?.status === "recovered"
      ? "customer_outcome"
      : intervention?.status === "contacted"
        ? "field_activity"
        : null;
  const state = rekindlingStateFor(reached);

  return (
    <div
      className="lc-v5-rekindling-scrim"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="lc-v5-rekindling"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lc-rekindling-title"
      >
        <button
          type="button"
          className="lc-v5-rekindling-close"
          onClick={onClose}
          aria-label="Close Rekindling arsenal"
        >
          ×
        </button>
        <img
          className="lc-v5-rekindling-wheel"
          src={LANTERN_CITY_V5_ASSETS.arsenal.wheelFrame}
          alt=""
          aria-hidden
        />
        <div className="lc-v5-rekindling-copy">
          <p>Rekindling Arsenal</p>
          <h2 id="lc-rekindling-title">{customerLabel}</h2>
          <small>
            Current light: {state}. A response is required for ember; a real
            order is required for flame.
          </small>
        </div>
        <div className="lc-v5-rekindling-tools">
          {(Object.keys(ARSENAL_TOOLS) as ArsenalToolId[]).map(id => {
            const tool = ARSENAL_TOOLS[id];
            const connected =
              id === "signal_flare" && customerIdentityKey !== null;
            const lastUsed =
              connected &&
              (intervention?.status === "contacted" ||
                intervention?.status === "recovered")
                ? (intervention.contactedAt?.slice(0, 10) ?? null)
                : null;
            const cooldown = cooldownVerdict({
              tool: id,
              lastUsedBusinessDate: lastUsed,
              todayBusinessDate: businessDate,
            });
            const enabled = connected && cooldown.allowed;
            const cost =
              id === "golden_seal" && goldenSealDiscountPercent != null
                ? goldenSealCost({
                    discountPercent: goldenSealDiscountPercent,
                    typicalOrderCents,
                  }).label
                : null;
            return (
              <button
                key={id}
                type="button"
                className="lc-v5-rekindling-tool"
                disabled={!enabled}
                onClick={() => onSelectTool(id)}
                aria-label={`${tool.fictionName}: ${tool.realAction}`}
              >
                <img src={TOOL_ART[id]} alt="" />
                <strong>{tool.fictionName}</strong>
                <span>
                  {tool.truthClass.replaceAll("_", " ")} · {tool.realAction}
                </span>
                <span>
                  {!connected
                    ? "Action path not yet connected."
                    : cooldown.allowed
                      ? "Open reviewed outreach path"
                      : `Cooldown: ${cooldown.daysRemaining} day${cooldown.daysRemaining === 1 ? "" : "s"}`}
                </span>
                {cost ? <span>Cost: {cost}</span> : null}
                {connected && state !== "dark" ? (
                  <span>{sentLine(id)}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        {onInspect ? (
          <button
            type="button"
            className="lc-v5-rekindling-inspect"
            onClick={onInspect}
          >
            View relationship details
          </button>
        ) : null}
      </section>
    </div>
  );
}

export function RekindlingEmptyState({ onClose }: { onClose: () => void }) {
  return (
    <div className="lc-v5-game-room-body">
      <h2>Rekindling Arsenal</h2>
      <p>
        Select a cooling or quiet lantern on the map to choose a recovery tool.
      </p>
      <button type="button" onClick={onClose}>
        Return to map
      </button>
    </div>
  );
}
