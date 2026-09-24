/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";
import { legacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import {
  approveOpenChannelMission,
  cancelOpenChannelDraft,
  completeOpenChannelTask,
  generateOpenChannelDraft,
  getGoldlineProgress,
  getCurrentOpenChannelMission,
  transcribeOpenChannelBriefing,
} from "./openChannelService";
import { OPEN_CHANNEL_TASK_CATEGORIES } from "./openChannelTypes";

const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const editableTask = z.object({
  title: z.string().trim().min(1).max(160),
  // Raised from 800 to accommodate a LOCAL_TARGET_RUN task's JSON-encoded
  // detail (§PR77 Part 8) — see the matching comment in openChannelService.ts.
  detail: z.string().trim().min(1).max(12_000),
  estimatedMinutes: z.number().int().min(5).max(240),
  category: z.enum(OPEN_CHANNEL_TASK_CATEGORIES),
  navigationQuery: z.string().trim().max(500).nullable(),
});

export const openChannelRouter = router({
  progress: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        businessDate,
        timeZone: z.string().trim().min(1).max(80),
      })
    )
    .query(({ ctx, input }) =>
      getGoldlineProgress({
        ...input,
        tenantId: ctx.tenantId,
        driverId: ctx.user.openId,
      })
    ),
  current: legacyDayforgeTenantMemberProcedure
    .input(z.object({ businessDate }))
    .query(({ ctx, input }) =>
      getCurrentOpenChannelMission({
        tenantId: ctx.tenantId,
        driverId: ctx.user.openId,
        businessDate: input.businessDate,
      })
    ),
  generateDraft: legacyDayforgeTenantMemberProcedure
    .input(
      z
        .object({
          businessDate,
          requestId: z.string().uuid(),
          now: z.coerce.date(),
          timeZone: z.string().trim().min(1).max(80),
          nextCommitmentAt: z.coerce.date().nullable(),
          availableMinutes: z
            .number()
            .int()
            .min(0)
            .max(24 * 60)
            .nullable(),
          currentLocation: z
            .object({
              latitude: z.number().min(-90).max(90),
              longitude: z.number().min(-180).max(180),
            })
            .nullable(),
          audioDataUrl: z.string().max(18_000_000).optional(),
          transcript: z.string().trim().max(20_000).optional(),
        })
        .refine(value => Boolean(value.audioDataUrl || value.transcript), {
          message: "A voice recording or typed briefing is required",
        })
    )
    .mutation(({ ctx, input }) =>
      generateOpenChannelDraft({
        ...input,
        tenantId: ctx.tenantId,
        driverId: ctx.user.openId,
      })
    ),
  transcribeBriefing: legacyDayforgeTenantMemberProcedure
    .input(z.object({ audioDataUrl: z.string().max(18_000_000) }))
    .mutation(({ ctx, input }) =>
      transcribeOpenChannelBriefing({
        ...input,
        tenantId: ctx.tenantId,
        driverId: ctx.user.openId,
      })
    ),
  cancelDraft: legacyDayforgeTenantMemberProcedure
    .input(z.object({ missionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      cancelOpenChannelDraft({
        ...input,
        tenantId: ctx.tenantId,
        driverId: ctx.user.openId,
      })
    ),
  approve: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        missionId: z.string().uuid(),
        title: z.string().trim().min(1).max(120),
        tasks: z.array(editableTask).min(1).max(10),
      })
    )
    .mutation(({ ctx, input }) =>
      approveOpenChannelMission({
        ...input,
        tenantId: ctx.tenantId,
        driverId: ctx.user.openId,
      })
    ),
  completeTask: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        missionId: z.string().uuid(),
        taskId: z.string().uuid(),
        requestId: z.string().uuid(),
      })
    )
    .mutation(({ ctx, input }) =>
      completeOpenChannelTask({
        ...input,
        tenantId: ctx.tenantId,
        driverId: ctx.user.openId,
        actorId: ctx.user.openId,
      })
    ),
});
