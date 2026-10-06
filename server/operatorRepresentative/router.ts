import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { legacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { buildOperatorContextPacket } from "../persistentOperator/operatorContext";
import {
  CanonicalOperatorIdentityError,
  requireCanonicalOperatorIdentityForUser,
  type CanonicalOperatorIdentity,
} from "../persistentOperator/identity";
import {
  listActiveOperatorRepresentativeDirectives,
  loadOperatorRepresentativeDirectiveSnapshot,
  revokeOperatorRepresentativeDirective,
  setOperatorRepresentativeDirective,
  type OperatorRepresentativeDirectiveKind,
} from "./directives";
import { buildOperatorRepresentativeSnapshot } from "./readModel";
import { answerOperatorRepresentativeQuestion } from "./talk";
import type { OperatorRepresentativeItemDetail } from "./types";
import {
  buildDaphneAdaptationLifecycle,
  buildOperatorRepresentativeAdaptationPolicy,
} from "./adaptation";
import { listDaphneAdaptationReceipts } from "./adaptationReceipts";

function identityFailure(error: unknown): never {
  if (error instanceof CanonicalOperatorIdentityError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.reason,
    });
  }
  throw error;
}

async function resolveIdentity(input: {
  callerUser: Parameters<typeof requireCanonicalOperatorIdentityForUser>[0]["user"];
  tenantId: string;
  subsystem: string;
}): Promise<CanonicalOperatorIdentity> {
  return requireCanonicalOperatorIdentityForUser({
    tenantId: input.tenantId,
    user: input.callerUser,
    subsystem: input.subsystem,
  });
}

async function loadSnapshot(input: {
  identity: CanonicalOperatorIdentity;
}) {
  const [packet, directiveSnapshot] = await Promise.all([
    buildOperatorContextPacket({
      tenantId: input.identity.tenantId,
      identity: input.identity,
    }),
    loadOperatorRepresentativeDirectiveSnapshot({
      tenantId: input.identity.tenantId,
      canonicalOperatorId: input.identity.canonicalOperatorId,
      recentHistoryLimit: 100,
    }),
  ]);
  const directives = directiveSnapshot.directives;
  const snapshot = buildOperatorRepresentativeSnapshot({
    identity: input.identity,
    packet,
    directives,
  });
  return {
    packet,
    directives,
    activeDirectives: directiveSnapshot.active,
    recentDirectiveHistory: directiveSnapshot.recentHistory,
    snapshot,
  };
}

function validateDirectiveTarget(input: {
  kind: OperatorRepresentativeDirectiveKind;
  detail: OperatorRepresentativeItemDetail | undefined;
  correctionValue?: string | null;
}) {
  const detail = input.detail;
  if (!detail) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Operator Representative item not found" });
  }
  if (input.kind === "correction" && !detail.canCorrect) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This item cannot be corrected through Operator Representative",
    });
  }
  if (input.kind === "correction" && !input.correctionValue?.trim()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A corrected value is required",
    });
  }
  if (input.kind === "suppress" && !detail.canSuppress) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This item is not an adaptation signal that can be suppressed",
    });
  }
  if (input.kind === "ask_instead" && !detail.canAskInstead) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This item is not eligible for an ask-first directive",
    });
  }
  return detail;
}

const directiveKindSchema = z.enum(["correction", "suppress", "ask_instead"]);

