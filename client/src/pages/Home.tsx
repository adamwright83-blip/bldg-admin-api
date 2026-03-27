/**
 * Laundry Butler Landing Page — v12 (post full-stack upgrade)
 */
import { useState } from "react";
import { useTenant } from "@/hooks/useTenant";
import SchedulePickupModal from "../components/SchedulePickupModal";

const ASSETS = {
  background: "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/diCeeQRRzswvwYpY.png",
  logo: "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/TnWYaeVttBiuZTNp.png",
  logoFull: "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/WZKCbJMLcYxTxbBz.png",
  section1: "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/scGtnaDBPDQZiTXm.png",
  section3: "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/kxahbyuYXKRWwDEf.png",
  decorLeft: "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/pZnkcntBcAEunqJs.png",
  decorRight: "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/dxwzOtcZvpndXQZq.png",
  divider: "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/wwdNeNnCwfpAGUkT.png",
};

const pf = { fontFamily: '"Playfair Display", Georgia, serif' };
const cg = { fontFamily: '"Cormorant Garamond", Georgia, serif' };

/* Cream color matching the background texture */
const CREAM = "#e9dde0";

/* ===== SLIM BLACK HEADER BAR ===== */
function HeaderBar({ phone }: { phone: string }) {
  const phoneHref = `tel:${phone.replace(/[^\d+]/g, "")}`;
  return (
    <div className="bg-black text-white w-full">
      <div className="flex items-center justify-center gap-4 md:gap-8 px-4 py-2 text-[0.7rem] md:text-[0.8rem] flex-wrap" style={cg}>
        {/* Hours */}
        <span className="flex items-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          Daily: 7:00am–1pm &amp; 7:00pm–9pm
        </span>

        {/* Phone */}
        <span className="flex items-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <a href={phoneHref} className="text-white hover:text-white/80 transition-colors">{phone}</a>
        </span>

        {/* Location */}
        <span className="flex items-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          Los Angeles
        </span>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div className="max-w-[700px] mx-auto px-8 py-1">
      <img src={ASSETS.divider} alt="" className="w-full h-auto" />
    </div>
  );
}

function CTAButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-block bg-black text-white hover:bg-black/90 transition-colors cursor-pointer"
      style={{
        ...cg,
        fontSize: "0.95rem",
        fontWeight: 500,
        letterSpacing: "0.1em",
        padding: "14px 28px",
        borderRadius: "3px",
        border: "none",
      }}
    >
      SCHEDULE PICKUP
    </button>
  );
}

function AlignedImage({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`px-8 md:px-0 ${className}`}>
      <div className="relative">
        <img
          src={src}
          alt={alt}
          className="w-full h-auto block"
        />
        <div
          className="absolute inset-y-0 left-0 w-6 md:hidden pointer-events-none"
          style={{
            background: `linear-gradient(to right, ${CREAM}, transparent)`,
          }}
        />
        <div
          className="absolute inset-y-0 right-0 w-6 md:hidden pointer-events-none"
          style={{
            background: `linear-gradient(to left, ${CREAM}, transparent)`,
          }}
        />
      </div>
    </div>
  );
}

