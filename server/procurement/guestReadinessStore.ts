import type { Pool, PoolConnection } from "mysql2/promise";
import type { GuestReadinessPlanDecision } from "./guestReadinessPolicy";

export class GuestReadinessPlanStore {
  constructor(private readonly pool: Pool) {}

  async createEvaluatedPlan(input: {
    id: string; authorityGrantId: string; tenantId: string; bldgUserId: number;
    buildingSlug: string; objectiveText: string; budgetCapCents: number; deadlineAt: Date;
    accessConstraints: unknown; sensitivityConstraints: unknown; decision: GuestReadinessPlanDecision;
  }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO guest_readiness_plans
          (id, authority_grant_id, tenant_id, bldg_user_id, building_slug, objective_text,
           budget_cap_cents, estimated_total_cents, deadline_at, access_constraints_json,
           sensitivity_constraints_json, truth_state, plan_status, approval_gates_json,
           decision_evidence_json, unsupported_reasons_json, evaluated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        [input.id, input.authorityGrantId, input.tenantId, input.bldgUserId, input.buildingSlug,
         input.objectiveText, input.budgetCapCents, input.decision.estimatedTotalCents, input.deadlineAt,
         JSON.stringify(input.accessConstraints), JSON.stringify(input.sensitivityConstraints),
         input.decision.truthState, input.decision.planStatus, JSON.stringify(input.decision.approvalGates),
         JSON.stringify({ reasons: input.decision.reasons }),
         input.decision.truthState === "unsupported" ? JSON.stringify(input.decision.reasons) : null],
      );
      for (const item of input.decision.items) await this.insertItem(connection, input.id, item);
      await connection.commit();
      return input.id;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async insertItem(connection: PoolConnection, planId: string, item: GuestReadinessPlanDecision["items"][number]) {
    await connection.execute(
      `INSERT INTO guest_readiness_plan_items
        (id, plan_id, category, description_text, estimated_cost_cents, scheduled_at,
         access_pattern, sensitivity_tags_json, risk_category, feasibility_classification,
         item_state, resident_approval_required, operator_review_required, decision_evidence_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.id, planId, item.category, item.descriptionText, item.estimatedCostCents, item.scheduledAt,
       item.accessPattern, JSON.stringify(item.sensitivityTags), item.riskCategory,
       item.feasibilityClassification, item.itemState, item.residentApprovalRequired,
       item.operatorReviewRequired, JSON.stringify({ reasons: item.reasons })],
    );
  }
}
