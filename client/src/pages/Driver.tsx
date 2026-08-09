import { Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import GoldlineDriverController from "./driver/GoldlineDriverController";
import "./goldline/goldline-legibility.css";
import "./goldline/goldline-live-fix.css";

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
    return (
      <LoginForm role="driver" onSuccess={() => window.location.reload()} />
    );
  }

  return <GoldlineDriverController />;
}
