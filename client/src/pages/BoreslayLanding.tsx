import { useEffect, useState } from "react";
import "../components/boreslay/boreslay.css";
import { PublicBoreslayDemo } from "../components/boreslay-demo/PublicBoreslayDemo";
import { BsCrew } from "../components/boreslay/BsCrew";
import { BsFaq } from "../components/boreslay/BsFaq";
import { BsFinalCta } from "../components/boreslay/BsFinalCta";
import { BsIntakeModal } from "../components/boreslay/BsIntake";
import { BsNav } from "../components/boreslay/BsNav";
import { BsPricing } from "../components/boreslay/BsPricing";
import { BsProofPanels } from "../components/boreslay/BsProofPanels";
import { BsRealms } from "../components/boreslay/BsRealms";
import { BsTrueNet } from "../components/boreslay/BsTrueNet";

export default function BoreslayLanding() {
  const [intakeOpen, setIntakeOpen] = useState(false);
  const openIntake = () => setIntakeOpen(true);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = "BORESLAY — Play the game. Command the crew. Grow your business.";
    const meta = document.querySelector('meta[name="description"]');
    const prevDescription = meta?.getAttribute("content") ?? null;
    meta?.setAttribute(
      "content",
      "Play as Spark in BORESLAY's public boss-fight demo, deploy your AI crew, and see real business missions become in-game power. Built for laundromats, plumbers, landscapers, and contractors."
    );
    return () => {
      document.title = prevTitle;
      if (meta && prevDescription !== null) meta.setAttribute("content", prevDescription);
    };
  }, []);

  return (
    <div className="bs-root" style={{ minHeight: "100vh" }}>
      <BsNav onCta={openIntake} />
      <main>
        <PublicBoreslayDemo />
        <BsProofPanels />
        <BsRealms />
        <BsCrew />
        <BsTrueNet />
        <BsPricing onCta={openIntake} />
        <BsFaq />
        <BsFinalCta />
      </main>
      <BsIntakeModal open={intakeOpen} onClose={() => setIntakeOpen(false)} />
    </div>
  );
}
