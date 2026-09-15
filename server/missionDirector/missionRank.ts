/**
 * Deterministic Mission Director ranking. LLM never ranks.
 * campaignId is the final equal-score tie-break only.
 */
import type { GrowthCampaign, MissionCategory } from "../campaignLibrary/campaignLibraryTypes";
import type { MissionRankEvidence, RankFactor, TimePocket } from "./missionDirectorTypes";

export type RankingOpenTask = {
  taskType: string;
  status: string;
  priority: "emergency" | "high" | "normal" | "low";
  dueAt: string | null;
};

export type RankingMacroGoal = {
  metricKey: string;
  targetValue: number;
  objective: string;
};

export type RankingContext = {
  businessDate: string;
  macroGoal: RankingMacroGoal | null;
  openTasks: readonly RankingOpenTask[];
  /** Explicit operator campaign priority when stored on the campaign row. */
  campaignPriorityById?: Record<string, number>;
};

const PRIORITY_EFFECT: Record<RankingOpenTask["priority"], number> = {
  emergency: 400,
  high: 300,
  normal: 100,
  low: 40,
};

const ACTIVE_CUSTOMER_CATEGORIES = new Set<MissionCategory>([
  "account_acquisition",
  "retention",
]);

function factor(
  name: string,
  value: RankFactor["value"],
  source: string,
  effect: number,
  confidence: RankFactor["confidence"]
): RankFactor {
  return { name, value, source, effect, confidence };
}

function tasksFor(campaign: GrowthCampaign, context: RankingContext): RankingOpenTask[] {
  return context.openTasks.filter(task => task.taskType === campaign.opsTaskType);
}

export function rankCampaigns(input: {
  campaigns: readonly GrowthCampaign[];
  context: RankingContext;
  pockets?: readonly TimePocket[];
}): MissionRankEvidence[] {
  const ranked = input.campaigns.map(campaign => rankOne(campaign, input.context, input.pockets ?? []));
  ranked.sort(
    (a, b) => b.score - a.score || a.campaignId.localeCompare(b.campaignId)
  );
  return ranked;
}

function rankOne(
  campaign: GrowthCampaign,
  context: RankingContext,
  pockets: readonly TimePocket[]
): MissionRankEvidence {
  const factors: RankFactor[] = [];
  const warnings: string[] = [];
  const open = tasksFor(campaign, context);

  const explicitCampaignPriority = context.campaignPriorityById?.[campaign.campaignId];
  if (explicitCampaignPriority != null) {
    factors.push(
      factor(
        "explicit_operator_priority",
        explicitCampaignPriority,
        "campaign_operator_priority",
        explicitCampaignPriority,
        "high"
      )
    );
  } else {
    const highest = open.reduce<RankingOpenTask["priority"] | null>((current, task) => {
      if (!current) return task.priority;
      return PRIORITY_EFFECT[task.priority] > PRIORITY_EFFECT[current] ? task.priority : current;
    }, null);
    if (highest) {
      factors.push(
        factor(
          "explicit_operator_priority",
          highest,
          `ops_tasks.priority for ${campaign.opsTaskType}`,
          PRIORITY_EFFECT[highest],
          "high"
        )
      );
    } else {
      factors.push(
        factor(
          "explicit_operator_priority",
          null,
          "none — campaign has no operator priority field and no open ops task",
          0,
          "unknown"
        )
      );
    }
  }

    const unfinished = open.filter(task =>
      task.status === "open" || task.status === "accepted" || task.status === "in_progress"
    );
  if (unfinished.length) {
    factors.push(
      factor(
        "continuity_unfinished_work",
        unfinished.length,
        `open ops_tasks.taskType=${campaign.opsTaskType}`,
        250,
        "high"
      )
    );
  } else {
    factors.push(
      factor("continuity_unfinished_work", 0, "no open ops task of this campaign type", 0, "high")
    );
  }

  const goal = context.macroGoal;
  if (goal?.metricKey === "active_customers" && ACTIVE_CUSTOMER_CATEGORIES.has(campaign.missionCategory)) {
    factors.push(
      factor(
        "macro_goal_alignment",
        `${goal.metricKey}:${campaign.missionCategory}`,
        "operator_macro_goals.metricKey + goldline_campaigns.missionCategory",
        150,
        "high"
      )
    );
  } else if (goal) {
    factors.push(
      factor(
        "macro_goal_alignment",
        `${goal.metricKey}:${campaign.missionCategory}`,
        "no legitimate category link for this metric",
        0,
        "high"
      )
    );
  } else {
    factors.push(factor("macro_goal_alignment", null, "no active macro goal", 0, "unknown"));
  }

  const overdue = unfinished.some(
    task => task.dueAt != null && task.dueAt.slice(0, 10) <= context.businessDate
  );
  factors.push(
    factor(
      "overdue_open_work",
      overdue,
      overdue ? `ops_tasks.dueAt <= ${context.businessDate}` : "no overdue open task of this type",
      overdue ? 200 : 0,
      unfinished.length ? "high" : "unknown"
    )
  );

  factors.push(
    factor(
      "prep_readiness",
      true,
      "eligibility already required prepReady",
      20,
      "high"
    )
  );

  const bestUsable = pockets
    .filter(pocket => pocket.confidence === "high" && pocket.usableMinutes != null)
    .map(pocket => pocket.usableMinutes as number)
    .sort((a, b) => b - a)[0];
  if (bestUsable == null) {
    factors.push(
      factor("pocket_feasibility", null, "no high-confidence pocket with usable minutes", 0, "low")
    );
    warnings.push("No high-confidence usable pocket; duration remains unknown.");
  } else if (bestUsable < campaign.pocketMinutesMin) {
    factors.push(
      factor(
        "pocket_feasibility",
        bestUsable,
        "detectTimePockets.usableMinutes",
        0,
        "high"
      )
    );
  } else {
    const ratio = campaign.pocketMinutesMin / bestUsable;
    const fitEffect = ratio >= 0.5 ? 40 : 10;
    factors.push(
      factor(
        "pocket_fit",
        Number(ratio.toFixed(4)),
        "campaign.pocketMinutesMin / pocket.usableMinutes",
        fitEffect,
        "high"
      )
    );
  }

  const durationWarnings = pockets.flatMap(pocket => pocket.warnings);
  if (durationWarnings.some(warning => /service duration is unknown/i.test(warning))) {
    warnings.push("Unknown service duration is visible: usable time uses a named conservative reserve, not a measured stop duration.");
  }
  if (durationWarnings.some(warning => /not verified travel time/i.test(warning))) {
    warnings.push("Unknown travel does not become fake duration; travelReserveMinutes remains a named safety reserve.");
  }
  factors.push(
    factor("invented_economics", null, "no conversion/revenue/LTV/ROI inputs exist for ranking", 0, "unknown")
  );
  warnings.push("No expected revenue, conversion probability, LTV, or ROI was used.");

  const score = factors.reduce((sum, item) => sum + item.effect, 0);
  const confidence: "high" | "low" = factors.some(
    item => item.effect > 0 && item.confidence === "high"
  )
    ? "high"
    : "low";
  return { campaignId: campaign.campaignId, score, confidence, factors, warnings };
}

export function whySelected(evidence: MissionRankEvidence): string[] {
  return evidence.factors
    .filter(item => item.effect > 0)
    .map(item => `${item.name}: ${String(item.value)} (+${item.effect}, ${item.source})`);
}
