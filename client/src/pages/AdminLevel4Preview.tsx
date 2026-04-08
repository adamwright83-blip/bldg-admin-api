import { Level4Offensive } from "@/components/Level4Offensive";
import { useState } from "react";

export default function AdminLevel4Preview() {
  const [deployed, setDeployed] = useState(false);

  return (
    <div className="min-h-screen bg-[#0e1111] text-[#d1d5db]">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#4ade80]">
          Level 4 preview mode
        </p>
        <p className="font-mono text-[11px] text-[#94a3b8]">
          This route force-renders the offensive HUD for visual review only.
        </p>
        <Level4Offensive
          soberDays={2114}
          debtCents={0}
          recoveredTodayCents={538000}
          onDeployLane1={() => setDeployed(true)}
          lane1Executed={deployed}
        />
      </div>
    </div>
  );
}
