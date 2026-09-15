/**
 * Analytical customer identity. A "customer" in Goldline analytics is a
 * connected set of order records sharing a normalized phone, email, Goldline
 * resident id, or CleanCloud customer id. It is an identity under these
 * matching rules — not a proven person — and callers must say so.
 */

export type IdentityEvidence = {
  phone?: string | null;
  email?: string | null;
  cleancloudCustomerId?: string | null;
  bldgUserId?: number | null;
};

export type IdentityGroup<T> = {
  id: string;
  keys: string[];
  records: T[];
  /** False when the records carried no identifying evidence at all. */
  matched: boolean;
};

export const IDENTITY_METHOD_DESCRIPTION =
  "matched by normalized phone, email, Goldline resident id, or CleanCloud customer id";

export function normalizeIdentityPhone(value: string | null | undefined): string | null {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length >= 7 ? digits : null;
}

export function normalizeIdentityEmail(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.includes("@") ? normalized : null;
}

const KEY_PRIORITY = ["phone:", "email:", "bldg-user:", "cleancloud:"];

export function identityKeysFor(evidence: IdentityEvidence): string[] {
  const keys: string[] = [];
  const phone = normalizeIdentityPhone(evidence.phone);
  if (phone) keys.push(`phone:${phone}`);
  const email = normalizeIdentityEmail(evidence.email);
  if (email) keys.push(`email:${email}`);
  if (evidence.bldgUserId != null && evidence.bldgUserId > 0) keys.push(`bldg-user:${evidence.bldgUserId}`);
  const cleancloud = String(evidence.cleancloudCustomerId ?? "").trim();
  if (cleancloud) keys.push(`cleancloud:${cleancloud}`);
  return keys;
}

function priority(key: string): number {
  const index = KEY_PRIORITY.findIndex(prefix => key.startsWith(prefix));
  return index === -1 ? KEY_PRIORITY.length : index;
}

export function resolveCustomerIdentities<T>(
  records: readonly T[],
  getEvidence: (record: T) => IdentityEvidence
): { groups: IdentityGroup<T>[]; unmatchedRecordCount: number } {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = key;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const add = (key: string) => {
    if (!parent.has(key)) parent.set(key, key);
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  const keysByRecord = records.map(record => {
    const keys = identityKeysFor(getEvidence(record));
    keys.forEach(add);
    for (const key of keys.slice(1)) union(keys[0]!, key);
    return keys;
  });

  const groups = new Map<string, IdentityGroup<T>>();
  let unmatchedRecordCount = 0;
  records.forEach((record, index) => {
    const keys = keysByRecord[index]!;
    if (!keys.length) {
      unmatchedRecordCount += 1;
      groups.set(`unmatched:${index}`, { id: `unmatched:${index}`, keys: [], records: [record], matched: false });
      return;
    }
    const root = find(keys[0]!);
    const group = groups.get(root) ?? { id: root, keys: [], records: [], matched: true };
    group.records.push(record);
    for (const key of keys) if (!group.keys.includes(key)) group.keys.push(key);
    groups.set(root, group);
  });

  const resolved = Array.from(groups.values()).map(group => {
    if (!group.matched) return group;
    const sorted = [...group.keys].sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
    return { ...group, id: sorted[0]!, keys: sorted };
  });
  return { groups: resolved, unmatchedRecordCount };
}
