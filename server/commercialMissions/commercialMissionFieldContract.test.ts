import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../drizzle/0038_commercial_mission_field.sql", import.meta.url),
  "utf8"
);
const service = readFileSync(
  new URL("./commercialMissionFieldService.ts", import.meta.url),
  "utf8"
);
const router = readFileSync(
  new URL("./commercialMissionRouter.ts", import.meta.url),
  "utf8"
);
const client = readFileSync(
  new URL("../../client/src/pages/CommercialSalesMission.tsx", import.meta.url),
  "utf8"
);
const app = readFileSync(
  new URL("../../client/src/App.tsx", import.meta.url),
  "utf8"
);
const login = readFileSync(
  new URL("../../server/_core/index.ts", import.meta.url),
  "utf8"
);
const sdk = readFileSync(
  new URL("../../server/_core/sdk.ts", import.meta.url),
  "utf8"
);

describe("DayForge Field production contract", () => {
  it("stores resumable Field state, checklist snapshots, outcomes, and secure handoffs", () => {
    for (const table of [
      "tenant_field_checklist_templates",
      "commercial_mission_field_states",
      "commercial_mission_field_checklist_items",
      "commercial_mission_phone_handoffs",
    ])
      expect(migration).toContain(`CREATE TABLE \`${table}\``);
    expect(migration).toContain("uq_commercial_visit_outcomes_tenant_mission");
    expect(migration).toContain("enum('user','admin','driver')");
  });

  it("records lifecycle mutations transactionally and version-checks mutable Field state", () => {
    expect(service).toContain("transitionCommercialMissionWith(tx");
    expect(service).toContain(
      "eq(commercialMissionFieldStates.version, input.expectedFieldVersion)"
    );
    expect(service).toContain(
      "field checklist update lost a concurrency race".replace(/^f/, "F")
    );
    expect(service).toContain('toStatus: "visit_completed"');
    expect(service).toContain(
      "idempotencyKey: `field-outcome:${input.requestId}`"
    );
    expect(service).toContain("mission.opportunity.estimatedAnnualValueCents");
    expect(router).not.toContain("estimatedContractValueCents: z");
    expect(service).toContain(
      "Field preparation has no required checklist items"
    );
    expect(service).toContain("const concurrentRows = await db");
  });

  it("derives assignment and actor from the signed session", () => {
    expect(router).toContain("assertDriverCanReadMission");
    expect(router).toContain("actorId: ctx.user.openId");
    expect(router).not.toContain("actorId: input.actorId");
    expect(login).toContain('requestedRole === "driver"');
    expect(login).toContain("process.env.DRIVER_PASSWORD");
    expect(login).toContain("crypto.timingSafeEqual");
    expect(login).toContain("isAuthLoginRateLimited(req, role)");
    expect(sdk).toContain('role: options.role ?? "user"');
    expect(sdk).toContain(
      'role === "admin" || role === "driver" ? role : "user"'
    );
  });

  it("routes the real driver URL and never uses browser storage as authority", () => {
    expect(app.match(/\/driver\/sales-mission\/:missionId/g)).toHaveLength(2);
    expect(client).toContain("fieldState.useQuery");
    expect(client).toContain("fieldOutcome.useMutation");
    expect(client).not.toContain("localStorage");
    expect(client).not.toContain("DEMO_MISSION");
  });

  it("uses an expiring HMAC-derived handoff token without persisting plaintext", () => {
    expect(service).toContain('createHmac("sha256", secret)');
    expect(service).toContain("tokenHash: hashToken(token)");
    expect(service).not.toMatch(/token:\s*token[,}]/);
    expect(service).toContain("handoff.expiresAt.getTime() <= Date.now()");
  });
});
