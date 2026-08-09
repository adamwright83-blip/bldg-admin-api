import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import ProductShell from "@/product/ProductShell";
import { Loader2 } from "lucide-react";

export default function Driver() {
  const { loading: authLoading, isAuthenticated } = useAuth();

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-black/30" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm role="driver" onSuccess={() => window.location.reload()} />;
  }

  return <ProductShell />;
}
