import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import SchedulePickupModal from "@/components/SchedulePickupModal";
import { CatalogDryCleanPricing } from "@/components/CatalogDryCleanPricing";
import { useTenant } from "@/hooks/useTenant";

/** Palette aligned with laundryfarm-v3.html */
const C = {
  forest: "#1a3a2a",
  forestLight: "#264d38",
  cream: "#faf7f2",
  creamDark: "#f0ebe3",
  gold: "#c8a96e",
  goldLight: "#ddc99a",
  charcoal: "#2a2a2a",
  slate: "#6b7280",
  emerald: "#10b981",
  emeraldSoft: "rgba(16, 185, 129, 0.08)",
} as const;

const HERO_IMAGE = "/laundry-farm/hero.png";
const sans = "'DM Sans', system-ui, sans-serif";
const serif = "'Playfair Display', Georgia, serif";

const ICONS = {
  shirts:
    "https://d2xsxph8kpxj0f.cloudfront.net/310519663281332025/66ERVFSQvqDVmLFWEFPer6/Untitleddesign(29)_dc2cfc16.png",
  dress:
    "https://d2xsxph8kpxj0f.cloudfront.net/310519663281332025/66ERVFSQvqDVmLFWEFPer6/Untitleddesign(27)_dcfa3ad4.png",
  serviceWash:
    "https://d2xsxph8kpxj0f.cloudfront.net/310519663281332025/66ERVFSQvqDVmLFWEFPer6/Untitleddesign(28)_e0bde531.png",
  bedding:
    "https://d2xsxph8kpxj0f.cloudfront.net/310519663281332025/66ERVFSQvqDVmLFWEFPer6/Untitleddesign(26)_787c6dad.png",
};

const REVIEWS = [
  { name: "Sarah J.", src: "Google", quote: "Perfectly clean and pressed every time. Pickup and delivery always on time." },
  { name: "Sydney P.", src: "Yelp", quote: "A laundry service I can trust. Quality is consistently excellent." },
  { name: "Jessica L.", src: "Google", quote: "So easy — schedule on the site and laundry is back the next day." },
  { name: "David K.", src: "Yelp", quote: "Best laundry service in LA. Professional team, results speak for themselves." },
];

function NavBar({ onBook, brandName }: { onBook: () => void; brandName: string }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  const navBg = scrolled ? "rgba(250, 247, 242, 0.95)" : "rgba(250, 247, 242, 0.85)";

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-[100] flex h-16 items-center justify-between border-b px-5 backdrop-blur-xl md:px-[clamp(20px,4vw,60px)]"
      style={{ background: navBg, borderColor: "rgba(26, 58, 42, 0.06)", fontFamily: sans }}
    >
      <button
        type="button"
        className="text-[17px] font-bold tracking-tight"
        style={{ color: C.forest }}
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      >
        {brandName}
      </button>
      <ul className="hidden items-center gap-8 md:flex list-none">
        {[
          ["#how", "How it works"],
          ["#pricing", "Pricing"],
          ["#faq", "FAQ"],
        ].map(([href, label]) => (
          <li key={href}>
            <a href={href} className="text-[13px] font-medium tracking-wide transition-colors hover:opacity-80" style={{ color: C.slate }}>
              {label}
            </a>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={onBook}
            className="rounded-full px-[22px] py-2.5 text-[13px] font-semibold text-[#faf7f2] transition-all hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(26,58,42,0.2)]"
            style={{ background: C.forest }}
          >
            Schedule Pickup →
          </button>
        </li>
      </ul>
      <button type="button" className="flex flex-col gap-1.5 p-2 md:hidden" aria-label="Menu" onClick={() => setOpen(v => !v)}>
        <span className="block h-0.5 w-5" style={{ background: C.forest }} />
        <span className="block h-0.5 w-5" style={{ background: C.forest }} />
        <span className="block h-0.5 w-5" style={{ background: C.forest }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="absolute left-0 right-0 top-full border-b bg-[#faf7f2] md:hidden overflow-hidden"
            style={{ borderColor: "rgba(26, 58, 42, 0.08)" }}
          >
            <div className="flex flex-col gap-3 px-5 py-4 text-sm font-medium">
              <a href="#how" onClick={() => setOpen(false)} style={{ color: C.forest }}>How it works</a>
              <a href="#pricing" onClick={() => setOpen(false)} style={{ color: C.forest }}>Pricing</a>
              <a href="#faq" onClick={() => setOpen(false)} style={{ color: C.forest }}>FAQ</a>
              <button type="button" onClick={() => { onBook(); setOpen(false); }} className="rounded-full py-3 font-semibold text-white" style={{ background: C.forest }}>
                Schedule Pickup →
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

function FloatCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div
      className={`absolute z-[3] flex items-center gap-3.5 rounded-2xl bg-white px-5 py-4 shadow-[0_4px_24px_rgba(0,0,0,0.08)] max-md:hidden ${className ?? ""}`}
      animate={{ y: [0, -6, 0] }}
      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
    >
      {children}
    </motion.div>
  );
}

function FloatCardDelayed({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div
      className={`absolute z-[3] flex items-center gap-2.5 rounded-2xl bg-white px-[18px] py-3.5 shadow-[0_4px_24px_rgba(0,0,0,0.08)] max-md:hidden ${className ?? ""}`}
      animate={{ y: [0, -6, 0] }}
      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: -2 }}
    >
      {children}
    </motion.div>
  );
}

const easeOut = [0.22, 1, 0.36, 1] as const;

function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 26 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.52, ease: easeOut, delay }}
      viewport={{ once: true, margin: "-48px 0px -10% 0px", amount: 0.12 }}
    >
      {children}
    </motion.div>
  );
}

