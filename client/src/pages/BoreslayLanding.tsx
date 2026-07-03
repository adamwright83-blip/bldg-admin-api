import { useEffect } from "react";
import "../components/boreslay/boreslay.css";
import { PublicBoreslayDemo } from "../components/boreslay-demo/PublicBoreslayDemo";

export default function BoreslayLanding() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "BORESLAY — Play the game. Command the crew. Grow your business.";
    const meta = document.querySelector('meta[name="description"]');
    const prevDescription = meta?.getAttribute("content") ?? null;
    meta?.setAttribute(
      "content",
      "Play as Spark in BORESLAY's public boss-fight demo and defeat The Procrastinator in a real-time fantasy action game."
    );
    return () => {
      document.title = prevTitle;
      if (meta && prevDescription !== null) meta.setAttribute("content", prevDescription);
    };
  }, []);

  return (
    <div className="bs-root" style={{ minHeight: "100vh", background: "#03070a" }}>
      <header className="bs-game-header" style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 clamp(18px, 4vw, 60px)", color: "#f5eee2", background: "#020405", borderBottom: "1px solid rgba(239,178,31,.2)" }}>
        <div className="bs-display" style={{ fontSize: 27, letterSpacing: ".04em" }}><span style={{ color: "#f4b91c" }}>ϟ</span> BORE<span style={{ color: "#f4b91c" }}>SLAY</span></div>
        <span className="bs-mono bs-game-tagline" style={{ fontSize: 11, color: "#a79b88" }}>THE ACTION RPG FOR REAL BUSINESS GROWTH</span>
      </header>
      <main><PublicBoreslayDemo /></main>
    </div>
  );
}
