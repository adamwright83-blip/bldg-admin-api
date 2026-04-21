import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { Loader2 } from "lucide-react";
import { DriverPrepMechanic } from "@/components/driver/DriverPrepMechanic";

export default function Driver() {
  const { loading: authLoading, isAuthenticated } = useAuth();

  const pickupQuery = trpc.admin.listByStatus.useQuery({ status: "new" });
  const deliveryQuery = trpc.admin.listByStatus.useQuery({ status: "ready" });
  const updateStatus = trpc.admin.updateStatus.useMutation();

  const handleResolveOrder = async (
    orderId: number,
    status: "collected" | "delivered"
  ) => {
    await updateStatus.mutateAsync({ orderId, status });
    await Promise.all([pickupQuery.refetch(), deliveryQuery.refetch()]);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8 text-black/30" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm role="driver" onSuccess={() => window.location.reload()} />;
  }

  return (
    <DriverPrepMechanic
      pickups={pickupQuery.data}
      deliveries={deliveryQuery.data}
      isLoading={
        pickupQuery.isLoading ||
        deliveryQuery.isLoading ||
        updateStatus.isPending
      }
      onResolveOrder={handleResolveOrder}
    />
  );
}