function ScrollCue() {
  const reduce = useReducedMotion();
  return (
    <motion.a
      href="#how"
      className="absolute bottom-5 left-1/2 z-[5] flex -translate-x-1/2 flex-col items-center gap-0.5 max-lg:bottom-4"
      style={{ color: C.gold }}
      aria-label="Scroll to how it works"
      animate={reduce ? undefined : { y: [0, 7, 0] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">Scroll</span>
      <ChevronDown className="h-5 w-5 opacity-90" strokeWidth={2} aria-hidden />
    </motion.a>
  );
}

export default function LaundryFarmHome() {
  const { tenant } = useTenant();
  const [showModal, setShowModal] = useState(false);
  const heroRef = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroImgY = useTransform(scrollYProgress, [0, 1], [0, reduceMotion ? 0 : 80]);
  const heroImgScale = useTransform(scrollYProgress, [0, 1], [1, reduceMotion ? 1 : 1.045]);

  const heroContainer = {
    hidden: {},
    show: {
      transition: {
        staggerChildren: reduceMotion ? 0 : 0.1,
        delayChildren: reduceMotion ? 0 : 0.06,
      },
    },
  };
  const heroItem = {
    hidden: { opacity: 0, y: 22 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: reduceMotion ? 0 : 0.48, ease: easeOut },
    },
  };

  return (
    <div className="min-h-screen overflow-x-hidden antialiased" style={{ fontFamily: sans, color: C.charcoal, background: C.cream }}>
      <NavBar onBook={() => setShowModal(true)} brandName={tenant.brandName} />

      {/* Hero — split grid (v3) */}
      <section ref={heroRef} className="relative grid min-h-screen grid-cols-1 lg:grid-cols-2 lg:min-h-0">
        <div
          className="flex flex-col justify-center px-6 pb-10 pt-[clamp(100px,10vw,140px)] lg:pr-[clamp(30px,4vw,60px)] lg:pl-[clamp(30px,5vw,80px)]"
          style={{ fontFamily: sans }}
        >
          <motion.div
            className="flex w-full flex-col"
            initial={reduceMotion ? false : "hidden"}
            animate="show"
            variants={heroContainer}
          >
            <motion.div variants={heroItem} className="mb-5 flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: C.gold }}>
              <span className="h-px w-6 shrink-0" style={{ background: C.gold }} aria-hidden />
              Los Angeles
            </motion.div>
            <motion.h1
              variants={heroItem}
              className="mb-6 max-w-xl text-[clamp(36px,4.5vw,58px)] font-medium leading-[1.12] tracking-tight"
              style={{ fontFamily: serif, color: C.forest }}
            >
              The city runs hot.
              <br />
              <em className="italic font-normal">Your clothes</em>{" "}
              <span style={{ color: C.gold }}>don&apos;t have to.</span>
            </motion.h1>
            <motion.p variants={heroItem} className="mb-9 max-w-[420px] text-[17px] leading-[1.7]" style={{ color: C.slate }}>
              Fresh laundry, picked up and delivered across LA. You handle the living — we handle the rest.
            </motion.p>
            <motion.div variants={heroItem} className="mb-10 flex flex-wrap items-center gap-3.5">
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-2 rounded-full px-9 py-4 text-[15px] font-semibold text-[#faf7f2] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_32px_rgba(26,58,42,0.2)]"
                style={{ background: C.forest }}
              >
                Schedule Pickup →
              </button>
              <a
                href="#pricing"
                className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-[rgba(26,58,42,0.18)] px-8 py-4 text-[15px] font-medium transition-all hover:border-[#1a3a2a] hover:bg-[rgba(26,58,42,0.03)]"
                style={{ color: C.forest }}
              >
                View Pricing
              </a>
            </motion.div>
            <motion.div variants={heroItem} className="flex flex-wrap items-center gap-7 border-t pt-8 max-md:flex-col max-md:items-start max-md:gap-3.5" style={{ borderColor: "rgba(26, 58, 42, 0.08)" }}>
              {[
                ["20,000+", "Items Cleaned"],
                ["99.99%", "Success Rate"],
                ["0", "Damage Reports"],
              ].map(([num, label], i) => (
                <div key={label} className="flex items-center gap-7 max-md:contents">
                  {i > 0 && <span className="hidden h-8 w-px shrink-0 max-md:hidden sm:block" style={{ background: "rgba(26, 58, 42, 0.1)" }} aria-hidden />}
                  <div className="flex flex-col">
                    <span className="text-[22px] font-semibold leading-tight" style={{ fontFamily: serif, color: C.forest }}>{num}</span>
                    <span className="text-[11px] font-medium uppercase tracking-[0.06em]" style={{ color: C.slate }}>{label}</span>
                  </div>
                </div>
              ))}
            </motion.div>
          </motion.div>
        </div>

        <div className="relative min-h-[45vh] overflow-hidden lg:min-h-screen">
          <motion.div
            className="absolute inset-0 h-[120%] w-full -top-[10%]"
            style={{ y: heroImgY, scale: heroImgScale }}
          >
            <img src={HERO_IMAGE} alt="Laundry delivered at your door in a sealed bag" className="h-full w-full object-cover object-center" />
          </motion.div>
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at 40% 30%, rgba(255, 220, 150, 0.25) 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(200, 169, 110, 0.15) 0%, transparent 50%)",
            }}
          />
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[120px] bg-gradient-to-t from-[rgba(26,58,42,0.06)] to-transparent" />

          <FloatCard className="bottom-10 left-6 lg:left-8">
            <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl" style={{ background: C.emeraldSoft }}>
              <Check className="h-5 w-5" strokeWidth={2} style={{ color: C.emerald }} aria-hidden />
            </div>
            <div>
              <div className="text-[11px] font-medium" style={{ color: C.slate }}>Next-day delivery</div>
              <div className="text-[15px] font-bold" style={{ color: C.forest }}>Available today</div>
            </div>
          </FloatCard>
          <FloatCardDelayed className="right-6 top-[120px] lg:right-8">
            <span className="text-[13px] tracking-wide" style={{ color: C.gold }}>★★★★★</span>
            <span className="text-xs font-medium" style={{ color: C.slate }}>Google & Yelp</span>
          </FloatCardDelayed>
        </div>
        <ScrollCue />
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-[1200px] px-5 py-[clamp(48px,8vw,100px)] md:px-[clamp(20px,6vw,80px)]">
        <Reveal>
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: C.gold }}>How it works</div>
          <h2 className="mb-4 max-w-xl text-[clamp(28px,3.5vw,42px)] font-medium leading-[1.15]" style={{ fontFamily: serif, color: C.forest }}>
            Three steps. Then go <em className="italic">do something better.</em>
          </h2>
          <p className="mb-10 max-w-[480px] text-base leading-relaxed md:mb-12" style={{ color: C.slate }}>
            No apps to download. No subscriptions. Just schedule, and we take it from there.
          </p>
        </Reveal>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-6">
          {[
            {
              n: "01",
              title: "Book a pickup",
              body: "Choose a date and time slot. Takes under a minute.",
              micro: "Optional: snap a photo for a quick cost estimate",
              icon: (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.emerald} strokeWidth="2" aria-hidden>
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              ),
            },
            {
              n: "02",
              title: "We clean & fold",
              body: "Professional wash, dry, fold, and pressing. Every item treated with care.",
              icon: (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.emerald} strokeWidth="2" aria-hidden>
                  <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                  <path d="M12 6v6l4 2" />
                </svg>
              ),
            },
            {
              n: "03",
              title: "We bring it back",
              body: "Neat bags at your door — often next-day. Track your order in real time.",
              icon: (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.emerald} strokeWidth="2" aria-hidden>
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              ),
            },
          ].map((step, i) => (
            <Reveal key={step.n} delay={i * 0.09}>
              <div
                className="group relative h-full rounded-[20px] border border-[rgba(26,58,42,0.05)] bg-white p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(26,58,42,0.07)] md:p-8 md:pt-8 md:pb-8 md:pl-7 md:pr-7"
              >
                <div className="mb-3.5 text-[52px] font-normal leading-none" style={{ fontFamily: serif, color: "rgba(26, 58, 42, 0.05)" }}>{step.n}</div>
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[14px]" style={{ background: C.emeraldSoft }}>{step.icon}</div>
                <h3 className="mb-2 text-lg font-semibold" style={{ color: C.forest }}>{step.title}</h3>
                <p className="text-sm leading-[1.65]" style={{ color: C.slate }}>{step.body}</p>
                {"micro" in step && step.micro && (
                  <div
                    className="mt-3 inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-semibold"
                    style={{ borderColor: "rgba(16, 185, 129, 0.1)", background: "rgba(16, 185, 129, 0.05)", color: C.forestLight }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    {step.micro}
                  </div>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Midpage feeling */}
      <section className="relative overflow-hidden px-5 py-[clamp(48px,8vw,100px)] md:px-[clamp(20px,6vw,80px)]" style={{ background: C.forest }}>
        <div
          className="pointer-events-none absolute -right-[150px] -top-[150px] h-[500px] w-[500px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(200, 169, 110, 0.06) 0%, transparent 70%)" }}
        />
        <Reveal className="relative z-[1] mx-auto max-w-[800px] text-center">
          <h2 className="mb-5 text-[clamp(26px,3.5vw,44px)] font-normal leading-tight" style={{ fontFamily: serif, color: C.cream }}>
            You didn&apos;t move to LA
            <br />
            to <em className="italic" style={{ color: C.goldLight }}>sort laundry.</em>
          </h2>
          <p className="mx-auto max-w-[560px] text-base leading-[1.75]" style={{ color: "rgba(250, 247, 242, 0.55)" }}>
            Every hour you spend at a laundromat is an hour you&apos;re not hiking Griffith, not meeting someone for coffee, not building something that matters. We give that hour back.
          </p>
        </Reveal>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-[1200px] px-5 py-[clamp(48px,8vw,100px)] md:px-[clamp(20px,6vw,80px)]">
        <Reveal>
          <div className="mb-3 text-center text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: C.gold }}>Pricing</div>
          <h2 className="mb-3 text-center text-[clamp(28px,3.5vw,42px)] font-medium" style={{ fontFamily: serif, color: C.forest }}>
            Straightforward <em className="italic">per-item pricing.</em>
          </h2>
          <p className="mb-10 text-center text-[15px] md:mb-12" style={{ color: C.slate }}>
            No hidden fees. No subscriptions. Pay for what you clean.
          </p>
        </Reveal>
        <div className="mb-10 grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: ICONS.shirts, name: "Shirts", desc: "Washed & pressed", price: "$4.99" },
            { icon: ICONS.dress, name: "Dresses", desc: "Dry cleaned", price: "$11.50" },
            { icon: ICONS.serviceWash, name: "Service Wash", desc: "Wash, dry & fold", price: "$35.00" },
            { icon: ICONS.bedding, name: "Bedding", desc: "Wash & press", price: "$14.50" },
          ].map((item, i) => (
            <Reveal key={item.name} delay={i * 0.07}>
              <div
                className="h-full rounded-[18px] border border-[rgba(26,58,42,0.05)] bg-white px-6 py-7 text-center transition-all duration-300 hover:-translate-y-1 hover:border-[#c8a96e] hover:shadow-[0_8px_30px_rgba(26,58,42,0.06)]"
              >
                <div className="mx-auto mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-[14px]" style={{ background: C.cream }}>
                  <img src={item.icon} alt="" className="h-9 w-9 object-contain" />
                </div>
                <h3 className="mb-1 text-base font-semibold" style={{ color: C.forest }}>{item.name}</h3>
                <div className="mb-3.5 text-xs" style={{ color: C.slate }}>{item.desc}</div>
                <div className="text-[28px] font-medium" style={{ fontFamily: serif, color: C.forest }}>{item.price}</div>
                <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: C.slate }}>from</div>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal className="mx-auto mt-8 max-w-[720px]">
          <h3
            className="mb-2 text-center text-[13px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: C.gold }}
          >
            Dry cleaning garment menu
          </h3>
          <p className="mb-3 text-center text-[13px]" style={{ color: C.slate }}>
            Live prices from our catalog (wash &amp; fold packages above stay as shown).
          </p>
          <CatalogDryCleanPricing variant="laundryfarm" maxHeightClass="max-h-[280px]" />
        </Reveal>
        <Reveal className="text-center">
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 rounded-full px-9 py-4 text-[15px] font-semibold text-[#faf7f2] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_32px_rgba(26,58,42,0.2)]"
            style={{ background: C.forest }}
          >
            Schedule Pickup →
          </button>
        </Reveal>
      </section>

      {/* Stats bar */}
      <section className="px-5 py-[52px] md:px-[clamp(20px,6vw,80px)]" style={{ background: C.forest }}>
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-8 text-center sm:grid-cols-3 sm:gap-8">
          {[
            ["20,000+", "Items Cleaned"],
            ["99.99%", "Success Rate"],
            ["0", "Damage Reports"],
          ].map(([num, label], i) => (
            <Reveal key={label} delay={i * 0.1}>
              <div>
                <div className="mb-1.5 text-[clamp(32px,4vw,48px)] font-medium leading-none" style={{ fontFamily: serif, color: C.cream }}>{num}</div>
                <div className="text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(250, 247, 242, 0.4)" }}>{label}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Reviews */}
      <section className="px-5 py-[clamp(48px,8vw,100px)] md:px-[clamp(20px,6vw,80px)]" style={{ background: C.creamDark }}>
        <div className="mx-auto max-w-[1200px]">
          <Reveal>
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: C.gold }}>Reviews</div>
            <h2 className="mb-3 text-[clamp(28px,3.5vw,42px)] font-medium" style={{ fontFamily: serif, color: C.forest }}>
              Trusted on <em className="italic">Google & Yelp.</em>
            </h2>
            <p className="mb-8 text-[15px] md:mb-10" style={{ color: C.slate }}>Real reviews from real customers across Los Angeles.</p>
          </Reveal>
          <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
            {REVIEWS.map((r, i) => (
              <Reveal key={r.name} delay={i * 0.08}>
                <div className="h-full rounded-[18px] border border-[rgba(26,58,42,0.04)] bg-white p-6">
                  <div className="mb-3 text-sm tracking-[2px]" style={{ color: C.gold }}>★★★★★</div>
                  <blockquote className="mb-4 text-sm italic leading-[1.65]" style={{ color: C.charcoal }}>&ldquo;{r.quote}&rdquo;</blockquote>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold" style={{ color: C.forest }}>{r.name}</span>
                    <span className="text-[11px]" style={{ color: C.slate }}>{r.src}</span>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* For buildings */}
      <section className="mx-auto max-w-[1200px] px-5 py-[clamp(48px,8vw,100px)] md:px-[clamp(20px,6vw,80px)]">
        <div className="relative grid grid-cols-1 gap-10 overflow-hidden rounded-3xl p-[clamp(40px,6vw,72px)] lg:grid-cols-2 lg:gap-12" style={{ background: C.forest }}>
          <div
            className="pointer-events-none absolute -right-[100px] -top-[100px] h-[400px] w-[400px] rounded-full"
            style={{ background: "radial-gradient(circle, rgba(200, 169, 110, 0.08) 0%, transparent 70%)" }}
          />
          <Reveal className="relative z-[1]">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: C.goldLight }}>For Property Managers</div>
            <h3 className="mb-4 text-[clamp(24px,3vw,34px)] font-medium leading-tight" style={{ fontFamily: serif, color: C.cream }}>
              Laundry as a building amenity.
            </h3>
            <p className="mb-7 max-w-[400px] text-[15px] leading-[1.7]" style={{ color: "rgba(250, 247, 242, 0.6)" }}>
              We partner with luxury high-rises to offer residents white-glove laundry through your concierge. No hardware. No staff overhead. Just happier residents.
            </p>
            <a
              href={`mailto:${tenant.supportEmail}?subject=Laundry%20Farm%20building%20partnership`}
              className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-semibold transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_32px_rgba(250,247,242,0.15)]"
              style={{ background: C.cream, color: C.forest }}
            >
              Learn More →
            </a>
          </Reveal>
          <div className="relative z-[1] grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              { emoji: "🏢", t: "Concierge Integration", d: "Works with your building flow" },
              { emoji: "📊", t: "Usage visibility", d: "Track satisfaction over time" },
              { emoji: "🚪", t: "Doorstep delivery", d: "Unit-to-unit service" },
              { emoji: "💳", t: "Zero cost to building", d: "Residents pay per order" },
            ].map((f, i) => (
              <Reveal key={f.t} delay={i * 0.07}>
                <div className="h-full rounded-[14px] border border-white/[0.08] bg-white/[0.05] p-5">
                  <span className="mb-2.5 block text-lg" aria-hidden>{f.emoji}</span>
                  <h4 className="mb-1 text-[13px] font-semibold" style={{ color: C.cream }}>{f.t}</h4>
                  <p className="text-xs leading-normal" style={{ color: "rgba(250, 247, 242, 0.4)" }}>{f.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-[800px] px-5 py-[clamp(48px,8vw,100px)] md:px-[clamp(20px,6vw,80px)]">
        <Reveal className="mb-10 text-center">
          <h2 className="text-[clamp(28px,3vw,38px)] font-medium" style={{ fontFamily: serif, color: C.forest }}>
            Quick answers
          </h2>
        </Reveal>
        {[
          { q: "How are payments processed?", a: "Securely through Stripe. Your card is charged after items are cleaned and a final price is confirmed. You get an itemized receipt by email." },
          { q: "What if I'm not home?", a: "Leave laundry in a bag outside your door. We pick up and deliver the same way. You get a text when your driver arrives and when delivery is complete." },
          { q: "What areas do you cover?", a: "Greater Los Angeles — Hollywood, Koreatown, DTLA, Silver Lake, Los Feliz, WeHo, Beverly Hills, and expanding. Contact us if you're outside these areas." },
          { q: "What's the turnaround time?", a: "Most orders return within 24 hours. Same-day and rush may be available — check when scheduling." },
          { q: "Can I get a cost estimate before booking?", a: "Yes — upload a photo when booking for a quick estimate, or use the per-item pricing above." },
        ].map((item, i) => (
          <Reveal key={item.q} delay={i * 0.05}>
            <details
              className={`group border-b ${i === 0 ? "pb-5 pt-0" : "py-5"}`}
              style={{ borderColor: "rgba(26, 58, 42, 0.08)" }}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium" style={{ color: C.forest }}>
                {item.q}
                <span className="text-xl font-light transition-transform group-open:rotate-45" style={{ color: C.gold }}>+</span>
              </summary>
              <p className="mt-3 pb-1 text-sm leading-[1.7]" style={{ color: C.slate }}>{item.a}</p>
            </details>
          </Reveal>
        ))}
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden px-5 py-[clamp(56px,10vw,120px)] text-center md:px-[clamp(20px,6vw,80px)]" style={{ background: C.forest }}>
        <div
          className="pointer-events-none absolute left-1/2 top-[-100px] h-[400px] w-[800px] -translate-x-1/2 rounded-[50%]"
          style={{ background: "radial-gradient(ellipse, rgba(200, 169, 110, 0.06) 0%, transparent 70%)" }}
        />
        <Reveal>
          <h2 className="relative z-[1] mb-3.5 text-[clamp(28px,3.5vw,44px)] font-normal leading-tight" style={{ fontFamily: serif, color: C.cream }}>
            Go live your life.
            <br />
            <em className="italic" style={{ color: C.goldLight }}>We&apos;ll handle the laundry.</em>
          </h2>
          <p className="relative z-[1] mb-9 text-base" style={{ color: "rgba(250, 247, 242, 0.55)" }}>
            First pickup is 20% off. Schedule in under a minute.
          </p>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="relative z-[1] inline-flex items-center gap-2 rounded-full px-11 py-[18px] text-base font-semibold transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_40px_rgba(250,247,242,0.2)]"
            style={{ background: C.cream, color: C.forest }}
          >
            Schedule Pickup →
          </button>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="px-5 pb-8 pt-12 md:px-[clamp(20px,6vw,80px)]" style={{ background: C.charcoal, color: "rgba(250, 247, 242, 0.5)" }}>
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-start justify-between gap-8">
          <div>
            <div className="mb-2 text-base font-bold" style={{ color: C.cream }}>{tenant.brandName}</div>
            <p className="max-w-[260px] text-[13px] leading-relaxed">Professional pickup & delivery laundry. Trusted by luxury residences across LA.</p>
          </div>
          <div className="flex flex-wrap gap-12 md:gap-12">
            <div>
              <h4 className="mb-3.5 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: C.cream }}>Service</h4>
              <a href="#how" className="mb-2 block text-[13px] transition-colors hover:text-[#faf7f2]">How it works</a>
              <a href="#pricing" className="mb-2 block text-[13px] transition-colors hover:text-[#faf7f2]">Pricing</a>
              <span className="block text-[13px] opacity-70">Coverage areas</span>
            </div>
            <div>
              <h4 className="mb-3.5 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: C.cream }}>Contact</h4>
              <a href={`tel:${tenant.supportPhone.replace(/[^\d+]/g, "")}`} className="mb-2 block text-[13px] transition-colors hover:text-[#faf7f2]">{tenant.supportPhone}</a>
              <a href={`mailto:${tenant.supportEmail}`} className="mb-2 block text-[13px] transition-colors hover:text-[#faf7f2]">{tenant.supportEmail}</a>
              <span className="block text-[13px]">Los Angeles, CA</span>
            </div>
          </div>
        </div>
        <div className="mx-auto mt-8 flex max-w-[1200px] flex-col items-center justify-between gap-3 border-t border-white/[0.06] pt-6 text-xs sm:flex-row" style={{ fontFamily: sans }}>
          <span>© {new Date().getFullYear()} {tenant.brandName}</span>
          <span className="flex gap-4">
            <a href="#" className="opacity-70 hover:opacity-100">Privacy</a>
            <a href="#" className="opacity-70 hover:opacity-100">Terms</a>
          </span>
        </div>
      </footer>

      {showModal && <SchedulePickupModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
