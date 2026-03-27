type TemplateType = "butler" | "laundryfarm";

export type TenantId = "default" | "laundry_farm";

type TenantConfig = {
  readonly id: TenantId;
  readonly brandName: string;
  readonly logoUrl: string;
  readonly primaryColor: string;
  readonly supportEmail: string;
  readonly supportPhone: string;
  readonly templateType: TemplateType;
  readonly hostname: string;
  readonly exactHosts: readonly string[];
  readonly aliasPatterns: readonly string[];
  readonly wildcardPatterns: readonly RegExp[];
};

const BUTLER_LOGO =
  "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/WZKCbJMLcYxTxbBz.png";
const FARM_LOGO =
  "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/TnWYaeVttBiuZTNp.png";

export const TENANT_CONFIG: Readonly<Record<TenantId, TenantConfig>> = {
  default: {
    id: "default",
    brandName: "Laundry Butler",
    logoUrl: BUTLER_LOGO,
    primaryColor: "#111111",
    supportEmail: "support@laundrybutler.com",
    supportPhone: "(323) 807-4661",
    templateType: "butler",
    hostname: "laundrybutler.com",
    exactHosts: [
      "laundrybutler.com",
      "www.laundrybutler.com",
      "app.bldg.chat",
      "admin.bldg.chat",
      "driver.bldg.chat",
      "vendor.bldg.chat",
      "contact.bldg.chat",
      "localhost:3000",
      "127.0.0.1:3000",
    ],
    aliasPatterns: ["laundry-butler-*.vercel.app"],
    wildcardPatterns: [/^[0-9]+\.bldg\.chat$/],
  },
  laundry_farm: {
    id: "laundry_farm",
    brandName: "Laundry Farm",
    logoUrl: FARM_LOGO,
    primaryColor: "#1B4D3E",
    supportEmail: "support@laundryfarm.com",
    supportPhone: "(424) 394-0344",
    templateType: "laundryfarm",
    hostname: "laundryfarm.bldg.chat",
    exactHosts: [
      "laundryfarm.bldg.chat",
      "laundryfarm.com",
      "www.laundryfarm.com",
      "laundryfarm.localhost:3000",
    ],
    aliasPatterns: ["laundryfarm-*.vercel.app"],
    wildcardPatterns: [],
  },
} as const;

type ResolveMatchType = "exact" | "alias" | "wildcard" | "fallback";

export type TenantResolution = {
  readonly tenantId: TenantId;
  readonly host: string;
  readonly matchType: ResolveMatchType;
  readonly matched: boolean;
};

const DEFAULT_TENANT_ID: TenantId = "default";

const normalizeHost = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  const withoutComma = trimmed.split(",")[0]?.trim() ?? "";
  if (!withoutComma) return null;

  const withoutProto = withoutComma.includes("://")
    ? withoutComma
    : `http://${withoutComma}`;

  try {
    const parsed = new URL(withoutProto);
    return parsed.host.replace(/\.$/, "");
  } catch {
    return withoutComma.replace(/\.$/, "");
  }
};

const parseHostFromForwarded = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const value = raw.split(",")[0]?.trim() ?? "";
  if (!value) return null;
  const match = value.match(/host="?([^;"]+)"?/i);
  return normalizeHost(match?.[1] ?? null);
};

const matchesAlias = (host: string, pattern: string): boolean => {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(host);
};

const getHostVariants = (host: string): string[] => {
  const variants = new Set<string>([host]);
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase();
    variants.add(hostname);
  } catch {
    // Keep original host if URL parsing fails.
  }
  return Array.from(variants);
};

export const resolveTenantIdFromHost = (
  rawHost: string | null | undefined
): TenantResolution => {
  const host = normalizeHost(rawHost) ?? "";
  const hostVariants = getHostVariants(host);

  if (!host) {
    return {
      tenantId: DEFAULT_TENANT_ID,
      host: "",
      matchType: "fallback",
      matched: false,
    };
  }

  for (const tenant of Object.values(TENANT_CONFIG)) {
    if (tenant.exactHosts.some(exact => hostVariants.includes(exact.toLowerCase()))) {
      return { tenantId: tenant.id, host, matchType: "exact", matched: true };
    }
  }

  for (const tenant of Object.values(TENANT_CONFIG)) {
    if (tenant.aliasPatterns.some(pattern => hostVariants.some(v => matchesAlias(v, pattern)))) {
      return { tenantId: tenant.id, host, matchType: "alias", matched: true };
    }
  }

  for (const tenant of Object.values(TENANT_CONFIG)) {
    if (tenant.wildcardPatterns.some(pattern => hostVariants.some(v => pattern.test(v)))) {
      return { tenantId: tenant.id, host, matchType: "wildcard", matched: true };
    }
  }

  return {
    tenantId: DEFAULT_TENANT_ID,
    host,
    matchType: "fallback",
    matched: false,
  };
};

type HeaderRecord = Record<string, string | string[] | undefined>;

const getFirstHeaderValue = (
  headers: HeaderRecord,
  key: string
): string | undefined => {
  const value = headers[key] ?? headers[key.toLowerCase()];
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
};

export const getHostFromHeaders = (headers: HeaderRecord): string | null => {
  const forwardedHost =
    getFirstHeaderValue(headers, "x-forwarded-host") ??
    getFirstHeaderValue(headers, "forwarded-host");
  const fromForwardedHost = normalizeHost(forwardedHost);
  if (fromForwardedHost) return fromForwardedHost;

  const forwarded = getFirstHeaderValue(headers, "forwarded");
  const fromForwarded = parseHostFromForwarded(forwarded);
  if (fromForwarded) return fromForwarded;

  const fromHost = normalizeHost(getFirstHeaderValue(headers, "host"));
  if (fromHost) return fromHost;

  const fromOrigin = normalizeHost(getFirstHeaderValue(headers, "origin"));
  if (fromOrigin) return fromOrigin;

  const fromReferer = normalizeHost(getFirstHeaderValue(headers, "referer"));
  if (fromReferer) return fromReferer;

  return null;
};

export const resolveTenantIdFromHeaders = (
  headers: HeaderRecord
): TenantResolution => resolveTenantIdFromHost(getHostFromHeaders(headers));

