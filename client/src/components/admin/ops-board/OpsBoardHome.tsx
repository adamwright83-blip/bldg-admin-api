import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import {
  MobileBottomNav,
  MobileTopBar,
} from "./OpsBoardCards";
import { OpsBoardModals } from "./OpsBoardModals";
import { SkyBackdrop, SkyBar, useCommandSky } from "../CommandSky";
import { WarStrip } from "../CommandCockpitBand";
import { ComposerPanel } from "../ComposerPanel";
import { CommandLanternKingdom } from "../CommandLanternKingdom";
import { SaleslayBattleCanvas } from "../saleslay-game/SaleslayBattleCanvas";
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

  // SAGE summon — Ask Sage on the Saleslay board asks us to reposition the
  // ALREADY-mounted ComposerPanel into an overlay; it never mounts a second
  // composer or fakes one inside the game layer.
  const [sageOpen, setSageOpen] = useState(false);
  useEffect(() => {
    if (!sageOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSageOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sageOpen]);

  if (loading) {
    return (
      <div className="ops-board-home ops-board-loading">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

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
            <section className="ops-saleslay-preview" aria-label="Saleslay Battle Preview">
              <SaleslayBattleCanvas sageOpen={sageOpen} onAskSage={() => setSageOpen(true)} />
            </section>
            <div className={`ops-sage-summon ${sageOpen ? "is-open" : ""}`}>
              {sageOpen ? (
                <div className="ops-sage-summon-backdrop" onClick={() => setSageOpen(false)} />
              ) : null}
              <div className="ops-sage-summon-frame">
                {sageOpen ? (
                  <button
                    type="button"
                    className="ops-sage-summon-close"
                    aria-label="Close Sage"
                    onClick={() => setSageOpen(false)}
                  >
                    <X size={16} />
                  </button>
                ) : null}
                <ComposerPanel
                  allowDemoMode={false}
                  className="ops-kingdom-composer"
                  onNavigate={onNavigate}
                  variant="kingdom-sage"
                />
              </div>
            </div>
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
            <section className="ops-saleslay-preview" aria-label="Saleslay Battle Preview">
              <SaleslayBattleCanvas sageOpen={sageOpen} onAskSage={() => setSageOpen(true)} />
            </section>
            <div className="ops-kingdom-command-row">
              <div className={`ops-sage-summon ${sageOpen ? "is-open" : ""}`}>
                {sageOpen ? (
                  <div className="ops-sage-summon-backdrop" onClick={() => setSageOpen(false)} />
                ) : null}
                <div className="ops-sage-summon-frame">
                  {sageOpen ? (
                    <button
                      type="button"
                      className="ops-sage-summon-close"
                      aria-label="Close Sage"
                      onClick={() => setSageOpen(false)}
                    >
                      <X size={16} />
                    </button>
                  ) : null}
                  <ComposerPanel
                    allowDemoMode={false}
                    className="ops-kingdom-composer"
                    onNavigate={onNavigate}
                    variant="kingdom-sage"
                  />
                </div>
              </div>
            </div>
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
