import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  HeroCard,
  KpiGrid,
  MissionStack,
  MobileBottomNav,
  MobileTopBar,
  PerformanceGauges,
  QuickActions,
  RevenueAtRisk,
  RunRateCard,
  StatusStrip,
  TerritoryProgression,
} from "./OpsBoardCards";
import { OpsBoardModals } from "./OpsBoardModals";
import { EmergencyTaskComposer } from "./EmergencyTaskComposer";
import { SkyBackdrop, SkyBar, useCommandSky } from "../CommandSky";
import { ReflectionDigest, WarStrip } from "../CommandCockpitBand";
import { CommandLanternKingdom } from "../CommandLanternKingdom";
import type { AdminHomeData, LogOutreachPayload, OpsBoardModal } from "./types";

type OpsBoardHomeProps = {
  data: AdminHomeData;
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

  const openCollectionPriority = () => {
    const rawOrderId =
      data.collectionPriority.orderId ??
      Number(data.collectionPriority.orderNumber.replace(/[^0-9]/g, ""));
    const orderId = Number.isInteger(rawOrderId) && rawOrderId > 0 ? rawOrderId : null;

    if (orderId) {
      onNavigate(`/intake?orderId=${orderId}`);
      return;
    }

    if (data.collectionPriority.phone) {
      onOpenCustomer(data.collectionPriority.phone);
      return;
    }

    setModal({ kind: "collect_daniel" });
  };

  const openQuickReceiptInput = () => {
    onNavigate("/intake?quickReceipt=1");
  };

  if (loading) {
    return (
      <div className="ops-board-home ops-board-loading">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="ops-board-home">
      {error ? (
        <div className="ops-data-warning">
          Live dashboard metrics could not fully load. The board is using safe fallbacks where data is missing.
        </div>
      ) : null}

      <SkyBackdrop tone={sky.data?.tone} />

      {/* THE SPINE — what greets the operator, in order: weather → money
          heartbeat + Mission Control + the math → the war. Everything legacy
          lives BELOW the spine; the merged content leads, never trails. */}
      <div className="ops-mobile-board">
        <MobileTopBar operatorName={operatorName} onOpenMobileNav={onOpenMobileNav} />
        <CommandLanternKingdom onNavigate={onNavigate} />
        <SkyBar />
        <WarStrip onNavigate={onNavigate} />
        <StatusStrip data={data} includeRunRate={false} />
        <EmergencyTaskComposer />
        <HeroCard onQuickInput={openQuickReceiptInput} />
        <MissionStack data={data} onOpenModal={setModal} onOpenCollectionPriority={openCollectionPriority} onNavigate={onNavigate} />
        <RunRateCard data={data} />
        <KpiGrid data={data} onNavigate={onNavigate} />
        <TerritoryProgression data={data} />
        <RevenueAtRisk data={data} onOpenModal={setModal} />
        <PerformanceGauges data={data} />
        <ReflectionDigest onNavigate={onNavigate} />
        <QuickActions onNavigate={onNavigate} onOpenModal={setModal} />
        <MobileBottomNav onNavigate={onNavigate} />
      </div>

      <div className="ops-desktop-board">
        <CommandLanternKingdom onNavigate={onNavigate} />
        <SkyBar />
        <WarStrip onNavigate={onNavigate} />
        <StatusStrip data={data} />
        <EmergencyTaskComposer />
        <div className="ops-desktop-hero-row">
          <HeroCard onQuickInput={openQuickReceiptInput} />
          <MissionStack data={data} onOpenModal={setModal} onOpenCollectionPriority={openCollectionPriority} onNavigate={onNavigate} />
        </div>
        <KpiGrid data={data} onNavigate={onNavigate} />
        <div className="ops-desktop-territory-row">
          <TerritoryProgression data={data} />
          <RevenueAtRisk data={data} onOpenModal={setModal} />
        </div>
        <div className="ops-desktop-performance-row">
          <PerformanceGauges data={data} />
          <QuickActions onNavigate={onNavigate} onOpenModal={setModal} />
        </div>
        <ReflectionDigest onNavigate={onNavigate} />
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
