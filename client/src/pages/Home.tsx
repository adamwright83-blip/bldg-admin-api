import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Clock3,
  Leaf,
  MapPin,
  Menu,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useTenant } from "@/hooks/useTenant";
import SchedulePickupModal, { SchedulePickupRail } from "@/components/SchedulePickupModal";
import { CatalogDryCleanPricing } from "@/components/CatalogDryCleanPricing";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { WF_RATE_PER_LB_CENTS, centsToDollars } from "@shared/pricing";

const COLORS = {
  page: "#fff7f5",
  panel: "#fff4f1",
  card: "#fffaf8",
  border: "#efdce3",
  copy: "#2c1a23",
  copySoft: "#7f5f6d",
  accent: "#d53177",
  accentDark: "#b61f61",
  accentSoft: "#ffe4f0",
  clay: "#f2d7c9",
  deep: "#1f3a33",
} as const;

const ASSETS = {
  hero: "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/scGtnaDBPDQZiTXm.png",
  logoFull: "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/WZKCbJMLcYxTxbBz.png",
  support: "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/kxahbyuYXKRWwDEf.png",
};

const SERVICE_CARDS = [
  {
    title: "Wash & Fold",
    price: `$${centsToDollars(WF_RATE_PER_LB_CENTS)} / lb`,
    bullets: [
      "Premium wash + dry + fold",
      "Quality detergents & fabric softeners",
      "Custom, ribbonless, eco-wash",
      "Gentle, expert care",
    ],
    cta: "Schedule Pickup",
    href: "#booking",
    gradient: "linear-gradient(145deg, #fff8fb 0%, #ffeaf3 100%)",
  },
  {
    title: "Dry Cleaning",
    price: "From $6.00",
    bullets: ["Silk / Blouse", "Wool / Blazer", "Designer / Dress", "Pant / Trousers"],
    cta: "View full pricing",
    href: "#pricing-menu",
    gradient: "linear-gradient(145deg, #fff7f4 0%, #ffe6ef 100%)",
  },
  {
    title: "Specialty Care",
    price: "From $25.00",
    bullets: [
      "Hand-finished items",
      "Heirlooms & fine fabrics",
      "Weddings & evening wear",
      "Consultative garment planning",
    ],
    cta: "View specialty details",
    href: "#pricing-menu",
    gradient: "linear-gradient(145deg, #fff8f1 0%, #ffe0ea 100%)",
  },
] as const;

const HOW_IT_WORKS = [
  {
    number: "01",
    title: "You schedule",
    body: "Choose date & 2-hour window.",
  },
  {
    number: "02",
    title: "We collect",
    body: "Our concierge arrives at your home or office.",
  },
  {
    number: "03",
    title: "We care",
    body: "Expert cleaning with meticulous attention.",
  },
  {
    number: "04",
    title: "We return",
    body: "On your schedule, perfectly presented.",
  },
] as const;

const HERO_VALUE_POINTS = [
  { icon: ShieldCheck, label: "Door-to-door service" },
  { icon: Sparkles, label: "Expert garment care" },
  { icon: Star, label: "Five-star trusted" },
] as const;

const CONCIERGE_FEATURES = [
  { icon: ShieldCheck, label: "Concierge manner" },
  { icon: Sparkles, label: "White-glove handling" },
  { icon: Clock3, label: "Delivered on your schedule" },
  { icon: Leaf, label: "Sustainably minded" },
] as const;

const FAQ_ITEMS = [
  {
    q: "How soon can you pick up?",
    a: "Pickups are offered in 2-hour windows across Beverly Hills and Century City, with same-day return available for qualifying orders.",
  },
  {
    q: "What if I have garment preferences?",
    a: "Use Special Instructions during booking. We save your preferences after first service and apply them automatically on future orders.",
  },
  {
    q: "Do you service every neighborhood?",
    a: "We focus on select residences in Beverly Hills and Century City to maintain concierge-level consistency and timing.",
  },
  {
    q: "Is my payment secure?",
    a: "Yes. Card details are handled by Stripe. Your card is saved securely and charged only when your order is processed.",
  },
] as const;

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ borderColor: COLORS.border, color: "#946575", background: "#fff" }}>
      {children}
    </span>
  );
}

