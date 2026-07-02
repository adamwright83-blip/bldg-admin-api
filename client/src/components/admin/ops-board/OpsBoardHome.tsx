import { useEffect, useRef, useState } from "react";
import { Loader2, PackageCheck, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  MobileBottomNav,
  MobileTopBar,
} from "./OpsBoardCards";
import { OpsBoardModals } from "./OpsBoardModals";
import { SkyBackdrop, SkyBar, useCommandSky } from "../CommandSky";
import { WarStrip } from "../CommandCockpitBand";
import { ComposerPanel } from "../ComposerPanel";
import { CommandLanternKingdom } from "../CommandLanternKingdom";
import { SaleslayBattleCanvas, type SaleslayBattleCanvasHandle } from "../saleslay-game/SaleslayBattleCanvas";
import { OperatorAnalystHome } from "../operator-analyst/OperatorAnalystHome";
import type { AdminHomeData, LogOutreachPayload, OpsBoardModal } from "./types";

type OpsBoardHomeProps = {
  data: AdminHomeData;
  experienceMode?: "kingdom" | "operator-demo";
  loading?: boolean;
  error?: boolean;
  operatorName: string;
  onOpenMobileNav: () => void;
  onNavigate: (path: string) => void;
  onOpenCustomer: (phone?: string) => void;
  onLogOutreach: (payload: LogOutreachPayload) => Promise<void>;
  outreachLogging: boolean;
};

const DESKTOP_QUERY = "(min-width: 1024px)";

/** Mirrors the CSS `min-width: 1024px` breakpoint that already governs
 * `.ops-mobile-board` / `.ops-desktop-board` visibility, but as a real JS
 * condition — so the Saleslay board + Sage composer are only ever mounted
 * ONCE in the React tree, not mounted twice and hidden with CSS. */
function useIsDesktopViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(DESKTOP_QUERY).matches : true
  );
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

