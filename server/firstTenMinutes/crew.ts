import { TRPCError } from "@trpc/server";
import { recordEvent } from "./events";
import type { JourneyRow } from "./store";
import { googleAccessFor } from "./understanding/deps";
import { gmailReader } from "./understanding/googleReaders";
import { findingRow, setFindingStatus } from "./understanding/store";

const STATUS = { confirm: "confirmed", change: "changed", dismiss: "dismissed" } as const;
const EVENT = { confirm: "finding_confirmed", change: "finding_changed", dismiss: "finding_dismissed" } as const;

export async function answerFinding(
  journey: JourneyRow,
  findingId: string,
  answer: "confirm" | "change" | "dismiss",
  correction: string | null
): Promise<void> {
  const row = await findingRow(journey.id, findingId);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "That's no longer here." });
  await setFindingStatus(journey.id, findingId, STATUS[answer], answer === "confirm" ? null : correction || null);
  await recordEvent(journey.id, EVENT[answer], {
    findingId,
    kind: row.kind,
    companion: row.companion,
    ...(answer !== "confirm" && correction ? { correction } : {}),
  });
}

const MAX_PICTURE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * The picture behind an image finding, as a data URL for the person's own browser. The example's is a static asset.
 * A real one is fetched from Gmail on demand and never stored by JOYSTICK.
 */
export async function findingPicture(journey: JourneyRow, findingId: string): Promise<{ src: string } | null> {
  const row = await findingRow(journey.id, findingId);
  if (!row || row.kind !== "image" || row.payloadJson.kind !== "image") return null;
  if (journey.kind === "example") return { src: "/assets/first-ten/example/blue-jug.webp" };
  const origin = row.originJson;
  if (!origin || origin.provider !== "gmail") return null;
  const mimeType = row.payloadJson.mimeType ?? "image/jpeg";
  if (!IMAGE_TYPES.has(mimeType)) return null;
  const access = await googleAccessFor(journey);
  if (!access) return null;
  try {
    const bytes = await gmailReader(access).attachment(origin.messageId, origin.attachmentId);
    if (!bytes.length || bytes.length > MAX_PICTURE_BYTES) return null;
    return { src: `data:${mimeType};base64,${bytes.toString("base64")}` };
  } catch {
    return null;
  }
}
