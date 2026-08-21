import { useEffect } from "react";

const RESIDENT_API_ORIGIN =
  import.meta.env.VITE_RESIDENT_API_ORIGIN ?? "https://api.bldg.chat";

export default function LaundryButlerWelcome() {
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      window.location.replace("/account");
      return;
    }

    const target = new URL("/api/welcome", RESIDENT_API_ORIGIN);
    target.searchParams.set("token", token);
    target.searchParams.set("surface", "laundry-butler");
    window.location.replace(target.toString());
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff7f5] px-6 text-[#2f1b24]">
      <div className="text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1f3a33] font-semibold text-[#f9e6cf]">
          LB
        </div>
        <h1 className="text-2xl font-semibold">Confirming your order</h1>
        <p className="mt-2 text-sm text-[#7f5e6d]">
          Signing you in to Laundry Butler…
        </p>
      </div>
    </main>
  );
}
