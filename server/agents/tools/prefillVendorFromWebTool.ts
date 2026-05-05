import type { AgentTool } from "../toolRegistry";
import { detectVendorCategoryPreset } from "../vendorCategoryPresets";

function extractUrl(text: string): string | null {
  return text.match(/https?:\/\/[^\s]+|(?:www\.)[^\s]+|(?:instagram\.com\/[^\s]+)/i)?.[0] ?? null;
}

function normalizeUrl(value: string): string | null {
  const raw = extractUrl(value)?.trim();
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function htmlToVisibleText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractJsonLd(html: string) {
  const items: unknown[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) items.push(...parsed);
      else items.push(parsed);
    } catch {
      // Ignore malformed page-owned metadata.
    }
  }
  return items;
}

function priceToCents(raw?: string | null) {
  if (!raw) return 0;
  const parsed = Number(raw.replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function cleanServiceName(value: string) {
  return value
    .replace(/[-–—:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bAnd\b/g, "&")
    .replace(/^Wash Fold(?: Dry)?$/i, "Wash & Fold")
    .replace(/^Fluff & Fold Same Day \/ Delivery$/i, "Fluff & Fold Same Day Delivery");
}

function extractServicesFromText(text: string) {
  const services: Array<Record<string, any>> = [];
  const seen = new Set<string>();
  const push = (serviceName: string, basePriceCents: number, extra: Record<string, any> = {}) => {
    const cleaned = cleanServiceName(serviceName);
    if (cleaned.length < 3 || seen.has(cleaned.toLowerCase())) return;
    seen.add(cleaned.toLowerCase());
    services.push({ serviceName: cleaned, basePriceCents, durationMinutes: extra.durationMinutes ?? 60, ...extra });
  };

  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";
    const inline = line.match(/^(.{3,90}?)\s+\$?(\d+(?:\.\d{1,2})?)(?:\s*\/\s*(lb|pound))?/i);
    if (inline && /[A-Za-z]/.test(inline[1])) {
      push(inline[1], priceToCents(inline[2]), { pricingUnit: inline[3] ? "pound" : undefined });
      continue;
    }
    const nextPrice = next.match(/^\$?(\d+(?:\.\d{1,2})?)(?:\s*\/\s*(lb|pound))?$/i);
    if (nextPrice && /[A-Za-z]/.test(line) && !/^(premium|unmatched|prices?|delivery|same day)$/i.test(line)) {
      push(line, priceToCents(nextPrice[1]), { pricingUnit: nextPrice[2] ? "pound" : undefined });
      i += 1;
    }
  }

  for (const match of text.matchAll(/\b([A-Za-z][A-Za-z &/-]{2,60})\s+\$?(\d+(?:\.\d{1,2})?)\s*\/?\s*(lb|pound)?/gi)) {
    push(match[1], priceToCents(match[2]), { pricingUnit: match[3] ? "pound" : undefined });
  }
  return services.slice(0, 150);
}

function extractBusinessDetails(text: string, jsonLd: unknown[]) {
  const details: Record<string, any> = {};
  const localBusiness = jsonLd.find((item) => {
    const value = item as Record<string, any>;
    const type = value?.["@type"];
    return typeof type === "string" ? /business|organization|localbusiness/i.test(type) : Array.isArray(type) && type.some((part) => /business|organization|localbusiness/i.test(String(part)));
  }) as Record<string, any> | undefined;
  if (localBusiness?.name) details.businessName = String(localBusiness.name);
  if (localBusiness?.telephone) details.phone = String(localBusiness.telephone);
  if (localBusiness?.email) details.email = String(localBusiness.email);
  if (localBusiness?.address) details.address = localBusiness.address;
  details.hours = text.match(/\b(?:hours?|open)\b[:\s]+([^\n]{5,120})/i)?.[1] ?? localBusiness?.openingHours ?? null;
  details.phone ??= text.match(/(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0] ?? null;
  details.email ??= text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  return details;
}

export const prefillVendorFromWebTool: AgentTool<Record<string, any>> = {
  name: "prefillVendorFromWebTool",
  description: "Cheaply prefill vendor onboarding details from a website, Instagram, booking page, or pasted public text.",
  async execute(input) {
    const source = String(input.sourceUrl ?? input.url ?? input.text ?? "");
    const pastedText = String(input.pageText ?? input.text ?? "");
    const url = normalizeUrl(source) ?? normalizeUrl(pastedText);
    const warnings: string[] = [];
    let html = "";
    let fetchedText = "";
    let jsonLd: unknown[] = [];

    if (url) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "user-agent": "BLDG.chat vendor onboarding bot (+https://bldg.chat)",
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });
        clearTimeout(timer);
        if (!response.ok) {
          warnings.push(`Fetch failed with HTTP ${response.status}.`);
        } else {
          html = await response.text();
          fetchedText = htmlToVisibleText(html);
          jsonLd = extractJsonLd(html);
        }
      } catch (error) {
        warnings.push(`Fetch failed: ${error instanceof Error ? error.message : String(error)}.`);
      }
    } else {
      warnings.push("No usable URL was provided.");
    }

    const combined = [source, pastedText, fetchedText].filter(Boolean).join("\n");
    const categoryPresetKey = detectVendorCategoryPreset(combined);
    const businessDetails = extractBusinessDetails(combined, jsonLd);
    const businessName = input.businessName ?? businessDetails.businessName ?? null;
    const services = extractServicesFromText(combined);
    const pricingItems = services.map((service) => ({
      serviceName: service.serviceName,
      basePriceCents: service.basePriceCents,
      pricingUnit: service.pricingUnit ?? null,
    }));
    const ok = services.length > 0 || Object.values(businessDetails).some(Boolean);
    const extractionStatus = services.length > 0 ? "success" : ok ? "partial" : "failed";
    if (fetchedText.length < 120 && url) warnings.push("The page returned very little visible text; it may be JavaScript-rendered.");
    if (services.length === 0) warnings.push("No visible service pricing was extracted.");

    return {
      entityType: "vendor_prefill",
      entityId: url,
      output: {
        ok,
        sourceUrl: url,
        extractionStatus,
        businessName,
        categoryPresetKey,
        vendorCategory: categoryPresetKey,
        services,
        pricingItems,
        businessDetails,
        warnings,
        rawTextPreview: fetchedText.slice(0, 1000) || pastedText.slice(0, 1000) || undefined,
        prices: pricingItems,
        hours: businessDetails.hours ?? null,
        location: businessDetails.address ?? pastedText.match(/(?:location|address)[:\s]+([^\n]+)/i)?.[1] ?? null,
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
