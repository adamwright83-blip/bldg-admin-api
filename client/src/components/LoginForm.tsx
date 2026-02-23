import { useState } from "react";
import { trpc } from "@/lib/trpc";

type Props = {
  role?: "admin" | "driver";
  onSuccess: () => void;
};

export function LoginForm({ role = "admin", onSuccess }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const utils = trpc.useUtils();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Invalid password");
        return;
      }
      await utils.auth.me.invalidate();
      onSuccess();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold tracking-widest uppercase text-black/40 mb-2">
            Laundry Butler
          </p>
          <h1 className="text-xl font-semibold tracking-tight">
            {role === "driver" ? "Driver Sign In" : "Admin Sign In"}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
            required
            className="w-full border border-black/20 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/30"
          />
          {error && (
            <p className="text-xs text-red-600 text-center">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-black text-white rounded-lg px-4 py-3 text-sm font-medium hover:bg-black/80 transition-colors disabled:opacity-40"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