export default function Home() {
  const { tenant } = useTenant();
  const [showModal, setShowModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const bookingRef = useRef<HTMLDivElement | null>(null);

  const phoneHref = useMemo(
    () => `tel:${tenant.supportPhone.replace(/[^\d+]/g, "")}`,
    [tenant.supportPhone]
  );

  const handleScheduleClick = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setShowModal(true);
      return;
    }

    bookingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: COLORS.page, color: COLORS.copy }}>
      <div className="border-b border-white/30 text-[12px]" style={{ background: "linear-gradient(90deg, #2f4f45 0%, #204137 100%)", color: "#f8f8f6" }}>
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-3 sm:gap-5">
            <span className="font-medium">We&apos;re here for you</span>
            <a href={phoneHref} className="inline-flex items-center gap-1.5 text-white/90 hover:text-white">
              <Clock3 className="h-3.5 w-3.5" aria-hidden />
              {tenant.supportPhone}
            </a>
            <span className="inline-flex items-center gap-1.5 text-white/90">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              Beverly Hills &amp; Century City
            </span>
          </div>
          <div className="flex items-center gap-4 text-white/90">
            <a href="#concierge" className="hover:text-white">Concierge partners</a>
            <a href="/admin" className="hover:text-white">Log in</a>
          </div>
        </div>
      </div>

      <header className="sticky top-0 z-40 border-b backdrop-blur-xl" style={{ borderColor: COLORS.border, background: "rgba(255,247,245,0.9)" }}>
        <div className="mx-auto flex h-[76px] max-w-[1280px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex min-w-0 items-center gap-3">
            <img
              src={tenant.logoUrl || ASSETS.logoFull}
              alt={tenant.brandName}
              className="h-10 w-auto max-w-[210px] object-contain"
            />
          </a>

          <nav className="hidden items-center gap-6 text-[14px] font-medium lg:flex" style={{ color: COLORS.copySoft }}>
            <a href="#services" className="transition-colors hover:text-[#492636]">Services</a>
            <a href="#how-it-works" className="transition-colors hover:text-[#492636]">How It Works</a>
            <a href="#concierge" className="transition-colors hover:text-[#492636]">Our Standards</a>
            <a href="#pricing-menu" className="transition-colors hover:text-[#492636]">Pricing</a>
            <a href="#about" className="transition-colors hover:text-[#492636]">About</a>
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleScheduleClick}
              className="hidden rounded-full px-5 py-2.5 text-[14px] font-semibold text-white shadow-[0_12px_24px_rgba(178,31,97,0.35)] transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(178,31,97,0.4)] sm:inline-flex sm:items-center sm:gap-2"
              style={{ background: `linear-gradient(135deg, ${COLORS.accent} 0%, ${COLORS.accentDark} 100%)` }}
            >
              Schedule Pickup
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border lg:hidden"
              style={{ borderColor: COLORS.border, color: COLORS.copySoft }}
              aria-label="Toggle menu"
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div className="border-t px-4 py-3 lg:hidden" style={{ borderColor: COLORS.border, background: COLORS.card }}>
            <nav className="flex flex-col gap-2 text-[14px] font-medium">
              <a href="#services" className="rounded-lg px-3 py-2 hover:bg-[#fff0f7]" onClick={() => setMenuOpen(false)}>Services</a>
              <a href="#how-it-works" className="rounded-lg px-3 py-2 hover:bg-[#fff0f7]" onClick={() => setMenuOpen(false)}>How It Works</a>
              <a href="#concierge" className="rounded-lg px-3 py-2 hover:bg-[#fff0f7]" onClick={() => setMenuOpen(false)}>Our Standards</a>
              <a href="#pricing-menu" className="rounded-lg px-3 py-2 hover:bg-[#fff0f7]" onClick={() => setMenuOpen(false)}>Pricing</a>
              <a href="#about" className="rounded-lg px-3 py-2 hover:bg-[#fff0f7]" onClick={() => setMenuOpen(false)}>About</a>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setShowModal(true);
                }}
                className="mt-1 rounded-xl px-4 py-3 text-left text-[14px] font-semibold text-white"
                style={{ background: `linear-gradient(135deg, ${COLORS.accent} 0%, ${COLORS.accentDark} 100%)` }}
              >
                Schedule Pickup
              </button>
            </nav>
          </div>
        ) : null}
      </header>

      <main id="top">
        <section className="relative overflow-hidden border-b" style={{ borderColor: COLORS.border }}>
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden
            style={{
              background:
                "radial-gradient(circle at 12% 18%, rgba(255,214,230,0.58), transparent 40%), radial-gradient(circle at 82% 16%, rgba(243,206,189,0.42), transparent 38%), linear-gradient(180deg, #fff7f5 0%, #fff2f0 100%)",
            }}
          />

          <div className="relative mx-auto grid max-w-[1320px] gap-5 px-4 py-8 sm:px-6 lg:grid-cols-12 lg:px-8 lg:py-10">
            <div className="lg:col-span-4">
              <div className="rounded-[26px] border bg-[rgba(255,251,249,0.92)] p-5 shadow-[0_18px_38px_rgba(158,89,122,0.18)] sm:p-6" style={{ borderColor: COLORS.border }}>
                <Pill>Experience a standard of care</Pill>

                <h1 className="mt-4 text-[clamp(34px,5.1vw,62px)] leading-[0.98] tracking-[-0.02em] text-[#2f1a24]" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>
                  Impeccable care.
                  <br />
                  <span style={{ color: COLORS.accent, fontStyle: "italic", fontWeight: 500 }}>
                    Effortless living.
                  </span>
                </h1>

                <p className="mt-4 max-w-[30ch] text-[15px] leading-relaxed" style={{ color: COLORS.copySoft }}>
                  Concierge laundry &amp; dry cleaning for Beverly Hills and Century City residences.
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleScheduleClick}
                    className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold text-white shadow-[0_12px_24px_rgba(178,31,97,0.35)] transition-all hover:-translate-y-0.5"
                    style={{ background: `linear-gradient(135deg, ${COLORS.accent} 0%, ${COLORS.accentDark} 100%)` }}
                  >
                    Schedule Pickup
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>

                  <a
                    href="#pricing-menu"
                    className="inline-flex items-center gap-1 rounded-full border px-4 py-2.5 text-[14px] font-medium transition-colors hover:bg-[#fff2f8]"
                    style={{ borderColor: COLORS.border, color: "#714d5b" }}
                  >
                    View pricing
                  </a>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {HERO_VALUE_POINTS.map(({ icon: Icon, label }) => (
                    <div key={label} className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-[12px]" style={{ borderColor: COLORS.border, color: "#7c5868" }}>
                      <Icon className="h-3.5 w-3.5 text-[#bd2b69]" aria-hidden />
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-4">
              <div className="relative h-full min-h-[420px] overflow-hidden rounded-[28px] border shadow-[0_20px_36px_rgba(158,89,122,0.2)]" style={{ borderColor: COLORS.border }}>
                <img
                  src={ASSETS.hero}
                  alt="Laundry Butler concierge presenting carefully packaged garments"
                  className="h-full w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/35 to-transparent" />
                <div className="absolute bottom-4 left-4 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-[#684654] backdrop-blur">
                  Concierge Service
                </div>
              </div>
            </div>

            <div className="hidden lg:col-span-4 lg:block" id="booking" ref={bookingRef}>
              <SchedulePickupRail className="sticky top-[108px]" />
            </div>
          </div>
        </section>

        <section className="border-b py-5" style={{ borderColor: COLORS.border, background: "#fff" }}>
          <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-3 px-4 sm:px-6 lg:px-8">
            <p className="mr-2 text-[14px] font-medium" style={{ color: "#5d3f4c" }}>
              Trusted by busy professionals and families in Beverly Hills &amp; Century City
            </p>
            {[
              "2-Hour Pickup Window",
              "Same Day Return Available",
              "5.0 ★★★★★ Client Rating",
              "Sustainably Minded",
            ].map((item) => (
              <span
                key={item}
                className="inline-flex items-center rounded-full border px-3 py-1 text-[12px] font-semibold"
                style={{ borderColor: COLORS.border, background: COLORS.card, color: "#7a5765" }}
              >
                {item}
              </span>
            ))}
          </div>
        </section>

        <section id="services" className="mx-auto max-w-[1280px] px-4 py-14 sm:px-6 lg:px-8">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#a77085" }}>
                Services & Pricing
              </p>
              <h2 className="mt-1 text-[clamp(28px,3vw,42px)] leading-[1.1]" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>
                Premium care for every part of your life.
              </h2>
            </div>
            <button
              type="button"
              onClick={handleScheduleClick}
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-semibold text-white"
              style={{ background: `linear-gradient(135deg, ${COLORS.accent} 0%, ${COLORS.accentDark} 100%)` }}
            >
              Schedule Pickup
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {SERVICE_CARDS.map((service) => (
              <article
                key={service.title}
                className="rounded-[24px] border p-5 shadow-[0_12px_28px_rgba(158,89,122,0.1)]"
                style={{ borderColor: COLORS.border, background: service.gradient }}
              >
                <h3 className="text-[25px] leading-tight" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>{service.title}</h3>
                <p className="mt-1 text-[16px] font-semibold" style={{ color: COLORS.accentDark }}>{service.price}</p>
                <ul className="mt-4 space-y-1.5">
                  {service.bullets.map((bullet) => (
                    <li key={bullet} className="inline-flex items-start gap-2 text-[14px] leading-relaxed" style={{ color: COLORS.copySoft }}>
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ba2b66]" aria-hidden />
                      {bullet}
                    </li>
                  ))}
                </ul>
                <a
                  href={service.href}
                  className="mt-5 inline-flex items-center gap-1 text-[14px] font-semibold"
                  style={{ color: COLORS.accentDark }}
                >
                  {service.cta}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </a>
              </article>
            ))}
          </div>

          <div
            id="pricing-menu"
            className="mt-7 rounded-[22px] border bg-white p-4 shadow-[0_12px_26px_rgba(138,74,103,0.08)] sm:p-5"
            style={{ borderColor: COLORS.border }}
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[19px] font-semibold text-[#381d28]">Dry Cleaning Pricing Menu</h3>
              <span className="rounded-full bg-[#ffe8f2] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#b02663]">
                Live from catalog
              </span>
            </div>
            <CatalogDryCleanPricing variant="butler" maxHeightClass="max-h-[280px]" />
          </div>
        </section>

        <section id="how-it-works" className="border-y py-14" style={{ borderColor: COLORS.border, background: COLORS.card }}>
          <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#a77085" }}>
              How It Works
            </p>
            <h2 className="mt-1 text-[clamp(28px,3vw,42px)] leading-[1.1]" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>
              Four simple steps.
            </h2>

            <div className="mt-6 grid gap-3 md:grid-cols-4">
              {HOW_IT_WORKS.map((item) => (
                <article key={item.number} className="rounded-2xl border bg-white p-4" style={{ borderColor: COLORS.border }}>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#b22a67" }}>
                    {item.number}
                  </span>
                  <h3 className="mt-2 text-[18px] font-semibold text-[#35202a]">{item.title}</h3>
                  <p className="mt-1 text-[14px] leading-relaxed" style={{ color: COLORS.copySoft }}>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          id="concierge"
          className="relative overflow-hidden py-14 text-white"
          style={{ background: "linear-gradient(120deg, #1f3a33 0%, #20332e 50%, #173028 100%)" }}
        >
          <div className="absolute right-0 top-0 hidden h-full w-[38%] lg:block">
            <img src={ASSETS.support} alt="Concierge shirt presentation" className="h-full w-full object-cover opacity-70" />
          </div>

          <div className="relative mx-auto grid max-w-[1280px] gap-7 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
            <div className="lg:col-span-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">Our Standards</p>
              <h2 className="mt-1 text-[clamp(30px,3.2vw,44px)] leading-[1.1]" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>
                Built for high-rise life. Concierge-ready.
              </h2>
              <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-white/85">
                We deliver the elevated experience your lifestyle demands.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {CONCIERGE_FEATURES.map(({ icon: Icon, label }) => (
                  <div key={label} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-[14px]">
                    <Icon className="h-4 w-4 text-[#ffd0e5]" aria-hidden />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-[1280px] gap-6 px-4 py-14 sm:px-6 lg:grid-cols-12 lg:px-8">
          <div className="lg:col-span-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#a77085" }}>
              Service Area
            </p>
            <h2 className="mt-1 text-[clamp(26px,2.7vw,38px)] leading-[1.12]" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>
              Proudly serving select residences in Beverly Hills and Century City.
            </h2>

            <div className="mt-5 rounded-[24px] border p-4" style={{ borderColor: COLORS.border, background: "linear-gradient(140deg, #fff9f7 0%, #ffeef5 100%)" }}>
              <div className="grid grid-cols-2 gap-3 text-[14px]" style={{ color: COLORS.copySoft }}>
                {[
                  "Beverly Hills",
                  "Century City",
                  "Wilshire Corridor",
                  "Little Santa Monica",
                  "Luxury Towers",
                  "Select Concierge Buildings",
                ].map((area) => (
                  <div key={area} className="rounded-lg border bg-white px-3 py-2" style={{ borderColor: COLORS.border }}>
                    {area}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-7" id="about">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#a77085" }}>
              FAQ
            </p>
            <h2 className="mt-1 text-[clamp(26px,2.7vw,38px)] leading-[1.12]" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>
              Answers to the things you ask most.
            </h2>

            <div className="mt-5 rounded-[24px] border bg-white px-5 py-2" style={{ borderColor: COLORS.border }}>
              <Accordion type="single" collapsible>
                {FAQ_ITEMS.map((item) => (
                  <AccordionItem key={item.q} value={item.q} className="border-[#f0dfe6]">
                    <AccordionTrigger className="text-[15px] font-semibold text-[#39222d] hover:no-underline">
                      {item.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-[14px] leading-relaxed text-[#7f5f6d]">
                      {item.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        </section>

        <section className="pb-14">
          <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
            <div className="rounded-[26px] border p-6 text-white shadow-[0_18px_34px_rgba(137,58,95,0.35)] sm:p-7" style={{ borderColor: "#7a1e49", background: "linear-gradient(120deg, #c22a67 0%, #951349 100%)" }}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-[clamp(26px,2.8vw,40px)] leading-[1.1]" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>
                    Experience laundry service that respects your time.
                  </h2>
                  <p className="mt-2 text-[15px] text-white/85">Schedule your pickup in under 60 seconds.</p>
                </div>
                <button
                  type="button"
                  onClick={handleScheduleClick}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-[15px] font-semibold text-[#9f1e53]"
                >
                  Schedule Pickup
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t" style={{ borderColor: COLORS.border, background: "#1f3a33", color: "#ebefe8" }}>
        <div className="mx-auto grid max-w-[1280px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-2 lg:grid-cols-5 lg:px-8">
          <div className="lg:col-span-2">
            <img
              src={tenant.logoUrl || ASSETS.logoFull}
              alt={tenant.brandName}
              className="h-10 w-auto max-w-[220px] object-contain"
            />
            <p className="mt-3 max-w-[40ch] text-[13px] leading-relaxed text-[#d7dfd4]">
              Premium laundry and dry cleaning concierge service for Beverly Hills and Century City residences.
            </p>
          </div>

          <div>
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-white">Services</h3>
            <ul className="mt-3 space-y-2 text-[13px] text-[#d7dfd4]">
              <li><a href="#services" className="hover:text-white">Wash &amp; Fold</a></li>
              <li><a href="#services" className="hover:text-white">Dry Cleaning</a></li>
              <li><a href="#pricing-menu" className="hover:text-white">Specialty Care</a></li>
            </ul>
          </div>

          <div>
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-white">Company</h3>
            <ul className="mt-3 space-y-2 text-[13px] text-[#d7dfd4]">
              <li><a href="#about" className="hover:text-white">About</a></li>
              <li><a href="#how-it-works" className="hover:text-white">How It Works</a></li>
              <li><a href="#concierge" className="hover:text-white">Our Standards</a></li>
            </ul>
          </div>

          <div>
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-white">Concierge Support</h3>
            <ul className="mt-3 space-y-2 text-[13px] text-[#d7dfd4]">
              <li><a href={phoneHref} className="hover:text-white">Call {tenant.supportPhone}</a></li>
              <li><a href="#services" className="hover:text-white">Service area details</a></li>
              <li><a href="/admin" className="hover:text-white">Log in</a></li>
            </ul>
          </div>
        </div>
      </footer>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white px-4 py-3 shadow-[0_-12px_24px_rgba(63,26,43,0.12)] lg:hidden" style={{ borderColor: COLORS.border }}>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold text-white"
          style={{ background: `linear-gradient(135deg, ${COLORS.accent} 0%, ${COLORS.accentDark} 100%)` }}
        >
          Schedule Pickup
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {showModal ? <SchedulePickupModal onClose={() => setShowModal(false)} /> : null}
    </div>
  );
}
