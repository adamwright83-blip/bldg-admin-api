import { useEffect, useRef, useState } from "react";
import "../components/boreslay/boreslay.css";
import { PublicBoreslayDemo } from "../components/boreslay-demo/PublicBoreslayDemo";
import { BsCrew } from "../components/boreslay/BsCrew";
import { BsFaq } from "../components/boreslay/BsFaq";
import { BsFinalCta } from "../components/boreslay/BsFinalCta";
import { BsFirstPlayer } from "../components/boreslay/BsFirstPlayer";
import { BsGameLoop } from "../components/boreslay/BsGameLoop";
import { BsIntakeModal } from "../components/boreslay/BsIntake";
import { BsIntakeSection } from "../components/boreslay/BsIntakeSection";
import { BsNav } from "../components/boreslay/BsNav";
import { BsPricing } from "../components/boreslay/BsPricing";
import { BsProofPanels } from "../components/boreslay/BsProofPanels";
import { BsRealms } from "../components/boreslay/BsRealms";
import { BsTrueNet } from "../components/boreslay/BsTrueNet";

export default function BoreslayLanding() {
  const [intakeOpen, setIntakeOpen] = useState(false);
  const openIntake = () => setIntakeOpen(true);
  const crewRef = useRef<HTMLDivElement>(null);
  const [demoActive, setDemoActive] = useState(false);
  const scrollToCrew = () =>
    crewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  useEffect(() => {
    const prevTitle = document.title;
    document.title =
      "BORESLAY — Play the game. Command the crew. Grow your business.";
    const meta = document.querySelector('meta[name="description"]');
    const prevDescription = meta?.getAttribute("content") ?? null;
    meta?.setAttribute(
      "content",
      "Play as Spark in BORESLAY's public boss-fight demo, deploy your AI crew, and see real business missions become in-game power. Built for laundromats, plumbers, landscapers, and contractors."
    );
    return () => {
      document.title = prevTitle;
      if (meta && prevDescription !== null)
        meta.setAttribute("content", prevDescription);
    };
  }, []);

  return (
    <div className="bs-root" style={{ minHeight: "100vh" }}>
      <BsNav onCta={openIntake} subdued={!demoActive} />
      <main>
        <PublicBoreslayDemo
          onActiveChange={setDemoActive}
          onVictoryCta={scrollToCrew}
        />
        <div ref={crewRef}>
          <BsCrew />
        </div>
        <BsGameLoop />
        <BsProofPanels />
        <BsRealms />
        <BsFirstPlayer />
        <BsTrueNet />
        <BsPricing onCta={openIntake} />
        <BsFaq />
        <BsIntakeSection />
        <BsFinalCta onCta={openIntake} />
      </main>
      <BsIntakeModal open={intakeOpen} onClose={() => setIntakeOpen(false)} />
    </div>
  );
}
