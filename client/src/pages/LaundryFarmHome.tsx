import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  ChevronDown,
  Mail,
  MapPin,
  Menu,
  PackageCheck,
  Phone,
  Shirt,
  Star,
  Truck,
  X,
} from "lucide-react";
import SchedulePickupModal from "@/components/SchedulePickupModal";
import { useTenant } from "@/hooks/useTenant";

/** Served from `client/public/laundry-farm/` */
const HERO_IMAGE = "/laundry-farm/hero.png";

const CARD_SHADOW = "shadow-[0_4px_20px_rgba(0,0,0,0.05)]";

const serif = { fontFamily: "'Playfair Display', Georgia, serif" } as const;

/** Google "G" multicolor — standard brand colors (simplified mark). */
function GoogleGMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" role="img">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

/** Yelp — trademark red with white burst (simplified vector mark). */
function YelpBurstMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" role="img">
      <circle cx="12" cy="12" r="12" fill="#FF1A1A" />
      <path
        fill="#fff"
        d="M12 5l1.8 5.4L19 12l-5.2 1.6L12 19l-1.8-5.4L5 12l5.2-1.6L12 5z"
      />
    </svg>
  );
}

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
  {
    name: "Sarah J.",
    platform: "Google" as const,
    text: "Perfectly clean and pressed every time. Pickup and delivery always on time.",
  },
  {
    name: "Sydney P.",
    platform: "Yelp" as const,
    text: "A laundry service I can trust. Quality is consistently excellent.",
  },
  {
    name: "Jessica L.",
    platform: "Google" as const,
    text: "So easy—schedule on the site and laundry is back the next day.",
  },
  {
    name: "David K.",
    platform: "Yelp" as const,
    text: "Best laundry service in LA. Professional team, results speak for themselves.",
  },
];

