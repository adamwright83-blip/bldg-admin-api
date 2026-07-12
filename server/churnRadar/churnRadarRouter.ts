import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { buildWinBackDraft } from "./buildWinBackDraft";
import { scoreCustomerChurn } from "./scoreCustomerChurn";

const churnInputSchema = z.object({
  customerKey: z.string().min(1),
  customerName: z.string().min(1),
  orderDates: z.array(z.union([z.string(), z.date()])).min(1),
  orderValuesCents: z.array(z.number().int().nonnegative()),
  orderWeightsLbs: z.array(z.number().nonnegative()).optional(),
  unresolvedIssue: z.boolean().optional(),
  now: z.date().optional(),
});

export const churnRadarRouter = router({
  score: adminProcedure
    .input(churnInputSchema)
    .query(({ input }) => scoreCustomerChurn(input)),

  prepareWinBack: adminProcedure
    .input(
      z.object({
        customer: churnInputSchema,
        storeName: z.string().min(1),
        senderName: z.string().min(1),
        lastServiceLabel: z.string().nullable().optional(),
        unresolvedIssueSummary: z.string().nullable().optional(),
        schedulingLink: z.string().url().nullable().optional(),
      })
    )
    .mutation(({ input }) => {
      const score = scoreCustomerChurn(input.customer);
      return {
        score,
        draft: buildWinBackDraft({
          score,
          storeName: input.storeName,
          senderName: input.senderName,
          lastServiceLabel: input.lastServiceLabel,
          unresolvedIssueSummary: input.unresolvedIssueSummary,
          schedulingLink: input.schedulingLink,
        }),
      };
    }),
});
