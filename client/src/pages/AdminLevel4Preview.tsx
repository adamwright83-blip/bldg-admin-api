import { Level4Offensive } from "@/components/Level4Offensive";
import { useState } from "react";

export default function AdminLevel4Preview() {
  const [deployed, setDeployed] = useState(false);

  return (
    <div className="min-h-screen w-screen overflow-auto bg-[#0e1111] text-[#d1d5db]">
      <div className="mx-auto w-full max-w-[1180px] p-2 sm:p-3">
        <Level4Offensive
          className="l4-fullvisionSurface"
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
