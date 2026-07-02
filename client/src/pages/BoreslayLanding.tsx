import { useEffect, useState } from "react";
import "../components/boreslay/boreslay.css";
import { BsFaq } from "../components/boreslay/BsFaq";
import { BsFinalCta } from "../components/boreslay/BsFinalCta";
import { BsFounder } from "../components/boreslay/BsFounder";
import { BsHero } from "../components/boreslay/BsHero";
import { BsHowItWorks } from "../components/boreslay/BsHowItWorks";
import { BsInsideOutside } from "../components/boreslay/BsInsideOutside";
import { BsIntakeModal } from "../components/boreslay/BsIntake";
import { BsNav } from "../components/boreslay/BsNav";
import { BsPricing } from "../components/boreslay/BsPricing";
import { BsProductTour } from "../components/boreslay/BsProductTour";

export default function BoreslayLanding() {
  const [intakeOpen, setIntakeOpen] = useState(false);
  const openIntake = () => setIntakeOpen(true);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = "BORESLAY — Slay the slow days. AI revenue missions for boring businesses.";
    const meta = document.querySelector('meta[name="description"]');
    const prevDescription = meta?.getAttribute("content") ?? null;
    meta?.setAttribute(
      "content",
      "BORESLAY is an AI-powered growth game that brings in new customers, brings old customers back, and tracks every win in dollars. Built for laundromats, plumbers, landscapers, contractors, cleaners, and detailers."
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
        <BsHero onCta={openIntake} />
        <BsFounder />
        <BsInsideOutside />
        <BsHowItWorks />
        <BsProductTour />
        <BsFaq />
        <BsPricing onCta={openIntake} />
        <BsFinalCta />
      </main>

      {/* Mobile-only sticky CTA bar */}
      <div className="bs-mobile-bar">
        <button type="button" className="bs-cta" style={{ width: "100%" }} onClick={openIntake}>
          Show Me My First Customer Mission
        </button>
      </div>

      <BsIntakeModal open={intakeOpen} onClose={() => setIntakeOpen(false)} />
    </div>
  );
}
