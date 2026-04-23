import { useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarCheck2,
  Check,
  Clock3,
  Leaf,
  MapPin,
  Menu,
  PackageCheck,
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

const C = {
  page: "#fff7f5",
  surface: "#fffaf9",
  surfaceSoft: "#fff2ef",
  border: "#eddce4",
  text: "#2f1b24",
  textMuted: "#7f5e6d",
  pink: "#d42f76",
  pinkDeep: "#b21a5c",
  pinkSoft: "#ffe5f1",
  deepGreen: "#1f3a33",
} as const;

const ASSETS = {
  hero: "/butler/hero-premium.png",
  logoFull:
    "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/WZKCbJMLcYxTxbBz.png",
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
    accent: "#d42f76",
    gradient: "linear-gradient(145deg, #fffdfd 0%, #ffeaf2 100%)",
  },
  {
    title: "Dry Cleaning",
    price: "From $6.00",
    bullets: ["Silk / Blouse", "Wool / Blazer", "Designer / Dress", "Pant / Trousers"],
    cta: "View full pricing",
    href: "#pricing-menu",
    accent: "#9f2659",
    gradient: "linear-gradient(145deg, #fffefc 0%, #ffeef6 100%)",
  },
  {
    title: "Specialty Care",
    price: "From $25.00",
    bullets: [
      "Hand-finished items",
      "Heirlooms & fine fabrics",
      "Weddings & evening wear",
      "Concierge consultation",
    ],
    cta: "View service details",
    href: "#pricing-menu",
    accent: "#7f2f53",
    gradient: "linear-gradient(145deg, #fffdf9 0%, #ffe9f1 100%)",
  },
] as const;

const HOW_IT_WORKS = [
  {
    number: "01",
    title: "You schedule",
    body: "Choose date & 2-hour window.",
    icon: CalendarCheck2,
  },
  {
    number: "02",
    title: "We collect",
    body: "Our concierge arrives at your home or office.",
    icon: MapPin,
  },
  {
    number: "03",
    title: "We care",
    body: "Expert cleaning with meticulous attention.",
    icon: Sparkles,
  },
  {
    number: "04",
    title: "We return",
    body: "On your schedule, perfectly presented.",
    icon: PackageCheck,
  },
] as const;

const FAQ_ITEMS = [
  {
    q: "How soon can you pick up?",
    a: "Pickups run in 2-hour windows across Beverly Hills and Century City, with same-day return available on qualifying orders.",
  },
  {
    q: "What if I have garment preferences?",
    a: "Add details in Special Instructions. Preferences are saved after your first order for future pickups.",
  },
  {
    q: "Is Specialty Care bookable online?",
    a: "Specialty Care is currently listed for pricing and consultation. Booking checkout remains Wash & Fold and Dry Cleaning.",
  },
  {
    q: "Is payment secure?",
    a: "Yes. Card details are secured with Stripe and charged only when your order is processed.",
  },
] as const;

