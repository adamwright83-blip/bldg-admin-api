const PII_KEY_PATTERN =
  /(^|_)(address|email|phone|decision_?maker|contact|notes?|raw_?text|replay|payload)($|_)/i;
const EMAIL_VALUE_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const PHONE_VALUE_PATTERN = /(?:\+?1[-. (]*)?(?:\d{3}[-. )]*){2}\d{4}/;

function inspectPrivacySafeValue(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      inspectPrivacySafeValue(item, `${path}[${index}]`)
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (PII_KEY_PATTERN.test(key)) {
        throw new Error(`Analytics property ${path}.${key} is not allowlisted`);
      }
      inspectPrivacySafeValue(nested, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string") {
    if (EMAIL_VALUE_PATTERN.test(value) || PHONE_VALUE_PATTERN.test(value)) {
      throw new Error(`Analytics property ${path} contains direct contact data`);
    }
  }
}
export function assertPrivacySafeAnalyticsProperties(
  properties: Record<string, unknown>
): void {
  inspectPrivacySafeValue(properties, "properties");
}

export function assertOrderedEventRows(
  rows: ReadonlyArray<{ id: number; createdAt: Date }>
): void {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]!;
    const current = rows[index]!;
    if (current.createdAt.getTime() < previous.createdAt.getTime()) {
      throw new Error("Release audit events are not in chronological order");
    }
    if (
      current.createdAt.getTime() === previous.createdAt.getTime() &&
      current.id <= previous.id
    ) {
      throw new Error("Release audit events do not have a stable ID tie-breaker");
    }
  }
}

export function assertNoFabricatedExternalTruth(input: {
  invoicedRevenueCents: number;
  invoiceEvidenceAvailable: boolean;
  printProviderCompleted?: boolean;
  outboundMessageDelivered?: boolean;
}): void {
  if (input.invoicedRevenueCents !== 0 || input.invoiceEvidenceAvailable) {
    throw new Error("The release fixture must not claim invoice evidence");
  }
  if (input.printProviderCompleted === true) {
    throw new Error("The release fixture must not claim print-provider completion");
  }
  if (input.outboundMessageDelivered === true) {
    throw new Error("The release fixture must not claim outbound delivery");
  }
}
