/**
 * The operator-facing shape of a strategic proposal that is prepared and
 * still waiting. It is not a Day Line commitment until Day Director accepts it.
 */
export type PreparedOpportunitySource = {
  pendingApproval: {
    proposalId: string;
    revision: string;
    itemIds: readonly string[];
  } | null;
  items: readonly {
    id: string;
    date: string;
    title: string;
    objective: string | null;
    status: string;
  }[];
  rationale: {
    diagnosis: string;
    approach: string;
  } | null;
};

export type PreparedOpportunity = {
  proposalId: string;
  revision: string;
  itemId: string;
  title: string;
  date: string;
  objective: string | null;
  reason: string;
  approach: string | null;
};

export function presentPreparedOpportunity(
  source: PreparedOpportunitySource | null | undefined
): PreparedOpportunity | null {
  if (!source) return null;
  const pending = source.pendingApproval;
  if (!pending?.proposalId || !pending.revision || pending.itemIds.length === 0) return null;
  const item = source.items.find(
    entry => entry.status === "awaiting_approval" && pending.itemIds.includes(entry.id)
  );
  if (!item?.title.trim()) return null;
  const diagnosis = source.rationale?.diagnosis.trim() ?? "";
  const approach = source.rationale?.approach.trim() ?? "";
  return {
    proposalId: pending.proposalId,
    revision: pending.revision,
    itemId: item.id,
    title: item.title.trim(),
    date: item.date,
    objective: item.objective,
    reason: diagnosis || "Claire prepared this from the stored strategic proposal.",
    approach: approach || null,
  };
}
