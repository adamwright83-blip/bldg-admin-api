/**
 * Read-only: the selected business's real commercial prospects in Beverly Hills, for Lantern City's Beverly Hills
 * level. Its commercial accounts whose primary location is in Beverly Hills (address or 90210-90212), each with the
 * first contact on file, the opportunity's primary signal and the mission's stage; plus, for Laundry Butler, the
 * Beverly Hills buildings Adam hand-verified for Day 1's Ten Doors (shared/day1TenDoors.ts).
 *
 * Nothing is synthesised: an unreadable store says so (readable=false) rather than returning an empty list.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  commercialAccountContacts,
  commercialAccountLocations,
  commercialAccounts,
  commercialMissions,
  commercialOpportunities,
} from "../../../drizzle/schema";
import { DAY1_TARGETS } from "../../../shared/day1TenDoors";
import { TENANT_CONFIG, type TenantId } from "../../../shared/tenantConfig";
import type { BeverlyHillsProspect, BeverlyHillsProspects } from "../../../shared/beverlyHillsProspects";
import { getDb } from "../../db";

const IN_BEVERLY_HILLS = /beverly\s*hills|\b9021[0-2]\b/i;

export async function loadBeverlyHillsProspects(tenantId: string): Promise<BeverlyHillsProspects> {
  const brandName = TENANT_CONFIG[tenantId as TenantId]?.brandName ?? "your business";
  const prospects: BeverlyHillsProspect[] = [];
  let readable = true;
  try {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const rows = await db
      .select({
        id: commercialAccounts.id,
        name: commercialAccounts.name,
        kind: commercialAccounts.accountType,
        address: commercialAccountLocations.address,
      })
      .from(commercialAccounts)
      .innerJoin(
        commercialAccountLocations,
        and(eq(commercialAccountLocations.accountId, commercialAccounts.id), eq(commercialAccountLocations.isPrimary, true))
      )
      .where(eq(commercialAccounts.tenantId, tenantId));
    const here = rows.filter(r => IN_BEVERLY_HILLS.test(`${r.address ?? ""} ${r.name}`) && !/test/i.test(r.kind ?? ""));
    const ids = here.map(r => r.id);
    const [contacts, opps] = ids.length
      ? await Promise.all([
          db.select().from(commercialAccountContacts).where(and(eq(commercialAccountContacts.tenantId, tenantId), inArray(commercialAccountContacts.accountId, ids))),
          db.select().from(commercialOpportunities).where(and(eq(commercialOpportunities.tenantId, tenantId), inArray(commercialOpportunities.accountId, ids))).orderBy(desc(commercialOpportunities.updatedAt)),
        ])
      : [[], []];
    const oppIds = opps.map(o => o.id);
    const missions = oppIds.length
      ? await db.select().from(commercialMissions).where(and(eq(commercialMissions.tenantId, tenantId), inArray(commercialMissions.opportunityId, oppIds))).orderBy(desc(commercialMissions.updatedAt))
      : [];
    for (const r of here) {
      const contact = contacts.find(c => c.accountId === r.id) ?? null;
      const opp = opps.find(o => o.accountId === r.id) ?? null;
      const mission = opp ? missions.find(m => m.opportunityId === opp.id) ?? null : null;
      prospects.push({
        id: `acct:${r.id}`,
        source: "commercial_account",
        name: r.name,
        kind: r.kind ?? null,
        address: r.address ?? null,
        contact: contact ? { name: contact.name ?? null, title: contact.title ?? null, email: contact.email ?? null, phone: contact.phone ?? null } : null,
        stage: mission?.status ?? null,
        signal: opp?.primarySignal ?? null,
        lastActivityAt: (mission?.updatedAt ?? opp?.updatedAt)?.toISOString?.() ?? null,
        evidence: "Your commercial account",
        navigationUrl: r.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.address} Beverly Hills, CA`)}` : null,
      });
    }
  } catch {
    readable = false;
  }
  if (tenantId === "default") {
    for (const t of DAY1_TARGETS.filter(t => t.neighborhood === "Beverly Hills")) {
      if (prospects.some(p => p.name.toLowerCase() === t.name.toLowerCase())) continue;
      prospects.push({
        id: `day1:${t.id}`,
        source: "day1_ten_doors",
        name: t.name,
        kind: "apartment building",
        address: t.address,
        contact: t.phone ? { name: null, title: "Leasing office", email: null, phone: t.phone } : null,
        stage: null,
        signal: null,
        lastActivityAt: null,
        evidence: `Day 1 Ten Doors, hand-verified by you${t.managerLabel ? `: managed by ${t.managerLabel}` : ""}`,
        navigationUrl: t.navigationUrl,
      });
    }
  }
  // the follow-ups first, then accounts, then the buildings to cold-call
  const rank = (p: BeverlyHillsProspect) => (p.stage ? 0 : p.source === "commercial_account" ? 1 : 2);
  prospects.sort((a, b) => rank(a) - rank(b));
  return { tenantId, brandName, readable, prospects };
}
