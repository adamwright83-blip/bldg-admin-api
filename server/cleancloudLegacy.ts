import {
  normalizePropertyTower,
  type PropertyGroup,
  type PropertyTowerMatch,
  type TowerKey,
} from "@shared/propertyTowers";

export const CLEANCLOUD_LEGACY_NOTE =
  "Pre-Laundry Butler checkout order/customer imported from CleanCloud. Not visible in Stripe.";

export type CleanCloudLegacyCustomer = PropertyTowerMatch & {
  source: "cleancloud_legacy";
  paymentProcessor: "cleancloud";
  includedInStripe: false;
  includedInOperationalRevenue: true;
  stripePaymentIntentId: null;
  legacyImportNote: string;
  cleancloudCustomerId: number | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  address: string;
  unit: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  totalSpend: number;
  orderCount: number;
  firstOrderDate: string;
  lastOrderDate: string;
  note?: string;
};

type Seed = {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  unit?: string;
  city?: string;
  state?: string;
  zip?: string;
  cleancloudCustomerId?: number;
  totalSpend: number;
  orderCount?: number;
  firstOrderDate?: string;
  lastOrderDate?: string;
  propertyGroup?: PropertyGroup;
  towerKey?: TowerKey;
  note?: string;
};

const seeds: Seed[] = [
  {
    name: "Miso Chon",
    unit: "529",
    totalSpend: 29.75,
    orderCount: 2,
    propertyGroup: "opus_la",
    towerKey: "unknown",
    note: "OPUS LA unit 529. Tower unknown until address is confirmed.",
  },
  {
    name: "Forrest Forte",
    email: "Forte.forrest@gmail.com",
    phone: "567543880",
    address: "2160 Century Park East",
    unit: "302",
    city: "Century City",
    state: "CA",
    zip: "90067",
    cleancloudCustomerId: 89,
    totalSpend: 85.1,
    firstOrderDate: "2026-02-10",
    lastOrderDate: "2026-02-10",
  },
  {
    name: "Angie Redpath",
    email: "Ga954@hotmail.com",
    phone: "4243557032",
    address: "2170 Century Park East",
    unit: "1408",
    city: "Century City",
    state: "CA",
    zip: "90067",
    cleancloudCustomerId: 87,
    totalSpend: 20.75,
    firstOrderDate: "2026-02-05",
    lastOrderDate: "2026-02-09",
  },
  {
    name: "George Lee",
    email: "91george.lee@gmail.com",
    phone: "2133278787",
    address: "3545 Wilshire Boulevard",
    unit: "1519",
    city: "Koreatown",
    state: "CA",
    zip: "90010",
    cleancloudCustomerId: 86,
    totalSpend: 95.25,
    firstOrderDate: "2026-01-28",
    lastOrderDate: "2026-02-12",
  },
  {
    name: "Ben Chon",
    email: "benchon27@gmail.com",
    phone: "8186138800",
    address: "3650 West 6th Street",
    unit: "1210",
    city: "Koreatown",
    state: "CA",
    zip: "90020",
    cleancloudCustomerId: 85,
    totalSpend: 184.5,
    firstOrderDate: "2026-01-28",
    lastOrderDate: "2026-01-30",
  },
  {
    name: "Charles Kwong",
    email: "charleskwong@gmail.com",
    phone: "6266737711",
    address: "3545 Wilshire Boulevard",
    unit: "1917",
    city: "Koreatown",
    state: "CA",
    zip: "90010",
    cleancloudCustomerId: 81,
    totalSpend: 96.5,
    firstOrderDate: "2026-01-19",
    lastOrderDate: "2026-01-19",
  },
  {
    name: "Raymond Ra",
    email: "ray.kyooyung.ra@gmail.com",
    phone: "2137064733",
    address: "3545 Wilshire Boulevard",
    unit: "1425",
    city: "Koreatown",
    state: "CA",
    zip: "90010",
    cleancloudCustomerId: 80,
    totalSpend: 46,
    firstOrderDate: "2026-01-18",
    lastOrderDate: "2026-01-18",
  },
  {
    name: "Richard Lee",
    email: "rlee8517@gmail.com",
    phone: "4109348563",
    address: "3545 Wilshire Boulevard",
    unit: "905",
    city: "Los Angeles",
    state: "CA",
    zip: "90010",
    cleancloudCustomerId: 78,
    totalSpend: 49.6,
    firstOrderDate: "2026-01-12",
    lastOrderDate: "2026-01-12",
  },
  {
    name: "Abe",
    email: "abectunes@gmail.com",
    phone: "5165871292",
    address: "3545 Wilshire Boulevard",
    unit: "PH23",
    city: "Los Angeles",
    state: "CA",
    zip: "90010",
    cleancloudCustomerId: 77,
    totalSpend: 94.05,
    firstOrderDate: "2026-01-06",
    lastOrderDate: "2026-02-12",
    note: "Deduplicate/link by email and/or phone. Do not create duplicate customer if matched.",
  },
  {
    name: "Joo Lee",
    email: "joo.lee13@yahoo.com",
    phone: "5626775705",
    address: "3545 Wilshire Boulevard",
    unit: "2109",
    city: "Los Angeles",
    state: "CA",
    zip: "90010",
    cleancloudCustomerId: 76,
    totalSpend: 34.43,
    firstOrderDate: "2026-01-05",
    lastOrderDate: "2026-01-05",
  },
];

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts.shift() || "",
    lastName: parts.join(" "),
  };
}

export const cleanCloudLegacyCustomers: CleanCloudLegacyCustomer[] = seeds.map((seed) => {
  const tower = normalizePropertyTower(seed.address, {
    propertyGroup: seed.propertyGroup,
    towerKey: seed.towerKey,
  });
  const name = splitName(seed.name);
  return {
    ...tower,
    source: "cleancloud_legacy",
    paymentProcessor: "cleancloud",
    includedInStripe: false,
    includedInOperationalRevenue: true,
    stripePaymentIntentId: null,
    legacyImportNote: CLEANCLOUD_LEGACY_NOTE,
    cleancloudCustomerId: seed.cleancloudCustomerId ?? null,
    firstName: name.firstName,
    lastName: name.lastName,
    email: seed.email ?? null,
    phone: seed.phone ?? `cleancloud:${seed.name.toLowerCase().replace(/\s+/g, "-")}`,
    address: tower.buildingAddressCanonical ?? seed.address ?? "",
    unit: seed.unit ?? null,
    city: seed.city ?? null,
    state: seed.state ?? null,
    zip: seed.zip ?? null,
    totalSpend: seed.totalSpend,
    orderCount: seed.orderCount ?? 1,
    firstOrderDate: seed.firstOrderDate ?? seed.lastOrderDate ?? "2026-01-01",
    lastOrderDate: seed.lastOrderDate ?? seed.firstOrderDate ?? "2026-01-01",
    note: seed.note,
  };
});

export function cents(amount: number): number {
  return Math.round(amount * 100);
}