export default function Home() {
  const { tenant } = useTenant();
  const [showModal, setShowModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const bookingRef = useRef<HTMLDivElement | null>(null);

  const phoneHref = useMemo(
    () => `tel:${tenant.supportPhone.replace(/[^\d+]/g, "")}`,
    [tenant.supportPhone]
  );

  const openBooking = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setShowModal(true);
      return;
    }

    bookingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: C.page, color: C.text }}>
      <div
        className="border-b border-white/20 text-[12px]"
        style={{ background: "linear-gradient(90deg, #2d4f44 0%, #1f4035 100%)", color: "#f7f7f6" }}
      >
        <div className="mx-auto flex max-w-[1300px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-3.5 sm:gap-5">
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

      <header
        className="sticky top-0 z-40 border-b backdrop-blur-xl"
        style={{ borderColor: C.border, background: "rgba(255,247,245,0.92)" }}
      >
        <div className="mx-auto flex h-[78px] max-w-[1300px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex min-w-0 items-center">
            <img
              src={tenant.logoUrl || ASSETS.logoFull}
              alt={tenant.brandName}
              className="h-10 w-auto max-w-[215px] object-contain"
            />
          </a>

          <nav className="hidden items-center gap-7 text-[14px] font-medium lg:flex" style={{ color: C.textMuted }}>
            <a href="#services" className="transition-colors hover:text-[#432432]">Services</a>
            <a href="#how-it-works" className="transition-colors hover:text-[#432432]">How It Works</a>
            <a href="#concierge" className="transition-colors hover:text-[#432432]">Our Standards</a>
            <a href="#pricing-menu" className="transition-colors hover:text-[#432432]">Pricing</a>
            <a href="#about" className="transition-colors hover:text-[#432432]">About</a>
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openBooking}
              className="hidden items-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-semibold text-white shadow-[0_12px_22px_rgba(178,31,97,0.34)] transition-all hover:-translate-y-0.5 sm:inline-flex"
              style={{ background: `linear-gradient(135deg, ${C.pink} 0%, ${C.pinkDeep} 100%)` }}
            >
              Schedule Pickup
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border lg:hidden"
              style={{ borderColor: C.border, color: C.textMuted }}
              aria-label="Toggle menu"
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div className="border-t px-4 py-3 lg:hidden" style={{ borderColor: C.border, background: C.surface }}>
            <nav className="flex flex-col gap-1.5 text-[14px] font-medium">
              {["services", "how-it-works", "concierge", "pricing-menu", "about"].map((id) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="rounded-xl px-3 py-2 hover:bg-[#fff0f7]"
                  onClick={() => setMenuOpen(false)}
                >
                  {id === "services"
                    ? "Services"
                    : id === "how-it-works"
                      ? "How It Works"
                      : id === "concierge"
                        ? "Our Standards"
                        : id === "pricing-menu"
                          ? "Pricing"
                          : "About"}
                </a>
              ))}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setShowModal(true);
                }}
                className="mt-1 rounded-xl px-4 py-3 text-left text-[14px] font-semibold text-white"
                style={{ background: `linear-gradient(135deg, ${C.pink} 0%, ${C.pinkDeep} 100%)` }}
              >
                Schedule Pickup
              </button>
            </nav>
          </div>
        ) : null}
      </header>

      <main id="top">
        <section className="relative overflow-hidden border-b" style={{ borderColor: C.border }}>
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden
            style={{
              background:
                "radial-gradient(circle at 8% 18%, rgba(255,209,227,0.62), transparent 42%), radial-gradient(circle at 84% 12%, rgba(255,225,205,0.52), transparent 38%), linear-gradient(180deg, #fff8f6 0%, #fff2ef 100%)",
            }}
          />

          <div className="relative mx-auto max-w-[1320px] px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
            <div
              className="relative overflow-hidden rounded-[34px] border shadow-[0_24px_46px_rgba(149,77,110,0.2)]"
              style={{ borderColor: C.border, background: "linear-gradient(150deg, #fffbfa 0%, #fff0f4 100%)" }}
            >
              <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden>
                <img
                  src={ASSETS.hero}
                  alt=""
                  className="h-full w-full object-cover object-[57%_42%]"
                />
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,248,246,0.82)_0%,rgba(255,248,246,0.56)_25%,rgba(255,248,246,0.08)_54%,rgba(255,248,246,0.3)_100%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_15%,rgba(255,235,244,0.62),transparent_45%)]" />
                <div className="absolute inset-y-0 right-0 w-[46%] bg-gradient-to-l from-[rgba(255,247,245,0.65)] via-[rgba(255,247,245,0.4)] to-transparent" />
              </div>

              <div className="relative grid gap-5 p-4 sm:p-5 lg:min-h-[640px] lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)_minmax(0,390px)] lg:gap-6 lg:p-6">
                <div className="lg:relative lg:z-10 lg:flex lg:items-start">
                  <div
                    className="w-full rounded-[30px] border bg-[rgba(255,251,249,0.94)] p-5 shadow-[0_22px_38px_rgba(149,77,110,0.18)] backdrop-blur-[1.2px] sm:p-6 lg:max-w-[390px] lg:pt-7"
                    style={{ borderColor: C.border }}
                  >
                    <span
                      className="inline-flex items-center rounded-full border px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em]"
                      style={{ borderColor: "#edcddc", background: "#fff", color: "#966273" }}
                    >
                      Experience a standard of care
                    </span>

                    <h1
                      className="mt-4 text-[clamp(36px,4.65vw,64px)] leading-[0.92] tracking-[-0.02em] text-[#2f1a24]"
                      style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}
                    >
                      <span className="block">Impeccable care.</span>
                      <span className="mt-1 block italic text-[#c22b6a]">Effortless living.</span>
                    </h1>

                    <p className="mt-4 max-w-[31ch] text-[15px] leading-relaxed text-[#755564]">
                      Concierge laundry &amp; dry cleaning for Beverly Hills and Century City residences.
                    </p>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={openBooking}
                        className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-[15px] font-semibold text-white shadow-[0_16px_28px_rgba(178,31,97,0.38)] transition-all hover:-translate-y-0.5"
                        style={{ background: `linear-gradient(135deg, ${C.pink} 0%, ${C.pinkDeep} 100%)` }}
                      >
                        Schedule Pickup
                        <ArrowRight className="h-4 w-4" aria-hidden />
                      </button>

                      <a
                        href="#pricing-menu"
                        className="inline-flex items-center gap-1 rounded-full border px-4 py-2.5 text-[14px] font-medium transition-colors hover:bg-[#fff2f8]"
                        style={{ borderColor: C.border, color: "#734f5e" }}
                      >
                        View pricing
                      </a>
                    </div>

                    <div className="mt-6 grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
                      {[
                        [ShieldCheck, "Door-to-door service"],
                        [Sparkles, "Expert garment care"],
                        [Star, "Five-star trusted"],
                      ].map(([Icon, label]) => (
                        <div
                          key={label}
                          className="inline-flex items-center gap-2 rounded-2xl border bg-white px-3 py-2 text-[12.5px]"
                          style={{ borderColor: C.border, color: "#7c5868" }}
                        >
                          <Icon className="h-3.5 w-3.5 text-[#bd2b69]" aria-hidden />
                          {label}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="relative h-full min-h-[430px] overflow-hidden rounded-[30px] border shadow-[0_20px_34px_rgba(149,77,110,0.2)] lg:hidden" style={{ borderColor: C.border }}>
                  <img
                    src={ASSETS.hero}
                    alt="Laundry Butler concierge preparing a garment in a luxury residence"
                    className="h-full w-full object-cover object-[56%_45%]"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/28 via-black/0 to-black/0" />
                  <div className="absolute bottom-4 left-4 rounded-full bg-white/88 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#674652] backdrop-blur">
                    Concierge Service
                  </div>
                </div>

                <div className="hidden lg:block" aria-hidden />

                <div className="hidden lg:block" id="booking" ref={bookingRef}>
                  <SchedulePickupRail className="sticky top-[108px]" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b py-5" style={{ borderColor: C.border, background: "#fff" }}>
          <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
            <div
              className="rounded-[22px] border px-3 py-3 sm:px-4 sm:py-3.5 lg:px-5"
              style={{ borderColor: C.border, background: "linear-gradient(150deg, #fffdfa 0%, #fff3f6 100%)" }}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
                <p className="text-[13.5px] font-medium leading-relaxed text-[#5f3f4e] lg:w-[36%] lg:pr-2">
                  Trusted by busy professionals and families in Beverly Hills &amp; Century City
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:w-[64%] lg:grid-cols-4">
                  {[
                    [Clock3, "2-Hour Pickup"],
                    [PackageCheck, "Same-Day Return"],
                    [Star, "5.0 Client Rating"],
                    [Leaf, "Sustainably Minded"],
                  ].map(([Icon, label]) => (
                    <div
                      key={label}
                      className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold"
                      style={{ borderColor: C.border, background: "#fff", color: "#765765" }}
                    >
                      <Icon className="h-3.5 w-3.5 text-[#b22b66]" aria-hidden />
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="services" className="mx-auto max-w-[1300px] px-4 py-14 sm:px-6 lg:px-8 lg:py-16">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#a77085" }}>
                Services & Pricing
              </p>
              <h2 className="mt-1 text-[clamp(30px,3vw,44px)] leading-[1.08]" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>
                Premium care for every part of your life.
              </h2>
            </div>
            <button
              type="button"
              onClick={openBooking}
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-semibold text-white"
              style={{ background: `linear-gradient(135deg, ${C.pink} 0%, ${C.pinkDeep} 100%)` }}
            >
              Schedule Pickup
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="grid items-stretch gap-4 md:grid-cols-3 lg:gap-5">
            {SERVICE_CARDS.map((service) => (
              <article
                key={service.title}
                className="flex h-full flex-col rounded-[26px] border p-5 shadow-[0_12px_28px_rgba(149,77,110,0.1)]"
                style={{ borderColor: C.border, background: service.gradient }}
              >
                <div
                  className="mb-3 h-1.5 w-14 rounded-full"
                  style={{ background: `linear-gradient(90deg, ${service.accent} 0%, #ed8eb7 100%)` }}
                />
                <h3 className="text-[25px] leading-tight" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>
                  {service.title}
                </h3>
                <p className="mt-1 text-[17px] font-semibold" style={{ color: service.accent }}>
                  {service.price}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {service.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2 text-[14px] leading-relaxed" style={{ color: C.textMuted }}>
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ba2b66]" aria-hidden />
                      {bullet}
                    </li>
                  ))}
                </ul>
                <a
                  href={service.href}
                  className="mt-6 inline-flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold"
                  style={{ borderColor: "#ebcddd", color: service.accent }}
                >
                  {service.cta}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </a>
              </article>
            ))}
          </div>

          <div
            id="pricing-menu"
            className="mt-8 rounded-[28px] border p-5 shadow-[0_16px_32px_rgba(149,77,110,0.1)] sm:p-6"
            style={{ borderColor: C.border, background: "linear-gradient(170deg, #fffcfb 0%, #fff3f6 100%)" }}
          >
            <div className="grid gap-5 lg:grid-cols-[1.1fr_1.9fr] lg:items-start">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9a6b7f]">Dry Cleaning Menu</p>
                <h3 className="mt-1 text-[26px] leading-tight text-[#331d27]" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>
                  Refined pricing,
                  <br />
                  clearly presented.
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[#7b5c69]">
                  Live catalog-backed pricing grouped by garment category for quick comparison and clean decision making.
                </p>
              </div>
              <CatalogDryCleanPricing variant="butler" preview previewRowsPerCategory={4} />
            </div>
          </div>
        </section>

        <section id="how-it-works" className="border-y py-14 lg:py-16" style={{ borderColor: C.border, background: C.surface }}>
          <div className="mx-auto max-w-[1300px] px-4 sm:px-6 lg:px-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#a77085" }}>
              How It Works
            </p>
            <h2 className="mt-1 text-[clamp(30px,3vw,44px)] leading-[1.08]" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>
              Four simple steps.
            </h2>

            <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:hidden">
              {HOW_IT_WORKS.map((step) => {
                const Icon = step.icon;
                return (
                  <article key={step.number} className="rounded-2xl border bg-white p-4" style={{ borderColor: C.border }}>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#b22966]">
                      {step.number}
                    </span>
                    <div className="mt-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#ffe8f2] text-[#b22966]">
                      <Icon className="h-4.5 w-4.5" aria-hidden />
                    </div>
                    <h3 className="mt-3 text-[18px] font-semibold text-[#35202a]">{step.title}</h3>
                    <p className="mt-1 text-[14px] leading-relaxed text-[#7f5f6d]">{step.body}</p>
                  </article>
                );
              })}
            </div>

            <div className="relative mt-10 hidden lg:block">
              <div
                className="pointer-events-none absolute left-[9%] right-[9%] top-[58px] h-px"
                style={{ background: "linear-gradient(90deg, transparent 0%, #e7cfda 16%, #e7cfda 84%, transparent 100%)" }}
                aria-hidden
              />

              <div className="grid grid-cols-4 gap-4">
                {HOW_IT_WORKS.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <article
                      key={step.number}
                      className="relative rounded-[24px] border bg-white px-5 pb-5 pt-4 shadow-[0_12px_24px_rgba(147,76,110,0.08)]"
                      style={{ borderColor: C.border }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#b22966]">
                          {step.number}
                        </span>
                        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#f0d5e1] bg-[#fff1f8] text-[#b22966]">
                          <Icon className="h-4.5 w-4.5" aria-hidden />
                        </div>
                      </div>
                      <h3 className="mt-4 text-[20px] font-semibold text-[#35202a]">{step.title}</h3>
                      <p className="mt-2 text-[14px] leading-relaxed text-[#7f5f6d]">{step.body}</p>
                      {index < HOW_IT_WORKS.length - 1 ? (
                        <span
                          className="pointer-events-none absolute -right-2 top-[52px] h-4 w-4 rounded-full border border-[#e8d3dd] bg-white"
                          aria-hidden
                        />
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section id="concierge" className="py-14" style={{ background: C.deepGreen }}>
          <div className="mx-auto grid max-w-[1300px] gap-5 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
            <div className="rounded-[28px] border border-white/15 bg-white/[0.03] p-6 text-white lg:col-span-7 lg:p-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Our Standards</p>
              <h2 className="mt-1 text-[clamp(30px,3.2vw,44px)] leading-[1.08]" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>
                Built for high-rise life. Concierge-ready.
              </h2>
              <p className="mt-3 max-w-[58ch] text-[15px] leading-relaxed text-white/80">
                We deliver the elevated experience your lifestyle demands.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {[
                  [ShieldCheck, "Concierge manner"],
                  [Sparkles, "White-glove handling"],
                  [Clock3, "Delivered on your schedule"],
                  [Leaf, "Sustainably minded"],
                ].map(([Icon, label]) => (
                  <div key={label} className="inline-flex items-center gap-2 rounded-xl border border-white/18 bg-white/8 px-3 py-2 text-[14px] text-white/95">
                    <Icon className="h-4 w-4 text-[#ffd4e8]" aria-hidden />
                    {label}
                  </div>
                ))}
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[28px] border border-white/15 lg:col-span-5">
              <img
                src={ASSETS.hero}
                alt="Luxury garment service in a premium residence"
                className="h-full min-h-[360px] w-full object-cover object-[72%_46%]"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#12241f]/50 to-transparent" />
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-[1300px] gap-6 px-4 py-14 sm:px-6 lg:grid-cols-12 lg:px-8">
          <div className="lg:col-span-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#a77085" }}>
              Service Area
            </p>
            <h2 className="mt-1 text-[clamp(28px,2.8vw,40px)] leading-[1.1]" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>
              Proudly serving select residences in Beverly Hills and Century City.
            </h2>

            <div className="mt-5 rounded-[24px] border p-4" style={{ borderColor: C.border, background: "linear-gradient(140deg, #fff9f7 0%, #ffeef5 100%)" }}>
              <div className="grid grid-cols-2 gap-2.5 text-[13px]" style={{ color: C.textMuted }}>
                {[
                  "Beverly Hills",
                  "Century City",
                  "Wilshire Corridor",
                  "Little Santa Monica",
                  "Luxury Towers",
                  "Select Concierge Buildings",
                ].map((area) => (
                  <div key={area} className="rounded-xl border bg-white px-3 py-2" style={{ borderColor: C.border }}>
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
            <h2 className="mt-1 text-[clamp(28px,2.8vw,40px)] leading-[1.1]" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>
              Answers to the things you ask most.
            </h2>

            <div className="mt-5 rounded-[24px] border bg-white px-5 py-2 shadow-[0_10px_24px_rgba(149,77,110,0.08)]" style={{ borderColor: C.border }}>
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
          <div className="mx-auto max-w-[1300px] px-4 sm:px-6 lg:px-8">
            <div
              className="rounded-[28px] border p-6 text-white shadow-[0_18px_34px_rgba(137,58,95,0.35)] sm:p-7"
              style={{ borderColor: "#7a1e49", background: "linear-gradient(120deg, #c22a67 0%, #951349 100%)" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-[clamp(28px,2.9vw,40px)] leading-[1.08]" style={{ fontFamily: '"Fraunces", "Playfair Display", serif' }}>
                    Experience laundry service that respects your time.
                  </h2>
                  <p className="mt-2 text-[15px] text-white/85">Schedule your pickup in under 60 seconds.</p>
                </div>
                <button
                  type="button"
                  onClick={openBooking}
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

      <footer className="border-t" style={{ borderColor: C.border, background: "#1f3a33", color: "#ebefe8" }}>
        <div className="mx-auto grid max-w-[1300px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-2 lg:grid-cols-5 lg:px-8">
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

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 px-4 py-3 shadow-[0_-12px_24px_rgba(63,26,43,0.12)] backdrop-blur lg:hidden" style={{ borderColor: C.border }}>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold text-white"
          style={{ background: `linear-gradient(135deg, ${C.pink} 0%, ${C.pinkDeep} 100%)` }}
        >
          Schedule Pickup
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {showModal ? <SchedulePickupModal onClose={() => setShowModal(false)} /> : null}
    </div>
  );
}
