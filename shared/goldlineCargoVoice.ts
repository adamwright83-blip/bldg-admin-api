import { z } from "zod";

export const cargoServiceTypeSchema = z.enum(["dry_cleaning", "wash_fold"]);
export const cargoProcessingStateSchema = z.enum([
  "unknown",
  "unprocessed",
  "processed",
]);
export const cargoVehicleActionSchema = z.enum(["add", "remove"]);

export const cargoVoiceFieldsSchema = z.object({
  customerDisplayName: z.string().trim().min(1).max(191),
  itemDescription: z.string().trim().min(1).max(255),
  quantity: z.number().int().positive().max(999).nullable(),
  serviceType: cargoServiceTypeSchema.nullable(),
  vehicleAction: cargoVehicleActionSchema,
  vehicleState: z.literal("IN_VEHICLE"),
  processingState: cargoProcessingStateSchema,
  location: z.string().trim().max(512).nullable(),
  notes: z.string().trim().max(1000).nullable(),
});

export type CargoVoiceFields = z.infer<typeof cargoVoiceFieldsSchema>;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function titleCase(value: string) {
  return value.replace(/\b\w/g, letter => letter.toUpperCase());
}

/** Conservative fallback parser: unknowns stay unknown and no IDs are produced. */
export function parseCargoTranscript(transcript: string): CargoVoiceFields {
  const raw = transcript.trim().replace(/[.!?]+$/, "");
  if (!raw)
    throw new Error(
      "No speech was detected. Try again or add the item manually."
    );
  const lower = raw.toLowerCase();
  const vehicleAction = /\b(remove|unload|take out|took out)\b/.test(lower)
    ? "remove"
    : "add";
  const serviceType = /\bdry[ -]?clean(?:ing)?\b/.test(lower)
    ? "dry_cleaning"
    : /\bwash(?:\s*(?:and|&))?\s*fold\b/.test(lower)
      ? "wash_fold"
      : null;
  const processingState = /\b(?:processed|clean|ready)\b/.test(lower)
    ? "processed"
    : /\bunprocessed|dirty|soiled\b/.test(lower)
      ? "unprocessed"
      : "unknown";

  const possessive = raw.match(
    /(?:add|remove|put|loaded?|unload(?:ed)?|take out|took out)?\s*([A-Za-z][A-Za-z .'-]{0,70}?)(?:'s|’s)\s+(.+)/i
  );
  const loaded = raw.match(
    /(?:loaded?|add|put)\s+([A-Za-z][A-Za-z .'-]{1,70}?)\s+(?:into|in|to)\s+(?:the\s+)?(?:car|vehicle|prius)/i
  );
  const demonstrative = raw.match(
    /^(?:these|the)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+?)\s+(?:are|is)\s+in\s+(?:the\s+)?(?:car|vehicle|prius)$/i
  );
  const customerDisplayName = titleCase(
    (possessive?.[1] ?? loaded?.[1] ?? "Unidentified cargo")
      .replace(/^.*?\b(?:add|remove|put|loaded?|unload(?:ed)?)\s+/i, "")
      .trim()
  );
  let remainder =
    possessive?.[2] ?? demonstrative?.[1] ?? (loaded ? "laundry" : raw);
  remainder = remainder
    .replace(
      /\s+(?:to|into|in|from)\s+(?:the\s+)?(?:dry[ -]?cleaning\s+)?(?:car|vehicle|prius).*$/i,
      ""
    )
    .replace(/^\s*(?:add|remove|put|loaded?|unload(?:ed)?)\s+/i, "")
    .trim();

  const quantityMatch = raw.match(
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i
  );
  const quantity = quantityMatch
    ? Number.isFinite(Number(quantityMatch[1]))
      ? Number(quantityMatch[1])
      : (NUMBER_WORDS[quantityMatch[1].toLowerCase()] ?? null)
    : null;
  let itemDescription = remainder
    .replace(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i, "")
    .replace(/^\s*(?:pair|pairs|bags?|orders?)\s+of\s+/i, "")
    .replace(/\s+(?:for\s+)?dry[ -]?cleaning\b.*$/i, "")
    .trim();
  if (/\bpairs? of pants\b/i.test(remainder))
    itemDescription = "pairs of pants";
  if (!itemDescription || itemDescription === raw)
    itemDescription = /\blaundry\b/i.test(raw) ? "laundry" : "cargo";

  const locationMatch = raw.match(
    /\b(?:at|from)\s+([A-Z][A-Za-z0-9 .'-]{2,80})(?=\s+(?:to|into|in|for)\b|$)/
  );
  return cargoVoiceFieldsSchema.parse({
    customerDisplayName,
    itemDescription,
    quantity,
    serviceType,
    vehicleAction,
    vehicleState: "IN_VEHICLE",
    processingState,
    location: locationMatch?.[1]?.trim() ?? null,
    notes: null,
  });
}

export function normalizeCargoName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchingCargoOrders<
  T extends { firstName?: string | null; lastName?: string | null },
>(name: string, orders: T[]) {
  const wanted = normalizeCargoName(name);
  if (!wanted || wanted === "unidentified cargo") return [];
  return orders.filter(
    order =>
      normalizeCargoName(`${order.firstName ?? ""} ${order.lastName ?? ""}`) ===
      wanted
  );
}
