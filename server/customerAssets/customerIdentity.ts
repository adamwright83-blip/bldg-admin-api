import { createHash } from "node:crypto";

export type CustomerIdentityInput = {
  phone?: string | null;
  email?: string | null;
  bldgUserId?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  unit?: string | null;
  buildingSlug?: string | null;
  address?: string | null;
  cleancloudCustomerId?: string | null;
  /** Only a unit-qualified verified address is identity evidence. */
  verifiedNormalizedAddress?: string | null;
  /**
   * Native Laundry Butler guests still persist a name/unit/address composite.
   * CleanCloud rows must not — display names are not identity.
   */
  allowNameComposite?: boolean;
};

function normalized(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizedPhone(value: string | null | undefined): string {
  let digits = normalized(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits;
}

/** Pre-stable-identity key retained only for persisted churn/recovery joins. */
export function legacyRawCustomerIdentityKey(
  input: CustomerIdentityInput
): string {
  const phone = normalizedPhone(input.phone);
  if (phone.length >= 7) return `phone:${phone}`;
  return [
    input.firstName,
    input.lastName,
    input.unit,
    input.buildingSlug,
    input.address,
  ]
    .map(normalized)
    .join("|");
}

function nameCompositeKey(input: CustomerIdentityInput): string {
  return [
    input.firstName,
    input.lastName,
    input.unit,
    input.buildingSlug,
    input.address,
  ]
    .map(normalized)
    .join("|");
}

function normalizedVerifiedAddress(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Candidate aliases in persistence-compatibility order (not a strength ranking):
 * phone → bldgUserId → email → CleanCloud customer ID → unit-qualified verified address.
 * Union-find joins every alias; the first present key is the canonical persisted hash
 * so existing Goldline rows keep the same identity. Names are never included.
 * Verified address is only emitted with a unit so a tower lobby is not one customer.
 */
export function identityCandidateKeys(input: CustomerIdentityInput): string[] {
  const keys: string[] = [];
  const phone = normalizedPhone(input.phone);
  if (phone.length >= 7) keys.push(`phone:${phone}`);
  if (input.bldgUserId != null && input.bldgUserId > 0)
    keys.push(`bldg-user:${input.bldgUserId}`);
  const email = normalized(input.email);
  if (email.includes("@")) keys.push(`email:${email}`);
  const cleancloud = String(input.cleancloudCustomerId ?? "").trim();
  if (cleancloud) keys.push(`cleancloud:${cleancloud}`);
  const verified = normalizedVerifiedAddress(input.verifiedNormalizedAddress);
  const unit = normalized(input.unit);
  if (verified && unit) keys.push(`address:${verified}|unit:${unit}`);
  return keys;
}

export function rawCustomerIdentityKey(input: CustomerIdentityInput): string {
  const candidates = identityCandidateKeys(input);
  if (candidates[0]) return candidates[0];
  if (input.allowNameComposite === false) return "";
  return nameCompositeKey(input);
}

function hashIdentityKey(tenantId: string, key: string): string {
  return createHash("sha256").update(`${tenantId}:${key}`).digest("hex");
}

export function unidentifiedCustomerKey(
  source: string,
  sourceOrderId: string
): string {
  return `unidentified:${source}:${sourceOrderId}`;
}

/**
 * Canonical identity hash, or null when there is no trustworthy evidence.
 * Never hashes an empty key: that would assign the same fake identity to
 * every unidentified CleanCloud row.
 */
export function customerIdentityHash(
  tenantId: string,
  input: CustomerIdentityInput
): string | null {
  const key = rawCustomerIdentityKey(input);
  if (!key) return null;
  return hashIdentityKey(tenantId, key);
}

export function legacyCustomerIdentityHash(
  tenantId: string,
  input: CustomerIdentityInput
): string {
  return hashIdentityKey(tenantId, legacyRawCustomerIdentityKey(input));
}

/** Canonical identity plus aliases that can join a customer's later evidence. */
export function customerIdentityHashes(
  tenantId: string,
  input: CustomerIdentityInput
): string[] {
  const canonical = rawCustomerIdentityKey(input);
  if (!canonical) return [];
  const hashes = [
    hashIdentityKey(tenantId, canonical),
    ...identityCandidateKeys(input).map(key =>
      hashIdentityKey(tenantId, key)
    ),
  ];
  if (input.allowNameComposite !== false) {
    hashes.push(legacyCustomerIdentityHash(tenantId, input));
  }
  return Array.from(new Set(hashes));
}

/**
 * Groups records by the connected set of trustworthy identity candidates.
 * This keeps a customer's history together when a later order gains a
 * stronger identifier (for example, bldgUserId) while retaining the first
 * deterministic canonical key for persistence compatibility.
 */
export function groupCustomerRecords<T>(
  tenantId: string,
  records: readonly T[],
  getIdentity: (record: T) => CustomerIdentityInput,
  getUnidentifiedKey?: (record: T) => string
): Array<{ key: string; records: T[] }> {
  const parent = new Map<string, string>();
  const find = (value: string): string => {
    const current = parent.get(value);
    if (!current || current === value) {
      parent.set(value, value);
      return value;
    }
    const root = find(current);
    parent.set(value, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  const aliasesByRecord = records.map(record => {
    const aliases = customerIdentityHashes(tenantId, getIdentity(record));
    aliases.forEach(find);
    for (const alias of aliases.slice(1)) union(aliases[0]!, alias);
    return aliases;
  });
  const groups = new Map<string, T[]>();
  records.forEach((record, index) => {
    const aliases = aliasesByRecord[index]!;
    if (!aliases.length) {
      const orphanKey =
        getUnidentifiedKey?.(record) ?? `unidentified:index:${index}`;
      groups.set(`orphan:${orphanKey}`, [record]);
      return;
    }
    const root = find(aliases[0]!);
    const group = groups.get(root) ?? [];
    group.push(record);
    groups.set(root, group);
  });
  return Array.from(groups.values()).map(group => {
    const hash = customerIdentityHash(tenantId, getIdentity(group[0]!));
    return {
      // The caller supplies deterministic order (createdAt/id for orders), so
      // the first record preserves the established canonical identity key.
      // Unidentified rows keep a per-order absence key, never a shared hash.
      key:
        hash ??
        getUnidentifiedKey?.(group[0]!) ??
        unidentifiedCustomerKey("orphan", "missing"),
      records: group,
    };
  });
}

export function customerAssetId(
  tenantId: string,
  input: CustomerIdentityInput
): string {
  const hash = customerIdentityHash(tenantId, input);
  if (!hash) {
    throw new Error("customerAssetId requires trustworthy identity evidence");
  }
  return `customer:${hash}`;
}
