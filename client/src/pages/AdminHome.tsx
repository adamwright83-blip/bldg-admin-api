import { useMemo } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { OpsBoardHome } from "@/components/admin/ops-board/OpsBoardHome";
import { buildOpsBoardData } from "@/components/admin/ops-board/opsBoardData";
import type { LogOutreachPayload } from "@/components/admin/ops-board/types";

type AdminHomeProps = {
  operatorName?: string;
  onOpenMobileNav?: () => void;
  onNavigate?: (path: string) => void;
  onOpenCustomer?: (phone: string) => void;
};

export default function AdminHome({
  operatorName = "Admin",
  onOpenMobileNav = () => undefined,
  onNavigate = (path) => {
    window.location.href = path;
  },
  onOpenCustomer,
}: AdminHomeProps) {
  const { user, isAuthenticated } = useAuth();
  const isAdmin = user?.role === "admin";

  const dashboard = trpc.admin.dashboardSummary.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const awaiting = trpc.admin.getAwaitingPayment.useQuery(undefined, {
    enabled: isAuthenticated && isAdmin,
  });
  const collected = trpc.admin.getCollectedToday.useQuery(undefined, {
    enabled: isAuthenticated && isAdmin,
  });
  const apex = trpc.admin.getLevel1ApexCommand.useQuery(undefined, {
    enabled: isAuthenticated && isAdmin,
  });
  const level2 = trpc.admin.getLevel2TacticalCluster.useQuery(undefined, {
    enabled: isAuthenticated && isAdmin,
  });
  const utils = trpc.useUtils();

  const logOutreach = trpc.admin.executeOffensiveAction.useMutation({
    onSuccess: async () => {
      await utils.admin.getLevel4OffensiveState.invalidate();
      toast.success("Outreach attempt logged.");
    },
    onError: (error) => {
      toast.error(error.message || "Could not log outreach attempt.");
    },
  });

  const data = useMemo(
    () =>
      buildOpsBoardData({
        dashboard: dashboard.data,
        awaiting: awaiting.data,
        collected: collected.data,
        apex: apex.data,
        level2: level2.data,
      }),
    [dashboard.data, awaiting.data, collected.data, apex.data, level2.data]
  );

  const loading =
    dashboard.isLoading || awaiting.isLoading || collected.isLoading || apex.isLoading || level2.isLoading;
  const error =
    dashboard.isError || awaiting.isError || collected.isError || apex.isError || level2.isError;

  async function handleLogOutreach(payload: LogOutreachPayload): Promise<void> {
    await logOutreach.mutateAsync({
      block: "building_penetration",
      buildingSlug: "building-3",
      buildingName: "Building 3",
      metadata: {
        convertedUsers: 0,
        convertedPaidUsers: 0,
        total: 0,
        unconverted: 0,
        penetrationPct: 0,
        paidPenetrationPct: 0,
      },
      generatedCopy: {
        headline: "Building 3 intro follow-up",
        body: "Christopher at OPUS LA promised a Building 3 intro.",
        primaryCopy: data.oneThingRightNow.suggestedText,
        internalNote: `Channel: ${payload.channel}. Occurred at: ${payload.occurredAt}. Notes: ${payload.notes}`,
        deliverable: "sms",
        brandId: "default",
      },
    });
  }

  return (
    <OpsBoardHome
      data={data}
      loading={loading}
      error={error}
      operatorName={operatorName}
      onOpenMobileNav={onOpenMobileNav}
      onNavigate={onNavigate}
      onOpenCustomer={(phone) => {
        if (phone && onOpenCustomer) {
          onOpenCustomer(phone);
          return;
        }
        onNavigate("/customers");
      }}
      onLogOutreach={handleLogOutreach}
      outreachLogging={logOutreach.isPending}
    />
  );
}
