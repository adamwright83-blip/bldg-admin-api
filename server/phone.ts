export function phoneDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizePhoneForStorage(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const digits = phoneDigits(raw);
  if (digits.length < 7) return null;

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+")) return `+${digits}`;
  return `+${digits}`;
}

export function sameNormalizedPhone(a: unknown, b: unknown): boolean {
  const left = normalizePhoneForStorage(a);
  const right = normalizePhoneForStorage(b);
  return !!left && !!right && left === right;
}
