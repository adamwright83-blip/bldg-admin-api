import { z } from "zod";
import {
  isValidBuildIdentity,
  mitchExecutionHandbackSchema,
} from "./mitchContracts";
import { mitchProducerDesignReviewSchema } from "./mitchProducerBus";

const identity = {
  eventId: z.string().uuid(),
  tenantId: z.string().min(1),
  gameId: z.string().min(1),
  milestoneId: z.string().uuid(),
  workOrderId: z.string().uuid(),
  actorId: z.string().min(1),
};
const build = {
  buildId: z.string().refine(isValidBuildIdentity),
  branch: z.string().min(1),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/i),
};
export const mitchEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...identity,
      type: z.literal("implementation_handback"),
      handback: mitchExecutionHandbackSchema.extend({
        commitSha: build.commitSha,
      }),
    })
    .strict(),
  z
    .object({
      ...identity,
      ...build,
      type: z.literal("design_review_handback"),
      review: mitchProducerDesignReviewSchema,
    })
    .strict(),
  z
    .object({
      ...identity,
      ...build,
      type: z.literal("qa_handback"),
      review: mitchProducerDesignReviewSchema,
    })
    .strict(),
  z
    .object({
      ...identity,
      ...build,
      type: z.literal("human_decision"),
      decision: z.enum(["accept", "reject", "resolve_blocker"]),
      note: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...identity,
      type: z.literal("agent_failed"),
      error: z.string().min(1),
    })
    .strict(),
]);
export type MitchEvent = z.infer<typeof mitchEventSchema>;
export const MITCH_EVENT_MARKER = "<!-- mitch-event:v1 -->";
export function parseMitchComment(body: string): MitchEvent {
  const match = body.match(
    /^## [A-Z][A-Z0-9 _-]* → MITCH\s+<!-- mitch-event:v1 -->\s+```json\s*([\s\S]*?)\s*```\s*$/
  );
  if (!match) throw new Error("Malformed or unrelated Mitch event comment");
  return mitchEventSchema.parse(JSON.parse(match[1]));
}
export function eventContract(
  order: { tenantId: string; gameId: string; milestoneId: string; id: string },
  actorId: string,
  type: string,
  extra: object
): string {
  return [
    "Your final action is to return a structured handback to Mitch using this issue comment channel. Do not merely tell Adam you are finished.",
    "Use a new UUID for eventId; retry with the same ID and identical JSON. Include the full 40-character commit SHA.",
    "## " + actorId.toUpperCase().replace(/[^A-Z0-9 _-]/g, "_") + " → MITCH",
    MITCH_EVENT_MARKER,
    "```json",
    JSON.stringify(
      {
        eventId: "NEW_UUID",
        type,
        tenantId: order.tenantId,
        gameId: order.gameId,
        milestoneId: order.milestoneId,
        workOrderId: order.id,
        actorId,
        ...extra,
      },
      null,
      2
    ),
    "```",
  ].join("\n");
}