function Nav({ onBook, color, brandName }: { onBook: () => void; color: string; brandName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md shadow-sm">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-14">
        <button type="button" className="font-black text-lg tracking-tight" style={{ color }} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          {brandName.toLowerCase().replace(/\s+/g, "")}
        </button>
        <div className="hidden md:flex items-center gap-6 text-[13px] font-medium text-gray-600">
          <a href="#process" className="hover:text-gray-900 transition-colors">How it works</a>
          <a href="#pricing" className="hover:text-gray-900 transition-colors">Pricing</a>
          <a href="#faq" className="hover:text-gray-900 transition-colors">FAQ</a>
          <button type="button" onClick={onBook} className="text-white px-4 py-2 rounded-full text-[13px] font-semibold" style={{ backgroundColor: color }}>
            Schedule Pickup
          </button>
        </div>
        <button type="button" className="md:hidden text-gray-800" onClick={() => setOpen(v => !v)} aria-label="Menu">{open ? <X size={22} /> : <Menu size={22} />}</button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="md:hidden bg-white border-t overflow-hidden">
            <div className="px-6 py-4 space-y-3 text-sm font-medium">
              <a href="#process" onClick={() => setOpen(false)} className="block text-gray-800">How it works</a>
              <a href="#pricing" onClick={() => setOpen(false)} className="block text-gray-800">Pricing</a>
              <a href="#faq" onClick={() => setOpen(false)} className="block text-gray-800">FAQ</a>
              <button type="button" onClick={() => { onBook(); setOpen(false); }} className="block w-full text-white text-center py-3 rounded-full font-semibold" style={{ backgroundColor: color }}>
                Schedule Pickup
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

export default function LaundryFarmHome() {
  const { tenant } = useTenant();
  const [showModal, setShowModal] = useState(false);
  const color = tenant.primaryColor;
  const darkBand = "#0f2e26";

  return (
    <div className="min-h-screen bg-[#f8f6f3] font-sans text-gray-800 antialiased">
      <Nav onBook={() => setShowModal(true)} color={color} brandName={tenant.brandName} />

      {/* 1. Hero */}
      <section className="pt-14">
        <div className="max-w-7xl mx-auto px-5 sm:px-6 pt-7 md:pt-9 pb-5 md:pb-6">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="max-w-3xl">
            <h1
              className="text-[2.35rem] sm:text-[3.1rem] md:text-[3.75rem] lg:text-[4.25rem] font-bold leading-[1.05] tracking-[-0.03em] text-gray-950"
              style={serif}
            >
              Clean laundry. <span className="italic font-semibold" style={{ color }}>Delivered home.</span> Zero hassle.
            </h1>
            <p className="mt-4 text-base md:text-lg text-gray-600 max-w-xl leading-relaxed font-medium">
              Pickup and delivery across LA—fresh, folded, and ready when you need it. No laundromat runs.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-[15px] font-bold text-white transition-opacity hover:opacity-95"
                style={{ backgroundColor: color }}
              >
                Schedule Pickup
                <ArrowRight size={18} strokeWidth={2.5} />
              </button>
              <a
                href="#pricing"
                className="inline-flex items-center rounded-full border-[2.5px] border-gray-900/70 bg-white/95 px-6 py-3.5 text-[15px] font-bold text-gray-950 shadow-[0_2px_8px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-gray-900/20 transition-colors hover:bg-gray-50 hover:border-gray-900"
              >
                View Pricing
              </a>
            </div>
          </motion.div>
        </div>
        <div className="px-4 sm:px-6 pb-2">
          <div className={`mx-auto max-w-7xl overflow-hidden rounded-2xl ${CARD_SHADOW}`}>
            <div className="aspect-video w-full bg-gray-200">
              <img
                src={HERO_IMAGE}
                alt="Folded laundry in a sealed bag, delivered at your door"
                className="h-full w-full object-cover object-[center_35%]"
                width={1920}
                height={1080}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 2. Trust bar */}
      <section className="border-y border-black/[0.07] bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 md:py-3.5">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2.5 md:gap-x-6">
            <span className="text-[12px] md:text-[13px] font-bold uppercase tracking-wide text-gray-900 whitespace-nowrap">
              20,000+ Items Cleaned
            </span>
            <span className="hidden sm:block h-3 w-px shrink-0 bg-gray-300" aria-hidden="true" />
            <span className="text-[12px] md:text-[13px] font-bold uppercase tracking-wide text-gray-900 whitespace-nowrap">
              99.99% Success Rate
            </span>
            <span className="hidden sm:block h-3 w-px shrink-0 bg-gray-300" aria-hidden="true" />
            <div className="flex items-center gap-3 shrink-0">
              <span className="flex items-center gap-1.5" title="Google reviews">
                <GoogleGMark className="h-6 w-6 md:h-7 md:w-7" />
                <span className="text-[11px] font-bold text-gray-800">Google</span>
              </span>
              <span className="flex items-center gap-1.5" title="Yelp reviews">
                <YelpBurstMark className="h-6 w-6 md:h-7 md:w-7" />
                <span className="text-[11px] font-bold text-gray-800">Yelp</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. How it works */}
      <section id="process" className="bg-white py-14 md:py-16">
        <div className="max-w-6xl mx-auto px-5 sm:px-6">
          <div className="mb-8 md:mb-9 max-w-xl">
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] block mb-2" style={{ color }}>
              How it works
            </span>
            <h2 className="text-3xl md:text-[2.75rem] font-bold leading-[1.12] tracking-[-0.025em] text-gray-950" style={serif}>
              Three steps. <span className="italic font-semibold" style={{ color }}>Pick up, perfect, deliver.</span>
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4 md:gap-5">
            {[
              {
                title: "Book a pickup",
                blurb: "Choose a time window in under a minute.",
                Icon: CalendarClock,
              },
              {
                title: "We clean & fold",
                blurb: "Professional wash, dry, fold, and pressing.",
                Icon: Shirt,
              },
              {
                title: "We bring it back",
                blurb: "Neat bags at your door—often next-day.",
                Icon: Truck,
              },
            ].map(({ title, blurb, Icon }) => (
              <div key={title} className="flex gap-4 rounded-xl bg-[#f5f3f0] px-4 py-4 md:px-5 md:py-4">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white"
                  style={{ backgroundColor: color }}
                >
                  <Icon className="h-6 w-6" strokeWidth={2.5} aria-hidden />
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-gray-950 leading-tight">{title}</h3>
                  <p className="mt-1 text-[13px] leading-snug text-gray-600 font-medium">{blurb}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Stats band */}
      <section className="py-10 md:py-11 text-white" style={{ backgroundColor: darkBand }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-6 text-center sm:text-left">
            <div>
              <p className="text-3xl md:text-4xl font-bold tabular-nums tracking-tight" style={serif}>
                20,000+
              </p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Items cleaned</p>
            </div>
            <div>
              <p className="text-3xl md:text-4xl font-bold tabular-nums tracking-tight" style={serif}>
                99.99%
              </p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Success rate</p>
            </div>
            <div>
              <p className="text-3xl md:text-4xl font-bold tabular-nums tracking-tight" style={serif}>
                0
              </p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Damage reports</p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Pricing */}
      <section id="pricing" className="py-14 md:py-16 bg-[#f8f6f3]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6">
          <div className="text-center mb-8 md:mb-9">
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] block mb-2" style={{ color }}>
              Pricing
            </span>
            <h2 className="text-3xl md:text-[2.75rem] font-bold tracking-[-0.025em] text-gray-950" style={serif}>
              Straightforward <span className="italic font-semibold" style={{ color }}>per-item pricing.</span>
            </h2>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-3">
            {[
              { icon: ICONS.shirts, name: "Shirts", desc: "Washed & pressed", price: "$4.99" },
              { icon: ICONS.dress, name: "Dresses", desc: "Dry cleaned", price: "$11.50" },
              { icon: ICONS.serviceWash, name: "Service wash", desc: "Wash & fold", price: "$35.00" },
              { icon: ICONS.bedding, name: "Bedding", desc: "Wash & press", price: "$14.50" },
            ].map((item) => (
              <div
                key={item.name}
                className={`rounded-2xl bg-white px-4 py-5 md:px-5 md:py-6 text-center ${CARD_SHADOW}`}
              >
                <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100/90">
                  <img src={item.icon} alt="" className="h-11 w-11 object-contain drop-shadow-sm" />
                </div>
                <h3 className="font-bold text-sm md:text-[15px] text-gray-950">{item.name}</h3>
                <p className="text-[11px] md:text-xs mt-0.5 text-gray-500 font-medium">{item.desc}</p>
                <p className="mt-4 text-xl md:text-2xl font-extrabold tabular-nums" style={{ color }}>
                  {item.price}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-1">From</p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-bold text-white"
              style={{ backgroundColor: color }}
            >
              Schedule Pickup
              <PackageCheck className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </section>

      {/* 6. Reviews */}
      <section className="py-14 md:py-16 bg-white overflow-hidden">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 mb-6">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] block mb-2" style={{ color }}>
            Reviews
          </span>
          <h2 className="text-3xl md:text-[2.75rem] font-bold tracking-[-0.025em] text-gray-950" style={serif}>
            Trusted on <span className="italic font-semibold" style={{ color }}>Google & Yelp.</span>
          </h2>
        </div>
        <div className="max-w-6xl mx-auto px-5 sm:px-6 flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory md:flex-wrap md:justify-center md:overflow-visible">
          {REVIEWS.map((r, i) => (
            <article
              key={`${r.name}-${i}`}
              className={`min-w-[280px] max-w-[320px] shrink-0 snap-start rounded-2xl bg-[#faf9f7] px-5 py-5 md:min-w-0 md:flex-1 md:max-w-[calc(50%-0.5rem)] lg:max-w-[calc(25%-0.75rem)] ${CARD_SHADOW}`}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Star key={j} size={14} className="fill-amber-400 text-amber-400" aria-hidden />
                  ))}
                </div>
                {r.platform === "Google" ? (
                  <GoogleGMark className="h-5 w-5 shrink-0" />
                ) : (
                  <YelpBurstMark className="h-5 w-5 shrink-0" />
                )}
              </div>
              <p className="text-[13px] leading-relaxed text-gray-700 font-medium">&ldquo;{r.text}&rdquo;</p>
              <p className="mt-3 text-xs font-bold text-gray-900">
                {r.name}
                <span className="font-semibold text-gray-500"> · {r.platform}</span>
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* 7. FAQ */}
      <section id="faq" className="py-14 md:py-16 bg-[#f5f3f0]">
        <div className="max-w-2xl mx-auto px-5 sm:px-6">
          <h2 className="text-3xl md:text-[2.5rem] font-bold tracking-[-0.025em] text-gray-950 text-center mb-8" style={serif}>
            Quick answers
          </h2>
          {[
            { q: "How are payments processed?", a: "Major cards accepted. You pay after service—pricing is confirmed before we charge." },
            { q: "What if I am not home?", a: "Many customers leave bags at the door; we coordinate pickup and drop-off windows with you." },
            { q: "What areas do you cover?", a: "Greater Los Angeles—confirm your address at booking and we will flag if you are outside our route." },
          ].map(({ q, a }) => (
            <details key={q} className={`mb-3 rounded-xl bg-white px-4 py-3 group ${CARD_SHADOW}`}>
              <summary className="font-bold text-sm flex items-center justify-between cursor-pointer list-none text-gray-900">
                {q}
                <ChevronDown size={18} className="text-gray-400 shrink-0 group-open:rotate-180 transition-transform" />
              </summary>
              <p className="text-[13px] text-gray-600 mt-3 leading-relaxed font-medium pb-1">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 8. Footer */}
      <footer className="bg-[#0a0a0a] text-white py-10 md:py-11">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 grid md:grid-cols-3 gap-7 md:gap-8">
          <div>
            <span className="font-bold text-base tracking-tight" style={serif}>{tenant.brandName}</span>
            <p className="text-gray-500 text-xs mt-2 leading-relaxed max-w-xs">
              Professional pickup & delivery laundry. Trusted by busy households across LA.
            </p>
          </div>
          <div className="text-sm text-gray-400 space-y-2">
            <span className="flex items-center gap-2"><Phone size={14} className="shrink-0" /> {tenant.supportPhone}</span>
            <span className="flex items-center gap-2"><Mail size={14} className="shrink-0" /> {tenant.supportEmail}</span>
            <span className="flex items-center gap-2"><MapPin size={14} className="shrink-0" /> Los Angeles, CA</span>
          </div>
          <div className="text-sm text-gray-400 space-y-3">
            <div className="flex items-center gap-3">
              <GoogleGMark className="h-6 w-6 opacity-90" />
              <YelpBurstMark className="h-6 w-6 opacity-90" />
            </div>
            <button type="button" onClick={() => setShowModal(true)} className="inline-flex items-center gap-2 text-white font-semibold underline decoration-white/40 underline-offset-4 hover:decoration-white">
              Schedule Pickup <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      </footer>

      {showModal && <SchedulePickupModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
