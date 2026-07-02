export const BUSINESS_TYPES = [
  "Laundromat / Wash & Fold",
  "Landscaping",
  "Plumbing",
  "Contracting / Handyman",
  "Cleaning",
  "Auto Detailing",
  "Other",
] as const;

export const PRIMARY_NEEDS = [
  "More new customers",
  "Win back old customers",
  "Close open estimates",
  "Get more reviews",
  "Collect overdue money",
] as const;

export const MONTHLY_VOLUMES = [
  "Under 50 jobs/mo",
  "50–200 jobs/mo",
  "200–500 jobs/mo",
  "500+ jobs/mo",
] as const;

export type BsIntakeAnswers = {
  businessType: string;
  primaryNeed: string;
  monthlyVolume: string;
  businessName: string;
  name: string;
  phone: string;
  email: string;
};

const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export const BOOKING_URL: string | undefined = import.meta.env.VITE_BOOKING_URL;

export async function submitBoreslayLead(answers: BsIntakeAnswers): Promise<void> {
  const res = await fetch(`${API_BASE}/api/leads/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: answers.name,
      building_name: answers.businessName,
      role: answers.businessType,
      email: answers.email,
      number_of_units: answers.monthlyVolume,
      phone: answers.phone,
      source: "boreslay_landing",
      source_url: typeof window !== "undefined" ? window.location.href : null,
      notes: `Need: ${answers.primaryNeed} · Volume: ${answers.monthlyVolume}`,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Lead submit failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
}
