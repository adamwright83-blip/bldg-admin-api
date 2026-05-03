import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { Loader2 } from "lucide-react";
import { DriverPrepMechanic } from "@/components/driver/DriverPrepMechanic";
import { useState } from "react";

function getLocalYmd(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export default function Driver() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const [selectedDate, setSelectedDate] = useState(() => getLocalYmd());

  const pickupQuery = trpc.admin.listByDate.useQuery({
    date: selectedDate,
    status: "new",
    dateField: "pickupDate",
  });
  const deliveryQuery = trpc.admin.listByDate.useQuery({
    date: selectedDate,
    status: "ready",
    dateField: "deliveryDate",
  });
  const updateStatus = trpc.admin.updateStatus.useMutation();

  const handleResolveOrder = async (
    orderId: number,
    status: "collected" | "delivered"
  ) => {
    await updateStatus.mutateAsync({ orderId, status });
    await Promise.all([pickupQuery.refetch(), deliveryQuery.refetch()]);
  };

  const handleOrderCreated = async () => {
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
      selectedDate={selectedDate}
      onSelectedDateChange={setSelectedDate}
      isLoading={
        pickupQuery.isLoading ||
        deliveryQuery.isLoading ||
        updateStatus.isPending
      }
      onOrderCreated={handleOrderCreated}
      onResolveOrder={handleResolveOrder}
    />
  );
}
