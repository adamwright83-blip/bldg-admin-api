/* LEGACY DAYFORGE COMPATIBILITY: test-only fixture table literals. */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemRouter } from "../_core/systemRouter";
import { recordDaphneIntervention } from "./interventionLedger";
import { recordDaphneOutcome } from "./outcomeLedger";
import { resolveCanonicalOperatorIdentity } from "../persistentOperator/identity";
import { deleteTenantData, planTenantDeletion } from "../saas/tenantLifecycle";

const DATABASE_URL = process.env.DATABASE_URL;
const describeMysql = DATABASE_URL ? describe : describe.skip;

describeMysql("Daphne V2 verified outcome -> later authenticated policy decision", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const tenantId = `daphne-feedback-${suffix}`;
  const openId = `daphne-feedback-user-${suffix}`;
  let db: mysql.Connection;
  let numericId = 0;
  let canonicalOperatorId = "";

  beforeAll(async () => {
    db = await mysql.createConnection(DATABASE_URL!);
    await db.execute(
      `INSERT INTO dayforge_saas_tenants
        (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status)
       VALUES (?,?,?,?,?,?,?,?, 'active')`,
      [tenantId,tenantId,tenantId,tenantId,"#111111",tenantId,
       `${tenantId}@example.invalid`,"America/Los_Angeles"]
    );
    const [insert] = await db.execute<mysql.ResultSetHeader>(
      `INSERT INTO users (tenantId,openId,name,email,role,loginMethod)
       VALUES (?,?,?,?, 'user','password')`,
      [tenantId,openId,openId,`${openId}@example.invalid`]
    );
    numericId = insert.insertId;
    await db.execute(
      `INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active)
       VALUES (?,?,'owner',true)`, [tenantId,openId]
    );
    const resolved = await resolveCanonicalOperatorIdentity({
      tenantId,source:{type:"open_id",value:openId},
      subsystem:"daphne_v2_learned_policy_acceptance",
    });
    if (!resolved.ok) throw new Error(`Canonical operator unresolved: ${resolved.reason}`);
    canonicalOperatorId = resolved.identity.canonicalOperatorId;
  },120_000);

  afterAll(async () => {
    await db?.end();
    const plan = await planTenantDeletion(tenantId);
    if (plan.totalRows > 0) {
      await deleteTenantData({
        tenantId,expectedTotalRows:plan.totalRows,confirmation:tenantId,
      });
    }
  },120_000);

  const caller = () => systemRouter.createCaller({
    req:{headers:{host:"admin.bldg.chat"},protocol:"https"},res:{},
    user:{
      id:numericId,openId,role:"user",tenantId,name:openId,
      email:`${openId}@example.invalid`,loginMethod:"password",
      createdAt:new Date(),updatedAt:new Date(),lastSignedIn:new Date(),
    },vendorSession:null,tenantId,
  } as never);

  const input = {
    contextKey:"morning",policyVersion:"feedback-v1",
    options:[
      {key:"brief",burden:0,relationshipRisk:0,preferenceFit:0,uncertainty:0},
      {key:"ask",burden:0,relationshipRisk:0,preferenceFit:0,uncertainty:0},
    ],
  };

  async function seed(action:"brief"|"ask",value:number,index:number) {
    const intervention = await recordDaphneIntervention({
      tenantId,canonicalOperatorId,agentId:"claire",
      decisionPointId:`feedback-${index}`,contextKey:"morning",
      acceptableActions:["brief","ask"],chosenAction:action,
      selectionMode:"manual",policyVersion:"feedback-v1",
      sourceObservationIds:[`fixture-observation-${index}`],
      idempotencyKey:`feedback-intervention-${index}`,
    });
    await recordDaphneOutcome({
      tenantId,canonicalOperatorId,interventionId:intervention.id,
      outcomeClass:"proximal",measureKey:"started",value,
      evidenceClass:"system_record",verificationStatus:"verified",
      sourceReference:`fixture-system-${index}`,
      observedAt:new Date(),
      idempotencyKey:`feedback-outcome-${index}`,
    });
  }

  it("changes a later policy decision using persisted verified outcomes", async () => {
    const authenticated = caller();
    const before = await authenticated.daphne.learnedPolicyPreview(input);
    expect(before).toMatchObject({
      status:"insufficient_evidence",action:"no_intervention",
    });

    await seed("brief",1,0);
    await seed("brief",1,1);
    await seed("ask",0,2);
    await seed("ask",0,3);
    const first = await authenticated.daphne.learnedPolicyPreview(input);
    expect(first).toMatchObject({
      status:"evaluated",action:"brief",epistemicStatus:"association_only",
      sampleCounts:{brief:2,ask:2},
    });

    for(let i=4;i<7;i++) await seed("brief",0,i);
    for(let i=7;i<10;i++) await seed("ask",1,i);
    const later = await authenticated.daphne.learnedPolicyPreview(input);
    expect(later).toMatchObject({
      status:"evaluated",action:"ask",epistemicStatus:"association_only",
      sampleCounts:{brief:5,ask:5},
    });
    expect(later.evidenceRefs.length).toBeGreaterThan(0);
  },120_000);
});
