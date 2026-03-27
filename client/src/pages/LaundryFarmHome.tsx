import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  Mail,
  MapPin,
  Menu,
  Phone,
  Star,
  X,
} from "lucide-react";
import SchedulePickupModal from "@/components/SchedulePickupModal";
import { useTenant } from "@/hooks/useTenant";

/** Served from `client/public/laundry-farm/` */
const HERO_IMAGE = "/laundry-farm/hero.png";
const PROCESS_MOCKUP = "/laundry-farm/book-pickup-mockup.png";

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

function Nav({ onBook, color, brandName }: { onBook: () => void; color: string; brandName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md shadow-sm">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-16">
        <button className="font-black text-xl tracking-tighter" style={{ color }} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          {brandName.toLowerCase().replace(/\s+/g, "")}
        </button>
        <div className="hidden md:flex items-center gap-8 text-[13px] font-medium text-gray-500">
          <a href="#process" className="hover:opacity-80 transition-colors" style={{ color }}>Process</a>
          <a href="#pricing" className="hover:opacity-80 transition-colors" style={{ color }}>Pricing</a>
          <a href="#faq" className="hover:opacity-80 transition-colors" style={{ color }}>FAQ</a>
          <button onClick={onBook} className="text-white px-5 py-2 rounded-full text-[13px] font-semibold" style={{ backgroundColor: color }}>
            Book Now
          </button>
        </div>
        <button className="md:hidden text-gray-700" onClick={() => setOpen(v => !v)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="md:hidden bg-white border-t overflow-hidden">
            <div className="px-6 py-5 space-y-4 text-sm font-medium">
              <a href="#process" onClick={() => setOpen(false)} className="block">Process</a>
              <a href="#pricing" onClick={() => setOpen(false)} className="block">Pricing</a>
              <a href="#faq" onClick={() => setOpen(false)} className="block">FAQ</a>
              <button onClick={onBook} className="block w-full text-white text-center py-3 rounded-full font-semibold" style={{ backgroundColor: color }}>
                Book Now
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

  return (
    <div className="min-h-screen">
      <Nav onBook={() => setShowModal(true)} color={color} brandName={tenant.brandName} />

      <section className="relative min-h-screen flex flex-col justify-end overflow-hidden bg-[#f5f2ed] pt-16">
        <div className="absolute top-1/2 -translate-y-1/2 -right-[5%] text-[20vw] font-black leading-none tracking-tighter text-black/5 select-none pointer-events-none whitespace-nowrap">
          LAUNDRY
        </div>
        <div className="max-w-7xl mx-auto px-6 w-full relative z-10 pb-12 md:pb-20 flex-1 flex flex-col justify-center">
          <div className="grid lg:grid-cols-12 gap-8 items-end">
            <div className="lg:col-span-7 space-y-6">
              <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="text-[3rem] sm:text-[4rem] md:text-[5rem] lg:text-[5.5rem] font-black leading-[0.95] tracking-tight text-gray-900">
                We do your <span className="italic" style={{ color }}>laundry.</span>
              </motion.h1>
              <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="text-gray-500 text-lg md:text-xl max-w-md leading-relaxed">
                Expert cleaning. Free pickup & delivery across LA. You will never visit a laundromat again.
              </motion.p>
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="flex flex-wrap items-center gap-4 pt-2">
                <button onClick={() => setShowModal(true)} className="group inline-flex items-center gap-3 text-white pl-7 pr-5 py-4 rounded-full text-base font-semibold shadow-xl" style={{ backgroundColor: color }}>
                  Schedule Free Pickup
                  <span className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                    <ArrowRight size={16} />
                  </span>
                </button>
                <a href="#pricing" className="text-sm font-semibold text-gray-500 underline underline-offset-4 decoration-gray-300">
                  View prices
                </a>
              </motion.div>
            </div>
            <div className="lg:col-span-5 relative">
              <div className="aspect-[3/4] max-h-[min(88vh,820px)] bg-[#ddd7cc] rounded-t-[2rem] overflow-hidden shadow-xl">
                <img
                  src={HERO_IMAGE}
                  alt=""
                  className="h-full w-full object-cover object-[center_28%]"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="process" className="py-24 md:py-32 bg-white">
        <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          <div className="space-y-8 lg:sticky lg:top-24">
            <div>
              <span className="text-xs font-bold uppercase tracking-[0.25em] mb-4 block" style={{ color }}>How it works</span>
              <h2 className="text-4xl md:text-5xl font-black tracking-tight leading-[1.1]">
                Three steps. <span className="italic" style={{ color }}>That is it.</span>
              </h2>
            </div>
            <div className="rounded-3xl overflow-hidden border border-black/10 shadow-lg bg-[#f5f2ed] max-w-md mx-auto lg:mx-0">
              <img
                src={PROCESS_MOCKUP}
                alt="Book pickup: schedule and estimate on your phone"
                className="w-full h-auto object-cover object-top block"
                loading="lazy"
              />
            </div>
          </div>
          <div className="space-y-4">
            {["Book a time", "We handle it", "Back to you"].map((step, i) => (
              <div key={step} className={`rounded-2xl p-8 ${i === 0 ? "text-white" : "bg-[#f5f2ed]"}`} style={i === 0 ? { backgroundColor: color } : undefined}>
                <h3 className="text-xl font-bold mb-2">{step}</h3>
                <p className={i === 0 ? "text-white/80 text-sm" : "text-gray-500 text-sm"}>
                  {i === 0
                    ? "Pick a slot in seconds."
                    : i === 1
                      ? "Pickup, wash, fold and press with care."
                      : "Clean clothes delivered in 24 hours."}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="py-24 md:py-32 text-white" style={{ backgroundColor: color }}>
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl md:text-5xl font-black text-center mb-12">Honest prices.</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: ICONS.shirts, name: "Shirts", price: "$4.99" },
              { icon: ICONS.dress, name: "Dresses", price: "$11.50" },
              { icon: ICONS.serviceWash, name: "Service Wash", price: "$35.00" },
              { icon: ICONS.bedding, name: "Bedding", price: "$14.50" },
            ].map((item) => (
              <div key={item.name} className="bg-white rounded-2xl p-5 text-center text-black">
                <img src={item.icon} alt={item.name} className="w-14 h-14 mx-auto mb-3 object-contain" />
                <h3 className="font-bold text-sm">{item.name}</h3>
                <p className="text-2xl font-black mt-2" style={{ color }}>{item.price}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="py-24 md:py-32 bg-[#f5f2ed]">
        <div className="max-w-2xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-black tracking-tight text-center mb-10">
            Quick answers.
          </h2>
          {[
            "How are payments processed?",
            "What if I am not home?",
            "What areas do you cover?",
          ].map((question) => (
            <details key={question} className="bg-white rounded-xl p-5 mb-3 group">
              <summary className="font-bold text-sm flex items-center justify-between cursor-pointer">
                {question}
                <ChevronDown size={18} className="text-gray-400 group-open:rotate-180 transition-transform" />
              </summary>
              <p className="text-gray-500 text-sm mt-3 leading-relaxed">
                We will confirm details after your booking and keep pickup and dropoff simple.
              </p>
            </details>
          ))}
        </div>
      </section>

      <footer className="bg-[#0a0a0a] text-white py-12">
        <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-3 gap-8">
          <div>
            <span className="font-black text-lg tracking-tighter">{tenant.brandName.toLowerCase().replace(/\s+/g, "")}</span>
            <p className="text-gray-600 text-xs mt-2 leading-relaxed">Modern pickup and delivery laundry service.</p>
          </div>
          <div className="text-sm text-gray-500 space-y-2">
            <span className="flex items-center gap-2"><Phone size={13} /> {tenant.supportPhone}</span>
            <span className="flex items-center gap-2"><Mail size={13} /> {tenant.supportEmail}</span>
            <span className="flex items-center gap-2"><MapPin size={13} /> Los Angeles, CA</span>
          </div>
          <div className="text-sm text-gray-500 space-y-2">
            <span className="flex items-center gap-2"><Star size={13} /> Five-star rated pickup team</span>
            <button onClick={() => setShowModal(true)} className="inline-flex items-center gap-2 underline">
              Schedule Pickup <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      </footer>

      {showModal && <SchedulePickupModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

