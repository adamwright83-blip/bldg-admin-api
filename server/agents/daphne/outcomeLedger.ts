import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { daphneOutcomes } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { recordDaphneMetricEvent } from "./metrics";

export type DaphneOutcomeClass = "proximal" | "distal" | "burden" | "relationship";
export type DaphneOutcomeRecord = {
  id: string; tenantId: string; canonicalOperatorId: string; interventionId: string | null;
  outcomeClass: DaphneOutcomeClass; measureKey: string; value: unknown;
  evidenceClass: "authoritative_external" | "system_record" | "operator_attested";
  verificationStatus: "verified" | "attested" | "disputed" | "rejected";
  sourceReference: string; windowStart: string | null; windowEnd: string | null;
  observedAt: string; idempotencyKey: string; createdAt: string;
};

export type RecordDaphneOutcomeInput = Omit<DaphneOutcomeRecord, "id" | "createdAt" | "windowStart" | "windowEnd" | "observedAt"> & {
  windowStart?: string | Date | null; windowEnd?: string | Date | null; observedAt: string | Date;
};

function req(value: string, label: string, max=191) {
  const v=value.trim(); if(!v) throw new Error(`Daphne outcome requires ${label}`);
  if(v.length>max) throw new Error(`${label} exceeds ${max} characters`); return v;
}
function date(value: string|Date|null|undefined,label:string): Date|null {
  if(value==null) return null; const d=value instanceof Date?new Date(value):new Date(value);
  if(Number.isNaN(d.getTime())) throw new Error(`Daphne outcome ${label} must be a valid date`); return d;
}
function businessMeasure(key:string):boolean {
  return /^(business|revenue|payment|customer|order):/i.test(key);
}
export function validateDaphneOutcome(input: RecordDaphneOutcomeInput): void {
  req(input.sourceReference,"sourceReference");
  if (businessMeasure(input.measureKey)) {
    if (input.verificationStatus !== "verified" || !["authoritative_external","system_record"].includes(input.evidenceClass)) {
      throw new Error("Daphne business outcomes require verified authoritative/system evidence");
    }
  }
  const start=date(input.windowStart,"windowStart"), end=date(input.windowEnd,"windowEnd");
  if(start&&end&&end.getTime()<start.getTime()) throw new Error("Daphne outcome windowEnd cannot precede windowStart");
}
function id(input:RecordDaphneOutcomeInput){
  return `dout_${createHash("sha256").update([input.tenantId,input.canonicalOperatorId,input.idempotencyKey].join("\u0000")).digest("hex").slice(0,46)}`;
}
function record(row:typeof daphneOutcomes.$inferSelect):DaphneOutcomeRecord {
  return {
    id:row.id,tenantId:row.tenantId,canonicalOperatorId:row.canonicalOperatorId,interventionId:row.interventionId,
    outcomeClass:row.outcomeClass,measureKey:row.measureKey,value:row.valueJson,evidenceClass:row.evidenceClass,
    verificationStatus:row.verificationStatus,sourceReference:row.sourceReference,
    windowStart:row.windowStart?.toISOString()??null,windowEnd:row.windowEnd?.toISOString()??null,
    observedAt:row.observedAt.toISOString(),idempotencyKey:row.idempotencyKey,createdAt:row.createdAt.toISOString()
  };
}
export async function recordDaphneOutcome(input:RecordDaphneOutcomeInput):Promise<DaphneOutcomeRecord>{
  validateDaphneOutcome(input); const db=await getDb(); if(!db) throw new Error("Database unavailable");
  const rowId=id(input);
  await db.insert(daphneOutcomes).values({
    id:rowId,tenantId:req(input.tenantId,"tenantId",64),canonicalOperatorId:req(input.canonicalOperatorId,"canonicalOperatorId",191),
    interventionId:input.interventionId?.trim()||null,outcomeClass:input.outcomeClass,measureKey:req(input.measureKey,"measureKey",128),
    valueJson:input.value,evidenceClass:input.evidenceClass,verificationStatus:input.verificationStatus,
    sourceReference:req(input.sourceReference,"sourceReference",191),windowStart:date(input.windowStart,"windowStart"),
    windowEnd:date(input.windowEnd,"windowEnd"),observedAt:date(input.observedAt,"observedAt")!,
    idempotencyKey:req(input.idempotencyKey,"idempotencyKey",191)
  }).onDuplicateKeyUpdate({set:{id:rowId}});
  const [row]=await db.select().from(daphneOutcomes).where(eq(daphneOutcomes.id,rowId)).limit(1);
  if(!row) throw new Error("Daphne outcome did not persist");
  await recordDaphneMetricEvent({
    tenantId:row.tenantId,canonicalOperatorId:row.canonicalOperatorId,eventName:"outcome_linked",
    properties:{outcomeClass:row.outcomeClass,measureKey:row.measureKey,verificationStatus:row.verificationStatus},
    sourceReference:row.id,occurredAt:row.observedAt,idempotencyKey:`outcome:${row.id}`
  }).catch(()=>undefined);
  return record(row);
}
export async function listDaphneOutcomes(input:{tenantId:string;canonicalOperatorId:string;limit?:number}):Promise<DaphneOutcomeRecord[]>{
  const db=await getDb(); if(!db) throw new Error("Database unavailable");
  const rows=await db.select().from(daphneOutcomes).where(and(
    eq(daphneOutcomes.tenantId,req(input.tenantId,"tenantId",64)),
    eq(daphneOutcomes.canonicalOperatorId,req(input.canonicalOperatorId,"canonicalOperatorId",191))
  )).orderBy(desc(daphneOutcomes.observedAt)).limit(Math.max(1,Math.min(input.limit??100,500)));
  return rows.map(record);
}