export function OpsBoardHome({
  data,
  experienceMode = "kingdom",
  loading,
  error,
  operatorName,
  onOpenMobileNav,
  onNavigate,
  onOpenCustomer,
  onLogOutreach,
  outreachLogging,
}: OpsBoardHomeProps) {
  const [modal, setModal] = useState<OpsBoardModal | null>(null);
  // COMMAND SKY — the merged Board+Cockpit weather. The whole home breathes
  // with it; hope events (Log a Win) can turn it blue right now.
  const sky = useCommandSky();
  const isOperatorDemo = experienceMode === "operator-demo";
  const isDesktop = useIsDesktopViewport();

  // SAGE summon — Ask Sage on the Saleslay board asks us to reveal the
  // ALREADY-mounted ComposerPanel instance in a compact anchored surface;
  // it never mounts a second composer or fakes one inside the game layer.
  // The panel stays mounted (never unmounted) when closed, only hidden via
  // CSS, so typed prompts / responses / tRPC state all survive a close.
  const [sageOpen, setSageOpen] = useState(false);
  useEffect(() => {
    if (!sageOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSageOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sageOpen]);
  useEffect(() => {
    if (!sageOpen) return;
    // Focus the composer's input each time the summon surface opens — the
    // panel itself never unmounts, so React's own autoFocus only fires once.
    const raf = window.requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(".ops-sage-summon-frame input")?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [sageOpen]);

  // Fulfill the Promise (real pickup completion) — the game never queries
  // or mutates orders itself. Pressing the weapon only requests this
  // picker; the actual admin.updateStatus mutation and its confirmed
  // success/failure are reported back into the engine through the
  // imperative canvas handle, never by guessing at animation timing.
  const canvasRef = useRef<SaleslayBattleCanvasHandle | null>(null);
  const [pickupPickerOpen, setPickupPickerOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  // Belt-and-suspenders against double-completion: the query cache may not
  // have re-fetched yet if the picker is closed and reopened quickly, so a
  // just-completed order is excluded from the visible list from THIS
  // session's memory too, not only once the server round-trips a refetch.
  const [recentlyCompletedOrderIds, setRecentlyCompletedOrderIds] = useState<Set<number>>(new Set());
  const utils = trpc.useUtils();
  const eligibleOrders = trpc.admin.listPickupEligibleOrders.useQuery(undefined, {
    enabled: pickupPickerOpen,
  });
  const visibleEligibleOrders = (eligibleOrders.data ?? []).filter(
    (order) => !recentlyCompletedOrderIds.has(order.id)
  );
  const completePickup = trpc.admin.updateStatus.useMutation({
    onSuccess: (data, variables) => {
      // The server's atomic guard already prevented a duplicate SMS/war
      // event, but if THIS request lost the race (someone else's request
      // completed the same order a moment earlier), the real-world event
      // already happened via THAT request — awarding a second reward here
      // would double-credit one real action. Treat it as "nothing new to
      // reward," not a failure.
      if (data.alreadyCompleted) {
        canvasRef.current?.failWeaponAction("pickup", "That order was already marked as picked up.");
      } else {
        canvasRef.current?.completeWeaponAction("pickup");
      }
      setRecentlyCompletedOrderIds((prev) => new Set(prev).add(variables.orderId));
      setPickupPickerOpen(false);
      setSelectedOrderId(null);
      void utils.admin.listPickupEligibleOrders.invalidate();
    },
    onError: (err) => {
      canvasRef.current?.failWeaponAction("pickup", err.message);
      // Picker stays open so the operator can retry or pick another order —
      // no automatic retry, no reward, no order mutation on failure.
    },
  });
  useEffect(() => {
    if (!pickupPickerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !completePickup.isPending) {
        setPickupPickerOpen(false);
        setSelectedOrderId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupPickerOpen, completePickup.isPending]);

  const handleConfirmPickup = () => {
    // Disabled state below already blocks a second click while pending —
    // this guard is a second, cheap line of defense against double-submit.
    if (selectedOrderId == null || completePickup.isPending) return;
    completePickup.mutate({ orderId: selectedOrderId, status: "collected" });
  };

  if (loading) {
    return (
      <div className="ops-board-home ops-board-loading">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // The Saleslay battle canvas + its SAGE summon composer render as ONE
  // unit, mounted exactly once (gated by isDesktop below) — never once per
  // responsive branch. The wrapping stage gives the summon panel a
  // positioned ancestor so it can anchor near SAGE instead of the viewport.
  const saleslayStage = (
    <div className="ops-saleslay-stage">
      <section className="ops-saleslay-preview" aria-label="Saleslay Battle Preview">
        <SaleslayBattleCanvas
          ref={canvasRef}
          sageOpen={sageOpen}
          onAskSage={() => setSageOpen(true)}
          pickupPickerOpen={pickupPickerOpen}
          onOpenPickupPicker={() => setPickupPickerOpen(true)}
        />
      </section>

      {/* Fulfill the Promise — compact eligible-order picker + explicit
          confirmation. Never fires on the initial click/key; the real
          admin.updateStatus mutation only runs once the operator picks an
          order and presses Confirm here. */}
      <div className={`ops-pickup-picker ${pickupPickerOpen ? "is-open" : ""}`}>
        <div className="ops-pickup-picker-frame">
          <button
            type="button"
            className="ops-pickup-picker-close"
            aria-label="Cancel pickup"
            disabled={completePickup.isPending}
            onClick={() => {
              setPickupPickerOpen(false);
              setSelectedOrderId(null);
            }}
          >
            <X size={14} />
          </button>
          <div className="ops-pickup-picker-head">
            <PackageCheck size={16} aria-hidden="true" />
            <span>Fulfill the Promise — complete a pickup</span>
          </div>
          {eligibleOrders.isLoading ? (
            <p className="ops-pickup-picker-status">Loading orders awaiting pickup…</p>
          ) : visibleEligibleOrders.length > 0 ? (
            <ul className="ops-pickup-picker-list">
              {visibleEligibleOrders.map((order) => (
                <li key={order.id}>
                  <button
                    type="button"
                    className={`ops-pickup-picker-row ${selectedOrderId === order.id ? "is-selected" : ""}`}
                    disabled={completePickup.isPending}
                    onClick={() => setSelectedOrderId(order.id)}
                  >
                    <span className="ops-pickup-picker-name">
                      {order.firstName} {order.lastName}
                    </span>
                    <span className="ops-pickup-picker-meta">{order.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ops-pickup-picker-status">No orders are awaiting pickup right now.</p>
          )}
          {completePickup.error ? (
            <p className="ops-pickup-picker-error">Couldn't complete that pickup: {completePickup.error.message}</p>
          ) : null}
          <button
            type="button"
            className="ops-pickup-picker-confirm"
            disabled={selectedOrderId == null || completePickup.isPending}
            onClick={handleConfirmPickup}
          >
            {completePickup.isPending ? "Completing…" : "Confirm pickup"}
          </button>
        </div>
      </div>

      <div className={`ops-sage-summon ${sageOpen ? "is-open" : ""}`}>
        <div className="ops-sage-summon-frame">
          {sageOpen ? (
            <button
              type="button"
              className="ops-sage-summon-close"
              aria-label="Close Sage"
              onClick={() => setSageOpen(false)}
            >
              <X size={14} />
            </button>
          ) : null}
          <ComposerPanel
            allowDemoMode={false}
            className="ops-kingdom-composer"
            onNavigate={onNavigate}
            variant="sage-summon"
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className={`ops-board-home ${isOperatorDemo ? "ops-operator-demo-home" : "ops-kingdom-home"}`}>
      {error ? (
        <div className="ops-data-warning">
          Live dashboard metrics could not fully load. The board is using safe fallbacks where data is missing.
        </div>
      ) : null}

      {!isOperatorDemo ? <SkyBackdrop tone={sky.data?.tone} /> : null}

      {/* THE SPINE — what greets the operator, in order: weather → money
          heartbeat + Mission Control + the math → the war. Everything legacy
          lives BELOW the spine; the merged content leads, never trails. */}
      <div className="ops-mobile-board">
        <MobileTopBar operatorName={operatorName} onOpenMobileNav={onOpenMobileNav} />
        {isOperatorDemo ? (
          <OperatorAnalystHome onNavigate={onNavigate} />
        ) : (
          <>
            <CommandLanternKingdom onNavigate={onNavigate} />
            <SkyBar />
            <WarStrip onNavigate={onNavigate} />
            {!isDesktop ? saleslayStage : null}
          </>
        )}
        <MobileBottomNav onNavigate={onNavigate} />
      </div>

      <div className="ops-desktop-board">
        {isOperatorDemo ? (
          <OperatorAnalystHome onNavigate={onNavigate} />
        ) : (
          <>
            <CommandLanternKingdom onNavigate={onNavigate} />
            <SkyBar />
            <WarStrip onNavigate={onNavigate} />
            {isDesktop ? saleslayStage : null}
          </>
        )}
      </div>

      <OpsBoardModals
        data={data}
        modal={modal}
        onOpenChange={setModal}
        onNavigate={onNavigate}
        onOpenCustomer={onOpenCustomer}
        onLogOutreach={onLogOutreach}
        outreachLogging={outreachLogging}
      />
    </div>
  );
}
