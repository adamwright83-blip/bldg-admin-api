import { useEffect, useRef, useState } from "react";
import { Loader2, Phone, X } from "lucide-react";
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

  // Bold Pitch (real outbound call) — the game never queries leads or
  // places calls itself. Pressing the weapon only requests this picker; the
  // actual admin.startBoldPitchCall mutation starts the bridge-through-
  // cellphone call, and the reward only lands once polling confirms the
  // customer leg connected >=20s (via admin.getBoldPitchCallAttempt),
  // reported back into the engine through the imperative canvas handle.
  const canvasRef = useRef<SaleslayBattleCanvasHandle | null>(null);
  const [callPickerOpen, setCallPickerOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [activeAttemptId, setActiveAttemptId] = useState<number | null>(null);
  const leads = trpc.admin.listLeads.useQuery(undefined, { enabled: callPickerOpen });
  const startCall = trpc.admin.startBoldPitchCall.useMutation({
    onSuccess: (data) => {
      setActiveAttemptId(data.attemptId);
    },
    onError: (err) => {
      canvasRef.current?.failWeaponAction("call", err.message);
    },
  });
  // Poll the attempt until Twilio's status callbacks resolve it to a
  // terminal state — the mutation above only starts the call, it can't
  // know the outcome synchronously.
  const attempt = trpc.admin.getBoldPitchCallAttempt.useQuery(
    { attemptId: activeAttemptId ?? -1 },
    { enabled: activeAttemptId != null, refetchInterval: 2500 }
  );
  useEffect(() => {
    if (!attempt.data) return;
    const status = attempt.data.status;
    if (status === "completed_success") {
      canvasRef.current?.completeWeaponAction("call");
      setActiveAttemptId(null);
      setCallPickerOpen(false);
      setSelectedLeadId(null);
    } else if (status === "completed_no_connect" || status === "failed") {
      canvasRef.current?.failWeaponAction(
        "call",
        attempt.data.failureReason ?? "The call didn't connect long enough."
      );
      setActiveAttemptId(null);
    }
  }, [attempt.data]);
  useEffect(() => {
    if (!callPickerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !startCall.isPending && activeAttemptId == null) {
        setCallPickerOpen(false);
        setSelectedLeadId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callPickerOpen, startCall.isPending, activeAttemptId]);

  const handleStartCall = () => {
    if (selectedLeadId == null || startCall.isPending || activeAttemptId != null) return;
    startCall.mutate({ leadId: selectedLeadId });
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
          callPickerOpen={callPickerOpen}
          onOpenCallPicker={() => setCallPickerOpen(true)}
        />
      </section>

      {/* Bold Pitch — compact lead picker + explicit confirmation. Never
          dials on the initial click/key; the real startBoldPitchCall
          mutation only runs once the operator picks a lead and presses
          Call here, and the reward only lands once polling confirms the
          customer leg connected. */}
      <div className={`ops-pickup-picker ${callPickerOpen ? "is-open" : ""}`}>
        <div className="ops-pickup-picker-frame">
          <button
            type="button"
            className="ops-pickup-picker-close"
            aria-label="Cancel call"
            disabled={startCall.isPending || activeAttemptId != null}
            onClick={() => {
              setCallPickerOpen(false);
              setSelectedLeadId(null);
            }}
          >
            <X size={14} />
          </button>
          <div className="ops-pickup-picker-head">
            <Phone size={16} aria-hidden="true" />
            <span>Bold Pitch — place a sales call</span>
          </div>
          {leads.isLoading ? (
            <p className="ops-pickup-picker-status">Loading leads…</p>
          ) : (leads.data ?? []).length > 0 ? (
            <ul className="ops-pickup-picker-list">
              {(leads.data ?? []).map((lead) => (
                <li key={lead.id}>
                  <button
                    type="button"
                    className={`ops-pickup-picker-row ${selectedLeadId === lead.id ? "is-selected" : ""}`}
                    disabled={startCall.isPending || activeAttemptId != null || !lead.phone}
                    onClick={() => setSelectedLeadId(lead.id)}
                  >
                    <span className="ops-pickup-picker-name">{lead.name}</span>
                    <span className="ops-pickup-picker-meta">{lead.phone ?? "no phone on file"}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ops-pickup-picker-status">No leads available to call right now.</p>
          )}
          {startCall.error ? (
            <p className="ops-pickup-picker-error">Couldn't start that call: {startCall.error.message}</p>
          ) : null}
          {activeAttemptId != null ? (
            <p className="ops-pickup-picker-status">Calling… waiting to see if the customer connects.</p>
          ) : null}
          <button
            type="button"
            className="ops-pickup-picker-confirm"
            disabled={selectedLeadId == null || startCall.isPending || activeAttemptId != null}
            onClick={handleStartCall}
          >
            {startCall.isPending || activeAttemptId != null ? "Calling…" : "Call"}
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