export default function Home() {
  const [showModal, setShowModal] = useState(false);
  const { tenant } = useTenant();

  return (
    <div
      className="min-h-screen"
      style={{
        backgroundColor: CREAM,
        backgroundImage: `url(${ASSETS.background})`,
        backgroundRepeat: "repeat",
        backgroundSize: "1000px auto",
      }}
    >
      {/* ===== BLACK HEADER BAR ===== */}
      <HeaderBar phone={tenant.supportPhone} />

      {/* ===== SECTION 1: HERO ===== */}
      <section>
        <div className="flex flex-col md:flex-row md:items-end">
          <div className="flex-1 flex flex-col justify-end px-8 md:px-12 lg:px-16 pt-4 md:pt-6 pb-0">
            <div className="flex justify-center mb-6 md:mb-8 lg:mb-10">
              <img
                src={ASSETS.logoFull}
                alt={tenant.brandName}
                className="w-[220px] h-auto md:w-[280px] lg:w-[320px]"
              />
            </div>

            <h2
              className="text-[1.35rem] md:text-[1.6rem] lg:text-[1.8rem] leading-[1.2] tracking-tight mb-4"
              style={{ ...pf, fontWeight: 500 }}
            >
              Laundry &amp; Dry Cleaning,
              <br />
              Delivered Quietly
              <br />
              to Your Residence.
            </h2>

            <p
              className="text-[0.95rem] md:text-[1.05rem] lg:text-[1.12rem] leading-[1.5] text-black/70 mb-6 max-w-[420px]"
              style={cg}
            >
              Serving select Beverly Hills and Century City
              high-rises exclusively. Two hours' notice.
              <br />
              Same-day return available. Zero rush surcharges.
            </p>

            <div>
              <CTAButton onClick={() => setShowModal(true)} />
            </div>
          </div>

          <div className="flex-1">
            <AlignedImage
              src={ASSETS.section1}
              alt="Butler holding wrapped laundry"
            />
          </div>
        </div>
      </section>

      {/* ===== DIVIDER ===== */}
      <Divider />

      {/* ===== SECTION 2: PRICING ===== */}
      <section className="max-w-[800px] mx-auto px-6 py-5 md:py-7">
        <div className="flex items-center justify-center gap-2 md:gap-3 mb-5 md:mb-6">
          <img src={ASSETS.decorLeft} alt="" className="h-[18px] md:h-[22px] w-auto" />
          <h2
            className="text-[1.5rem] md:text-[1.9rem] tracking-tight px-1"
            style={{ ...pf, fontWeight: 500 }}
          >
            Pricing
          </h2>
          <img src={ASSETS.decorRight} alt="" className="h-[18px] md:h-[22px] w-auto" />
        </div>

        <div className="flex flex-col md:flex-row gap-4 md:gap-0 mb-5 md:mb-6">
          <div className="flex-1 md:pr-6 md:border-r md:border-black/20">
            <h3 className="text-[1.1rem] md:text-[1.3rem] mb-1 tracking-tight" style={{ ...pf, fontWeight: 600 }}>
              Wash &amp; Fold — $2.50/lb
            </h3>
            <p className="text-[0.9rem] md:text-[0.97rem] leading-[1.55] text-black/65" style={cg}>
              Same-day return on orders placed before
              <br />
              11am, Monday–Saturday.
            </p>
          </div>

          <div className="flex-1 md:pl-6">
            <h3 className="text-[1.1rem] md:text-[1.3rem] mb-1 tracking-tight" style={{ ...pf, fontWeight: 600 }}>
              Dry Cleaning — per garment
            </h3>
            <p className="text-[0.9rem] md:text-[0.97rem] leading-[1.55] text-black/65" style={cg}>
              Same-day return on orders placed before
              <br />
              8am, Monday–Friday, for $2 per garment.
              <br />
              Two business days at no extra cost.
            </p>
          </div>
        </div>

        <div className="text-center">
          <p className="text-[1.1rem] md:text-[1.3rem] tracking-tight mb-0.5" style={{ ...pf, fontWeight: 500 }}>
            Pickups available Monday–Sunday.
          </p>
          <p className="text-[0.9rem] md:text-[1rem] text-black/65" style={cg}>
            Evening rush service available.
          </p>
        </div>
      </section>

      {/* ===== DIVIDER ===== */}
      <Divider />

      {/* ===== SECTION 3: SERVICE DESCRIPTION ===== */}
      <section>
        <div className="flex flex-col md:flex-row">
          <div className="flex-1 flex flex-col justify-center px-8 md:px-12 lg:px-16 py-6 md:py-8">
            <h2
              className="text-center md:text-left text-[1.15rem] md:text-[1.35rem] lg:text-[1.5rem] leading-[1.3] tracking-tight mb-3"
              style={{ ...pf, fontWeight: 600 }}
            >
              We service select high-rises only.
              <br />
              Your concierge team knows us.
            </h2>
            <p
              className="text-[0.95rem] md:text-[1.05rem] lg:text-[1.12rem] leading-[1.6] text-black/70 mb-5 max-w-[440px]"
              style={cg}
            >
              Preferences are saved after your first order.
              Garments move directly between your
              residence and our facility — never warehoused
              or routed through a dispatch network. Laundry,
              handled quietly in the background, exactly as
              it should be.
            </p>

            <div>
              <CTAButton onClick={() => setShowModal(true)} />
            </div>
          </div>

          <div className="flex-1">
            <AlignedImage
              src={ASSETS.section3}
              alt="Butler presenting freshly cleaned shirt"
            />
          </div>
        </div>
      </section>

      {/* ===== DIVIDER ===== */}
      <Divider />

      {/* ===== FOOTER ===== */}
      <footer className="bg-black w-full">
        <div className="max-w-[700px] mx-auto px-6 py-2 md:py-3 text-center">
          <p
            className="text-[0.95rem] md:text-[1.1rem] tracking-tight text-white"
            style={{ ...pf, fontWeight: 400 }}
          >
            {tenant.brandName} — a BLDG.chat service.
          </p>
        </div>
      </footer>

      {/* ===== SCHEDULE PICKUP MODAL ===== */}
      {showModal && (
        <SchedulePickupModal onClose={() => setShowModal(false)} />
      )}
    </div>
  );
}
