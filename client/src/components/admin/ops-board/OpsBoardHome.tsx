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

      <div className="ops-mobile-board">
        <MobileTopBar operatorName={operatorName} onOpenMobileNav={onOpenMobileNav} />
        <StatusStrip data={data} includeRunRate={false} />
        <EmergencyTaskComposer />
        <HeroCard onQuickInput={openQuickReceiptInput} />
        <RunRateCard data={data} />
        <KpiGrid data={data} onNavigate={onNavigate} />
        <MissionStack data={data} onOpenModal={setModal} onOpenCollectionPriority={openCollectionPriority} onNavigate={onNavigate} />
        <TerritoryProgression data={data} />
        <RevenueAtRisk data={data} onOpenModal={setModal} />
        <PerformanceGauges data={data} />
        <QuickActions onNavigate={onNavigate} onOpenModal={setModal} />
        <MobileBottomNav onNavigate={onNavigate} />
      </div>

      <div className="ops-desktop-board">
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
