import { randomUUID } from "node:crypto";
import { z } from "zod";
import { cargoVoiceFieldsSchema } from "../../shared/goldlineCargoVoice";
import {
  router,
  dayforgeTenantMemberProcedure as procedure,
} from "../_core/trpc";
import { transcribeAudio } from "../_core/voiceTranscription";
import { storageDelete, storageGet, storagePut } from "../storage";
import {
  cargoAppearance,
  confirmCargo,
  linkFieldCargo,
  listAtProcessor,
  listCargo,
  listUnassignedPickedUp,
  proposeCargo,
  transferCustody,
  updateFieldCargo,
} from "./cargoService";

function decodeAudio(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)((?:;[^,]*)*);base64,([\s\S]+)$/i);
  if (!match || !(match[1].startsWith("audio/") || match[1] === "video/webm"))
    throw new Error("Audio recording format is invalid");
  const data = Buffer.from(match[3], "base64");
  if (!data.length || data.length > 12 * 1024 * 1024)
    throw new Error("Audio recording must be under 12 MB");
  return { mimeType: match[1].toLowerCase(), data };
}

async function transcriptFromAudio(input: {
  tenantId: string;
  actorId: string;
  audioDataUrl: string;
}) {
  const audio = decodeAudio(input.audioDataUrl);
  const extension = audio.mimeType.includes("mp4")
    ? "m4a"
    : audio.mimeType.includes("ogg")
      ? "ogg"
      : "webm";
  const key = `vehicle-cargo/${input.tenantId}/${input.actorId}/${randomUUID()}.${extension}`;
  await storagePut(key, audio.data, audio.mimeType);
  try {
    const downloadable = await storageGet(key);
    const result = await transcribeAudio({
      audioUrl: downloadable.url,
      mimeType: audio.mimeType,
      fileName: `cargo.${extension}`,
      language: "en",
      prompt:
        "Transcribe a driver's vehicle cargo statement verbatim. Preserve customer names, item counts, items, service type, processing state, locations, and whether cargo was added or removed. Do not infer or add details.",
    });
    if ("error" in result)
      throw new Error(`Could not transcribe this cargo: ${result.error}`);
    if (!result.text.trim())
      throw new Error(
        "No speech was detected. Try again or add the item manually."
      );
    return result.text.trim();
  } finally {
    void storageDelete(key).catch(error =>
      console.warn("[GoldlineCargo] Temporary audio cleanup failed", error)
    );
  }
}

export const goldlineCargoRouter = router({
  state: procedure.query(async ({ ctx }) => {
    const [cargo, unassigned, atProcessor] = await Promise.all([
      listCargo(ctx.tenantId, ctx.user.openId),
      listUnassignedPickedUp(ctx.tenantId),
      listAtProcessor(ctx.tenantId),
    ]);
    return {
      atProcessor,
      vehicleId: ctx.user.openId,
      cargo: cargo.map(item => ({
        ...item,
        appearance: cargoAppearance(
          item.state as "IN_VEHICLE_UNPROCESSED" | "IN_VEHICLE_PROCESSED"
        ),
      })),
      unassigned: unassigned.map(order => ({
        orderId: order.id,
        customer: `${order.firstName} ${order.lastName}`.trim(),
        address: order.address,
      })),
    };
  }),
  propose: procedure
    .input(
      z
        .object({
          transcript: z.string().trim().min(1).max(4000).optional(),
          audioDataUrl: z.string().max(16_500_000).optional(),
        })
        .refine(
          input => Boolean(input.transcript || input.audioDataUrl),
          "Speech or typed cargo details are required"
        )
    )
    .mutation(async ({ ctx, input }) =>
      proposeCargo({
        tenantId: ctx.tenantId,
        transcript:
          input.transcript?.trim() ||
          (await transcriptFromAudio({
            tenantId: ctx.tenantId,
            actorId: ctx.user.openId,
            audioDataUrl: input.audioDataUrl!,
          })),
      })
    ),
  confirm: procedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        transcript: z.string().trim().min(1).max(4000),
        fields: cargoVoiceFieldsSchema,
        selectedOrderId: z.number().int().positive().nullable().optional(),
        confirmed: z.literal(true),
      })
    )
    .mutation(({ ctx, input }) =>
      confirmCargo({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        vehicleId: ctx.user.openId,
        ...input,
      })
    ),
  transfer: procedure
    .input(
      z.object({
        orderId: z.number().int(),
        to: z.enum([
          "IN_VEHICLE_UNPROCESSED",
          "AT_PROCESSOR",
          "IN_VEHICLE_PROCESSED",
        ]),
        confirmed: z.literal(true),
      })
    )
    .mutation(({ ctx, input }) =>
      transferCustody({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        vehicleId: ctx.user.openId,
        ...input,
      })
    ),
  link: procedure
    .input(
      z.object({
        fieldCargoId: z.string().uuid(),
        orderId: z.number().int().positive(),
        confirmed: z.literal(true),
      })
    )
    .mutation(({ ctx, input }) =>
      linkFieldCargo({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        fieldCargoId: input.fieldCargoId,
        orderId: input.orderId,
      })
    ),
  update: procedure
    .input(
      z.object({
        fieldCargoId: z.string().uuid(),
        fields: cargoVoiceFieldsSchema.pick({
          customerDisplayName: true,
          itemDescription: true,
          quantity: true,
          serviceType: true,
          processingState: true,
          notes: true,
        }),
      })
    )
    .mutation(({ ctx, input }) =>
      updateFieldCargo({
        tenantId: ctx.tenantId,
        vehicleId: ctx.user.openId,
        fieldCargoId: input.fieldCargoId,
        fields: input.fields,
      })
    ),
});
