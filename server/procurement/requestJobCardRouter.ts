import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { listRequestJobCardSourceRecords } from "../db";
import {
  buildRequestJobCardPage,
  REQUEST_JOB_CARD_SOURCE_TYPES,
} from "./requestJobCardReadModel";

export const requestJobCardRouter = router({
  list: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(50).default(25),
      offset: z.number().int().min(0).max(1000).default(0),
      sources: z.array(z.enum(REQUEST_JOB_CARD_SOURCE_TYPES)).min(1).max(3).optional(),
    }).default({ limit: 25, offset: 0 }))
    .query(async ({ ctx, input }) => {
      const fetchCount = Math.min(1051, input.offset + input.limit + 1);
      const sources = await listRequestJobCardSourceRecords({
        tenantId: ctx.tenantId,
        sources: input.sources ?? [...REQUEST_JOB_CARD_SOURCE_TYPES],
        fetchCount,
      });
      return buildRequestJobCardPage({ sources, limit: input.limit, offset: input.offset });
    }),
});
