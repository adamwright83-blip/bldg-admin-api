import { LANTERN_CITY_V5_ASSETS } from "@/components/goldline/lanternCityV5Assets";

const TOOLS = [
  {
    id: "signal",
    label: "Signal flare",
    hint: "Personal message",
    src: LANTERN_CITY_V5_ASSETS.arsenal.signalFlare,
  },
  {
    id: "bell",
    label: "Recall bell",
    hint: "Call",
    src: LANTERN_CITY_V5_ASSETS.arsenal.recallBell,
  },
  {
    id: "courier",
    label: "Courier sprite",
    hint: "Postcard / direct mail",
    src: LANTERN_CITY_V5_ASSETS.arsenal.courierSprite,
  },
  {
    id: "seal",
    label: "Golden seal",
    hint: "Real offer / discount",
    src: LANTERN_CITY_V5_ASSETS.arsenal.goldenSeal,
  },
  {
    id: "cooldown",
    label: "Cooldown rune",
    hint: "Do not contact again yet",
    src: LANTERN_CITY_V5_ASSETS.arsenal.cooldownRune,
  },
] as const;

export type RekindlingToolId = (typeof TOOLS)[number]["id"];

export function RekindlingArsenal({
  customerLabel,
  onSelectTool,
  onClose,
  onInspect,
}: {
  customerLabel: string;
  onSelectTool: (tool: RekindlingToolId) => void;
  onClose: () => void;
  onInspect?: () => void;
}) {
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
        <button type="button" className="lc-v5-rekindling-close" onClick={onClose} aria-label="Close Rekindling arsenal">
          ×
        </button>
        <img
          className="lc-v5-rekindling-wheel"
          src={LANTERN_CITY_V5_ASSETS.arsenal.wheelFrame}
          alt=""
          aria-hidden
        />
        <div className="lc-v5-rekindling-copy">
          <p>Rekindling</p>
          <h2 id="lc-rekindling-title">{customerLabel}</h2>
          <small>Choose a tool. Effort is not outcome — only real evidence restores the light.</small>
        </div>
        <div className="lc-v5-rekindling-tools">
          {TOOLS.map(tool => (
            <button
              key={tool.id}
              type="button"
              className="lc-v5-rekindling-tool"
              onClick={() => onSelectTool(tool.id)}
              aria-label={`${tool.label}: ${tool.hint}`}
            >
              <img src={tool.src} alt="" />
              <strong>{tool.label}</strong>
              <span>{tool.hint}</span>
            </button>
          ))}
        </div>
        {onInspect ? (
          <button type="button" className="lc-v5-rekindling-inspect" onClick={onInspect}>
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
      <p>Select a cooling or quiet lantern on the map to choose a recovery tool.</p>
      <button type="button" onClick={onClose}>
        Return to map
      </button>
    </div>
  );
}
