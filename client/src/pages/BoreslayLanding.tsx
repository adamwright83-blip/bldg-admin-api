import { useEffect, useState } from "react";
import "../components/boreslay/boreslay.css";
import { PublicBoreslayDemo } from "../components/boreslay-demo/PublicBoreslayDemo";
import { BsCanonicalSections } from "../components/boreslay/BsCanonicalSections";
import { BsIntakeModal } from "../components/boreslay/BsIntake";
import { BsNav } from "../components/boreslay/BsNav";

export default function BoreslayLanding() {
  const [intakeOpen, setIntakeOpen] = useState(false);
  const openIntake = () => setIntakeOpen(true);
  const [demoActive, setDemoActive] = useState(false);
  const scrollTo = (selector: string) =>
    document
      .querySelector(selector)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });

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
          onVictoryCta={() => scrollTo("#crew")}
        />
        <BsCanonicalSections
          onCta={openIntake}
          onPlayFirst={() => scrollTo("#top")}
        />
      </main>
      <BsIntakeModal open={intakeOpen} onClose={() => setIntakeOpen(false)} />
    </div>
  );
}
