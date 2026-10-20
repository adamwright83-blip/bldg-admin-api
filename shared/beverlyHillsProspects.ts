/**
 * Beverly Hills prospects: the selected business's real commercial prospects in Beverly Hills, and the cold-outreach
 * draft for each. Cold outreach is to a business (a hotel, a building's leasing office), never a consumer, and the
 * operator sends it from their own email or phone; nothing here sends.
 *
 * The draft states only what the records say: the business's own name and service, the prospect's name, and a real
 * conversation if one was logged. It never invents a promise, a referral, a price, or a meeting.
 */

export type BeverlyHillsProspect = {
  id: string;
  source: "commercial_account" | "day1_ten_doors";
  name: string;
  /** e.g. "hotel", "property_management", "apartment building" */
  kind: string | null;
  address: string | null;
  contact: { name: string | null; title: string | null; email: string | null; phone: string | null } | null;
  /** the commercial mission's stage, e.g. "follow_up" */
  stage: string | null;
  /** the opportunity's primary signal, e.g. "Operator logged an unplanned in-person conversation" */
  signal: string | null;
  lastActivityAt: string | null;
  /** where this prospect came from, in plain words */
  evidence: string;
  navigationUrl: string | null;
};

export type BeverlyHillsProspects = {
  tenantId: string;
  brandName: string;
  /** false when the records could not be read; an empty list is then not "no prospects" */
  readable: boolean;
  prospects: BeverlyHillsProspect[];
};

export type ProspectDraft = { subject: string; body: string; channel: "email" | "phone" | "visit" };

const SERVICE: Record<string, string> = {
  "Laundry Butler": "a no-cost laundry pickup-and-delivery amenity for residents",
  "Laundry Farm": "pickup-and-delivery laundry",
};

function firstName(full: string | null | undefined): string | null {
  const n = (full ?? "").trim().split(/\s+/)[0];
  return n && /^[A-Za-z][A-Za-z'-]*$/.test(n) ? n : null;
}

/** Spoke in person before? (only when the records say so) */
export function metInPerson(p: BeverlyHillsProspect): boolean {
  return /in-person conversation|in person/i.test(p.signal ?? "");
}

export function prospectDraft(p: BeverlyHillsProspect, brandName: string, sender = "Adam"): ProspectDraft {
  const service = SERVICE[brandName] ?? "laundry service";
  const who = firstName(p.contact?.name);
  const hello = who ? `Hi ${who},` : "Hello,";
  const channel: ProspectDraft["channel"] = p.contact?.email ? "email" : p.contact?.phone ? "phone" : "visit";
  if (metInPerson(p)) {
    return {
      channel,
      subject: `Following up from ${p.name}`,
      body: [
        hello,
        "",
        `This is ${sender} with ${brandName}. Following up on our conversation at ${p.name}.`,
        `We provide ${service}, and I'd love to show you how it could work for your team.`,
        "Would you have 15 minutes this week or next?",
        "",
        `${sender}`,
        brandName,
      ].join("\n"),
    };
  }
  const residents = /apartment|multifamily|property|building/i.test(`${p.kind ?? ""} ${p.evidence}`);
  return {
    channel,
    subject: `${brandName} for ${p.name}`,
    body: [
      hello,
      "",
      `I'm ${sender} with ${brandName}. We provide ${service}${residents ? ` at buildings around Los Angeles` : ""}.`,
      residents
        ? `Who's the best person to talk to about resident amenities at ${p.name}?`
        : `Who would be the right person to talk to about laundry at ${p.name}?`,
      "",
      "Thank you,",
      `${sender}`,
      brandName,
    ].join("\n"),
  };
}
