/**
 * CHANNEL 382: everything the game says, and everything the ad says, kept apart.
 *
 * The studio (Bertrand, the rival station, the disasters) is fiction. The ad is real: it may only state what Laundry
 * Farm already states publicly, each claim is listed with where it came from, and every claim and price must be
 * approved by the operator before the ad can be exported. Nothing from the studio ever enters the ad or the caption.
 */

export type HookId = "speed" | "relief" | "offer";
export type LightId = "morning" | "clean" | "spotlight";

/** a statement the ad makes about the business; the operator confirms each one is true today */
export type Claim = { id: string; text: string; source: string };

export const BRAND = {
  name: "Laundry Farm",
  site: "laundryfarm.com",
  phone: "(424) 394-0344",
  forest: "#1a3a2a",
  forestLight: "#264d38",
  cream: "#faf7f2",
  gold: "#c8a96e",
  goldLight: "#ddc99a",
};

/** the public claims the copy may draw on, each with its source on laundryfarm.com */
export const CLAIMS: Record<string, Claim> = {
  pickup_la: { id: "pickup_la", text: "Picked up and delivered across LA", source: "laundryfarm.com hero: “Fresh laundry, picked up and delivered across LA.”" },
  next_day: { id: "next_day", text: "Often back the next day", source: "laundryfarm.com how-it-works: “Neat bags at your door — often next-day.”" },
  service_wash: { id: "service_wash", text: "Service Wash (wash, dry & fold) is $35", source: "laundryfarm.com pricing: Service Wash, wash, dry & fold, $35.00" },
};

export type Hook = {
  id: HookId;
  label: string;
  pitch: string;
  headline: string;
  subline: string;
  claims: readonly string[];
};

/** Claire's three suggestions. Editable in the game; the claims they rest on still need approval. */
export const HOOKS: readonly Hook[] = [
  {
    id: "speed",
    label: "Speed",
    pitch: "Fast. Faster than the competition. Faster than is strictly safe.",
    headline: "Picked up at your door.\nOften back the next day.",
    subline: "Fresh laundry, picked up and delivered across LA.",
    claims: ["next_day", "pickup_la"],
  },
  {
    id: "relief",
    label: "Relief",
    pitch: "The weekend you got back. A slow push-in. Strings.",
    headline: "Give your Sunday\nback to LA.",
    subline: "We pick up, wash, fold and bring it home.",
    claims: ["pickup_la"],
  },
  {
    id: "offer",
    label: "The offer",
    pitch: "A price. On camera. Live. Bertrand is sweating.",
    headline: "Wash, dry & fold.\n$35 a Service Wash.",
    subline: "Picked up and delivered across LA.",
    claims: ["service_wash", "pickup_la"],
  },
];

export const LIGHTS: readonly { id: LightId; label: string; note: string }[] = [
  { id: "morning", label: "Morning sun", note: "Warm. Golden. Honest." },
  { id: "clean", label: "Fresh & clean", note: "Bright, cool, crisp as a folded towel." },
  { id: "spotlight", label: "One spotlight", note: "Drama. Mystery. A van, alone." },
];

export const PROPS = [
  { id: "van", label: "The van" },
  { id: "bags", label: "Laundry bags" },
  { id: "towels", label: "Folded towels" },
  { id: "washer", label: "Washer" },
  { id: "palms", label: "Cardboard palms" },
] as const;
export type PropId = (typeof PROPS)[number]["id"];

export const hookById = (id: HookId) => HOOKS.find(h => h.id === id)!;

/** every claim the ad makes: the hook's, plus "the offer" line if the operator wrote one */
export function claimsFor(hookId: HookId, offer: string): Claim[] {
  const out = hookById(hookId).claims.map(id => CLAIMS[id]);
  const o = offer.trim();
  if (o) out.push({ id: "offer", text: o, source: "written by you in the studio" });
  return out;
}

/** export is allowed only once every claim is approved, and the whole ad has been read */
export function canExport(hookId: HookId, offer: string, approved: ReadonlySet<string>, checkedEverything: boolean): boolean {
  return checkedEverything && claimsFor(hookId, offer).every(c => approved.has(c.id));
}

/** the Instagram caption: plain, true, no studio */
export function captionFor(headline: string, subline: string, offer: string): string {
  const head = headline.replace(/\s*\n\s*/g, " ").trim();
  const lines = [head, subline.trim()];
  if (offer.trim()) lines.push(offer.trim());
  lines.push(`Book a pickup at ${BRAND.site} or call ${BRAND.phone}.`);
  lines.push("#LosAngeles #LaundryService #WashAndFold");
  return lines.filter(Boolean).join("\n\n");
}

