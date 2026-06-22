import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { createProcurementPool } from "./migrations";
import { VendorProposalReviewStore } from "./vendorProposalReviewStore";

type ReviewStore = Pick<VendorProposalReviewStore, "listVersions" | "getVersion">;
let lazyStore: VendorProposalReviewStore | null = null;

function resolveStore(injected?: ReviewStore): ReviewStore {
  if (injected) return injected;
  if (!lazyStore) lazyStore = new VendorProposalReviewStore(createProcurementPool());
  return lazyStore;
}

export function createVendorProposalReviewRouter(injectedStore?: ReviewStore) {
  return router({
    list: adminProcedure.input(z.object({
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).max(1000).default(0),
    }).default({ limit: 20, offset: 0 })).query(({ input }) =>
      resolveStore(injectedStore).listVersions(input)),
    get: adminProcedure.input(z.object({ versionId: z.string().min(1).max(191) })).query(async ({ input }) => {
      const preview = await resolveStore(injectedStore).getVersion(input.versionId);
      if (!preview) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal version not found" });
      return preview;
    }),
  });
}

export const vendorProposalReviewRouter = createVendorProposalReviewRouter();
