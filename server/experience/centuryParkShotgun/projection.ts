import type { ScheduledOutreachMessageRow } from "../../../drizzle/schema";
import { CPE_SHOTGUN_TERRITORY } from "../../../shared/centuryParkShotgun";
import { normalizeSmsPhone } from "../../_core/sms";
import type { ShotRow } from "./schema";

export function matchesShotApproval(
  shot: ShotRow,
  message: ScheduledOutreachMessageRow
) {
  return (
    message.tenantId === shot.tenantId &&
    message.operatorId === shot.operatorId &&
    message.customerId === shot.customerId &&
    normalizeSmsPhone(message.recipientPhone) === shot.recipientPhone &&
    message.territoryId === CPE_SHOTGUN_TERRITORY &&
    message.currentMessageBody === shot.approval.messageBody &&
    message.scheduledFor.getTime() === shot.scheduledFor.getTime() &&
    message.revisionCount === 1
  );
}
