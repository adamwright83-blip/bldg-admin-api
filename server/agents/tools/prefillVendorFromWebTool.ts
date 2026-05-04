import type { AgentTool } from "../toolRegistry";
import { detectVendorCategoryPreset } from "../vendorCategoryPresets";

function extractUrl(text: string): string | null {
  return text.match(/https?:\/\/[^\s]+|(?:www\.)[^\s]+|(?:instagram\.com\/[^\s]+)/i)?.[0] ?? null;
}

function extractServices(text: string) {
  const serviceWords = ["haircut", "blowout", "color", "facial", "massage", "detail", "groom", "training", "tailoring", "garment care"];
  return serviceWords.filter((word) => text.toLowerCase().includes(word)).map((name) => ({
    serviceName: name.replace(/\b\w/g, (c) => c.toUpperCase()),
    basePriceCents: Number(text.match(new RegExp(`${name}[^$]{0,30}\\$(\\d+)`, "i"))?.[1] ?? 0) * 100 || null,
    durationMinutes: Number(text.match(new RegExp(`${name}[^0-9]{0,30}(\\d{2,3})\\s*(?:min|minutes)`, "i"))?.[1] ?? 0) || null,
  }));
}

export const prefillVendorFromWebTool: AgentTool<Record<string, any>> = {
  name: "prefillVendorFromWebTool",
  description: "Cheaply prefill vendor onboarding details from a website, Instagram, booking page, or pasted public text.",
  async execute(input) {
    const source = String(input.sourceUrl ?? input.url ?? input.text ?? "");
    const pastedText = String(input.pageText ?? input.text ?? "");
    const url = extractUrl(source) ?? extractUrl(pastedText);
    const combined = `${source}\n${pastedText}`;
    const categoryPresetKey = detectVendorCategoryPreset(combined);
    const businessName =
      input.businessName ??
      pastedText.match(/(?:business|studio|salon|brand)[:\s]+([A-Z][A-Za-z0-9 '&.-]{2,80})/)?.[1] ??
      null;
    const services = extractServices(combined);
    return {
      entityType: "vendor_prefill",
      entityId: url,
      output: {
        sourceUrl: url,
        businessName,
        categoryPresetKey,
        vendorCategory: categoryPresetKey,
        services,
        prices: services.filter((service) => service.basePriceCents != null),
        hours: pastedText.match(/(?:hours?)[:\s]+([^\n]+)/i)?.[1] ?? null,
        location: pastedText.match(/(?:location|address)[:\s]+([^\n]+)/i)?.[1] ?? null,
        serviceArea: pastedText.match(/(?:service area)[:\s]+([^\n]+)/i)?.[1] ?? null,
        brandName: businessName,
        logoPhotoUrls: Array.from(combined.matchAll(/https?:\/\/[^\s)]+\.(?:png|jpe?g|webp)/gi)).map((match) => match[0]).slice(0, 5),
        instagram: combined.match(/instagram\.com\/[A-Za-z0-9_.-]+/i)?.[0] ?? null,
        website: url && !url.includes("instagram.com") ? url : null,
        bookingLink: /book|acuity|square|calendly|glossgenius/i.test(url ?? "") ? url : null,
        cancellationPolicy: pastedText.match(/(?:cancellation policy|cancel)[:\s]+([^\n]+)/i)?.[1] ?? null,
        missingFieldsHint: "Use collectVendorDetailsTool to ask only for missing or conflicting required details.",
      },
    };
  },
};
