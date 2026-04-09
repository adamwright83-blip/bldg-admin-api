import { Level4Offensive } from "@/components/Level4Offensive";
import { useEffect, useRef, useState } from "react";

export default function AdminLevel4Preview() {
  const [deployed, setDeployed] = useState(false);
  const [scale, setScale] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const stageWidth = 1120;
  const stageHeight = 1260;

  useEffect(() => {
    const target = viewportRef.current;
    if (!target) return;

    const fit = () => {
      const { clientWidth, clientHeight } = target;
      const nextScale = Math.min(clientWidth / stageWidth, clientHeight / stageHeight, 1);
      setScale(nextScale);
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(target);
    return () => observer.disconnect();
  }, [stageHeight, stageWidth]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0e1111] text-[#d1d5db]">
      <div ref={viewportRef} className="h-full w-full grid place-items-center p-2 sm:p-3">
        <div style={{ width: stageWidth * scale, height: stageHeight * scale }}>
          <div
            style={{
              width: stageWidth,
              height: stageHeight,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
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
      </div>
    </div>
  );
}