export const operatorRepresentativeRouter = router({
  home: legacyDayforgeTenantMemberProcedure
    .query(async ({ ctx }) => {
      try {
        const identity = await resolveIdentity({
          callerUser: ctx.user,
          tenantId: ctx.tenantId,
          subsystem: "operator_representative.home",
        });
        return (await loadSnapshot({ identity })).snapshot.home;
      } catch (error) {
        identityFailure(error);
      }
    }),

  itemDetail: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        itemId: z.string().trim().min(1).max(191),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const identity = await resolveIdentity({
          callerUser: ctx.user,
          tenantId: ctx.tenantId,
          subsystem: "operator_representative.item_detail",
        });
        const { snapshot } = await loadSnapshot({ identity });
        const detail = snapshot.details.get(input.itemId);
        if (!detail) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Operator Representative item not found" });
        }
        return detail;
      } catch (error) {
        identityFailure(error);
      }
    }),

  adaptationStatus: legacyDayforgeTenantMemberProcedure
    .query(async ({ ctx }) => {
      try {
        const identity = await resolveIdentity({
          callerUser: ctx.user,
          tenantId: ctx.tenantId,
          subsystem: "operator_representative.adaptation_status",
        });
        const [activeDirectives, directiveSnapshot, receipts] = await Promise.all([
          listActiveOperatorRepresentativeDirectives({
            tenantId: identity.tenantId,
            canonicalOperatorId: identity.canonicalOperatorId,
          }),
          loadOperatorRepresentativeDirectiveSnapshot({
            tenantId: identity.tenantId,
            canonicalOperatorId: identity.canonicalOperatorId,
            recentHistoryLimit: 100,
          }),
          listDaphneAdaptationReceipts({
            tenantId: identity.tenantId,
            canonicalOperatorId: identity.canonicalOperatorId,
            limit: 250,
          }),
        ]);
        const policy = buildOperatorRepresentativeAdaptationPolicy({
          tenantId: identity.tenantId,
          directives: activeDirectives,
        });
        return {
          ...policy,
          lifecycle: buildDaphneAdaptationLifecycle({
            enabled: policy.enabled,
            directives: directiveSnapshot.directives,
            receipts,
          }),
        };
      } catch (error) {
        identityFailure(error);
      }
    }),

  directive: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        itemId: z.string().trim().min(1).max(191),
        kind: directiveKindSchema,
        correctionValue: z.string().trim().min(1).max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const identity = await resolveIdentity({
          callerUser: ctx.user,
          tenantId: ctx.tenantId,
          subsystem: "operator_representative.directive",
        });
        const { snapshot } = await loadSnapshot({ identity });
        const detail = validateDirectiveTarget({
          kind: input.kind,
          detail: snapshot.details.get(input.itemId),
          correctionValue: input.correctionValue,
        });
        return setOperatorRepresentativeDirective({
          tenantId: identity.tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          targetItemId: detail.item.id,
          targetKey: detail.item.targetKey ?? null,
          directiveKind: input.kind,
          operatorDeclaredValue:
            input.kind === "correction"
              ? { value: input.correctionValue!.trim() }
              : null,
          createdByOpenId: ctx.user.openId,
        });
      } catch (error) {
        identityFailure(error);
      }
    }),

  revokeDirective: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        directiveId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const identity = await resolveIdentity({
          callerUser: ctx.user,
          tenantId: ctx.tenantId,
          subsystem: "operator_representative.revoke_directive",
        });
        const row = await revokeOperatorRepresentativeDirective({
          tenantId: identity.tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          directiveId: input.directiveId,
        });
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Directive not found" });
        return row;
      } catch (error) {
        identityFailure(error);
      }
    }),

  ask: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        question: z.string().trim().min(1).max(2000),
        focusedItemId: z.string().trim().min(1).max(191).optional(),
        correctionValue: z.string().trim().min(1).max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const identity = await resolveIdentity({
          callerUser: ctx.user,
          tenantId: ctx.tenantId,
          subsystem: "operator_representative.ask",
        });
        const { snapshot } = await loadSnapshot({ identity });
        const answer = answerOperatorRepresentativeQuestion({
          question: input.question,
          snapshot,
          focusedItemId: input.focusedItemId,
          correctionValue: input.correctionValue,
        });

        if (!answer.directiveRequest) return answer;

        const detail = validateDirectiveTarget({
          kind: answer.directiveRequest.kind,
          detail: snapshot.details.get(answer.directiveRequest.itemId),
          correctionValue: answer.directiveRequest.value,
        });
        const directive = await setOperatorRepresentativeDirective({
          tenantId: identity.tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          targetItemId: detail.item.id,
          targetKey: detail.item.targetKey ?? null,
          directiveKind: answer.directiveRequest.kind,
          operatorDeclaredValue:
            answer.directiveRequest.kind === "correction"
              ? { value: answer.directiveRequest.value! }
              : null,
          createdByOpenId: ctx.user.openId,
        });

        return {
          ...answer,
          directiveRequest: undefined,
          directiveId: directive.id,
        };
      } catch (error) {
        identityFailure(error);
      }
    }),
});
