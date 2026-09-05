/**
 * THE 1V1 HUD.
 *
 * Lantern City is a rivalry between two buildings, and until now the screen
 * never said so: the towers stood in a map with a caption. This is the band
 * across the top that establishes the match — gold on the left, violet on the
 * right, the versus mark between them.
 *
 * WHY IT LOOKS EMPTY WHEN IT IS EMPTY
 *
 * The locked reference has level badges, currencies, XP, win counts and health
 * bars. Goldline has none of those, and a HUD is the single most tempting place
 * to invent them — the composition has holes exactly where a game would put a
 * number, and any plausible-looking digit fills the hole.
 *
 * So every value rendered here is read straight from `towerWars.today`, which is
 * compiled from collected orders, and there is no fallback that produces a
 * number. When Tower Wars cannot answer — no database, no compiled ledger, a
 * failed query — the HUD says the truth is not in yet and renders no figures at
 * all. An emptier HUD is the correct HUD.
 *
 * WHAT THE TWO INDICATORS ACTUALLY MEAN
 *
 *   BAR  — this building's share of the two buildings' real revenue in the
 *          current Tower Wars window. It is the contest itself, not "health":
 *          revenue is what fires the weapons, so the split IS the match score.
 *          With no revenue on either side there is no split and no bar.
 *
 *   PIPS — strikes this building has ABSORBED today, one pip per real strike
 *          (`incomingAttackCount`), which is the same integer the authoritative
 *          damage state is derived from. Capped in display only; the written
 *          count beside it is never capped.
 *
 * Reading only. Nothing in this component can write a promise, an attack or an
 * order, and it deliberately holds no mutation hook at all.
 */
import { trpc } from "@/lib/trpc";
import { COMBAT_TOWER_ART } from "./lanternCityCombat";
import type { CanonicalBuildingId } from "./buildingArt";
import { BUILDING_ART } from "./buildingArt";

/** How many strike pips are drawn before the written count carries the rest. */
const MAX_PIPS = 5;

type Side = {
  buildingId: CanonicalBuildingId;
  revenueCents: number | null;
  orderCount: number | null;
  incomingAttackCount: number | null;
  damage: string | null;
};

function money(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/**
 * Each side's share of the pair's revenue, or null when there is nothing to
 * share. Null is rendered as an unfilled bar rather than as 50/50, because a
 * half-full bar on both sides asserts a dead heat that no evidence supports.
 */
function revenueShare(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null;
  const total = left + right;
  if (total <= 0) return null;
  return left / total;
}

function SideBanner({
  side,
  share,
  align,
}: {
  side: Side;
  share: number | null;
  align: "left" | "right";
}) {
  const art = COMBAT_TOWER_ART[side.buildingId];
  const strikes = side.incomingAttackCount;
  return (
    <div className={`lc-hud-side faction-${art.faction} align-${align}`}>
      <div className="lc-hud-crest" aria-hidden />
      <div className="lc-hud-side-body">
        <strong>{BUILDING_ART[side.buildingId].displayName}</strong>
        <small>{art.faction === "gold" ? "Gold faction" : "Violet faction"}</small>
        <div
          className="lc-hud-bar"
          role="img"
          aria-label={
            share === null
              ? "Revenue share unavailable"
              : `${Math.round(share * 100)} percent of today's revenue between the two towers`
          }
        >
          <i style={share === null ? undefined : { width: `${share * 100}%` }} />
        </div>
        <div className="lc-hud-readout">
          {side.revenueCents === null ? (
            <span className="is-unknown">Revenue truth pending</span>
          ) : (
            <span>
              {money(side.revenueCents)}
              {side.orderCount === null ? null : (
                <em>
                  {" "}
                  · {side.orderCount} order{side.orderCount === 1 ? "" : "s"}
                </em>
              )}
            </span>
          )}
        </div>
        {strikes === null ? null : (
          <div
            className="lc-hud-pips"
            role="img"
            aria-label={`${strikes} strike${strikes === 1 ? "" : "s"} absorbed today${
              side.damage ? `, ${side.damage.replace("-", " ")}` : ""
            }`}
          >
            {Array.from({ length: MAX_PIPS }).map((_, index) => (
              <i key={index} data-struck={index < strikes ? "true" : undefined} />
            ))}
            <b>{strikes}</b>
          </div>
        )}
      </div>
    </div>
  );
}

export function RivalryHud() {
  const today = trpc.system.towerWars.today.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  /*
    `evidenceSufficient` is the server saying whether it could reach the
    evidence at all. Without it the compiled state is a shape, not an answer,
    and every figure below stays null.
  */
  const usable = today.data?.evidenceSufficient === true ? today.data : null;
  const stateFor = (buildingId: CanonicalBuildingId): Side =>
    usable
      ? {
          buildingId,
          revenueCents: usable.state.buildings[buildingId].revenueCents,
          orderCount: usable.state.buildings[buildingId].orderCount,
          incomingAttackCount:
            usable.state.buildings[buildingId].incomingAttackCount,
          damage: usable.state.buildings[buildingId].damage,
        }
      : {
          buildingId,
          revenueCents: null,
          orderCount: null,
          incomingAttackCount: null,
          damage: null,
        };

  const cpe = stateFor("century_park_east");
  const opus = stateFor("opus_la");
  const cpeShare = revenueShare(cpe.revenueCents, opus.revenueCents);
  const opusShare = cpeShare === null ? null : 1 - cpeShare;

  return (
    <div className="lc-rivalry-hud" aria-label="Tower Wars rivalry">
      <SideBanner side={cpe} share={cpeShare} align="left" />
      <div className="lc-hud-versus">
        <span className="lc-hud-versus-mark">1V1</span>
        <small>
          {usable
            ? "Today's real revenue decides"
            : today.isLoading
              ? "Reading revenue truth…"
              : "Awaiting revenue truth"}
        </small>
      </div>
      <SideBanner side={opus} share={opusShare} align="right" />
    </div>
  );
}
