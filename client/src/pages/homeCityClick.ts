import { canonicalLanternTerritory } from "@/components/admin/control-room/customerGeography";
import { resolveLanternCityClick } from "@/components/admin/control-room/lanternClickResolver";

/**
 * Home's city clicks.
 *
 * Opus LA and Century Park East stay on the building resolver.
 * Customer inspection and a Silver Lake recovery customer do not.
 * A recovery customer never lands in Tower Wars.
 */
export type HomeCityCustomer = {
  identityKey: string;
  displayName: string;
  phone: string | null;
  address?: string | null;
  cadence: { state: "active" | "dimming" | "dark" };
  location: {
    latitude: number;
    longitude: number;
    canonicalAddress: string | null;
  } | null;
};

export type HomeCityClick =
  | { kind: "building"; buildingId: string }
  | { kind: "customer_inspection"; customerId: string }
  | { kind: "recovery_customer"; customerId: string; territoryId: string };

export type HomeCityClickResolution =
  | { action: "navigate"; path: string }
  | { action: "inspect"; customerId: string }
  | { action: "none" };

export function canonicalPhoneCustomerId(phone: string | null | undefined): string | null {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? `phone:${digits}` : null;
}

export function silverLakeVillagerPath(customerId: string): string {
  return `/growth/lantern-city?cozy=1&territory=silver-lake&customer=${encodeURIComponent(customerId)}`;
}

export function homeCustomerId(customer: Pick<HomeCityCustomer, "phone" | "identityKey">): string {
  return canonicalPhoneCustomerId(customer.phone) ?? customer.identityKey;
}

export function isSilverLakeRecoveryCustomer(customer: HomeCityCustomer): boolean {
  if (customer.cadence.state === "active") return false;
  if (!canonicalPhoneCustomerId(customer.phone)) return false;
  return canonicalLanternTerritory(customer)?.id === "silver-lake";
}

export function resolveHomeCityClick(input: HomeCityClick): HomeCityClickResolution {
  if (input.kind === "building") {
    const click = resolveLanternCityClick({
      buildingId: input.buildingId,
      target: "tower",
    });
    if (click.action === "navigate") return { action: "navigate", path: click.path };
    return { action: "none" };
  }

  if (input.kind === "customer_inspection") {
    const customerId = input.customerId.trim();
    if (!customerId) return { action: "none" };
    return { action: "inspect", customerId };
  }

  const customerId = input.customerId.trim();
  if (!customerId || input.territoryId !== "silver-lake") return { action: "none" };
  return { action: "navigate", path: silverLakeVillagerPath(customerId) };
}