/** words from the fiction that must never reach the ad or the caption */
export const STUDIO_WORDS = /\b(bertrand|channel|382|studio|sudsco|broadcast|director|on air|ratings)\b/i;

// ------------------------------------------------------------------ Bertrand

export type Line = { who: "bertrand" | "crew" | "rival"; text: string };
const B = (text: string): Line => ({ who: "bertrand", text });

export const INTRO: Line[] = [
  B("Welcome to CHANNEL {channel}. Broadcasting to practically nobody since this morning."),
  B("I am Bertrand Fairweather the Third, Station Chief. That is my chair. That is my megaphone. That is my staff of three. Wave, staff."),
  { who: "crew", text: "(the staff of three waves)" },
  B("And THAT, across the street, is SUDSCO ONE. Look at it. Beige. Competent. Unforgivable."),
  B("Tonight we make a commercial so good they'll see it from orbit. Or at least from Sudsco's parking lot. You're directing. Pick a hook."),
];

export const HOOK_REACTION: Record<HookId, Line[]> = {
  speed: [B("SPEED. Yes. We'll need the conveyor belt. Nobody has tested the conveyor belt."), { who: "crew", text: "(the boom operator quietly backs away)" }],
  relief: [B("Relief. A Sunday. A sunbeam. I may need a moment."), B("I do not need a moment. I am FINE. Continue.")],
  offer: [B("A PRICE? On my network? Live? …Bold. Sudsco would never. Sudsco says 'value'. Coward's word."), B("Nobody touch the backdrop. The backdrop has opinions.")],
};

export const PROP_REACTION: Record<PropId, { on: Line; off: Line }> = {
  van: { on: B("The van! Our star. Hand-moulded. Mostly round."), off: B("You've removed the VAN? The van has an agent.") },
  bags: { on: B("Laundry bags. Plump. Proud. Photogenic."), off: B("Fine. A bagless world. Very avant-garde.") },
  towels: { on: B("The towels, folded by me personally, at three in the morning."), off: B("The towels are hurt, but they understand.") },
  washer: { on: B("The washer. Do not open the washer. Something lives in the washer."), off: B("Good. The washer was upstaging everyone.") },
  palms: { on: B("Cardboard palms. LA, as God intended."), off: B("No palms. Bold. Is this even Los Angeles any more.") },
};

export const LIGHT_REACTION: Record<LightId, Line> = {
  morning: B("Morning sun. Warm. I can smell the coffee. There is no coffee. Budget."),
  clean: B("Fresh and clean! Like a towel that's been to therapy."),
  spotlight: B("ONE SPOTLIGHT. A van, alone in the dark, against the world. I'm getting chills. Gaffer, are you getting chills."),
};

export const FRAME_GOOD = B("Oh, that's a shot. That's a SHOT. Sudsco has never framed anything in its life.");
export const FRAME_EMPTY = B("You have framed… a wall. A lovely wall. The van is not in it. The van is the commercial.");

export const ACTION: Record<HookId, Line[]> = {
  speed: [B("ROLL CONVEYOR!"), { who: "crew", text: "(the conveyor belt achieves a speed no one requested)" }, B("…CUT. Nobody move. That was magnificent. The towels survived. Mostly.")],
  relief: [B("Action. Gently. Gently. Let the sun in."), B("…cut. Give me a second. It's just… a Sunday, you know? A whole Sunday.")],
  offer: [B("ACTION. Say the price like you mean it!"), { who: "crew", text: "(the backdrop falls over)" }, B("…CUT. Prop it up. Crooked is fine. Crooked is HONEST.")],
};

export const EXPORT_LINES: Line[] = [
  B("It's real. It's beautiful. It's finished. Now it has to leave this building."),
  B("The ON AIR sign stays dark until you put it out there yourself. I can't do it. I'm made of clay."),
];

export const WAITING: Line = B("I'll wait. I'm very good at waiting. I've been waiting since this morning.");

export const CELEBRATE: Record<"posted_feed" | "paid_promotion", Line[]> = {
  posted_feed: [B("WE'RE ON AIR! You posted it! On the feed! Staff, the confetti! The GOOD confetti!"), B("Ratings? We don't have ratings. Not until the real numbers come in. But tonight, we broadcast.")],
  paid_promotion: [B("A PAID PROMOTION. You put money behind it. Sudsco is shaking. I can see them shaking from here."), B("No ratings yet, mind you. When real numbers exist, I'll read them. Until then: we're ON AIR.")],
};

export const RIVAL_TICKER = ["SUDSCO ONE", "LAUNDRY.", "DONE.", "QUALITY · SERVICE · VALUE", "SUDSCO: IT'S LAUNDRY", "WE ARE OPEN DURING OUR HOURS"];

export function fillLine(text: string, channel: string): string {
  return text.replace(/\{channel\}/g, channel);
}
