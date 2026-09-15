import { claireRouter } from "../server/claire/claireRouter";

const caller = claireRouter.createCaller({
  req: undefined,
  res: undefined,
  vendorSession: null,
  tenantId: "default",
  user: {
    id: 0,
    tenantId: "default",
    openId: "adam-admin",
    name: "Admin",
    email: null,
    loginMethod: null,
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
} as never);

const saved = await caller.setMacroGoal({
  operatorUserId: "adam-admin",
  objective: "Get to 50 active customers",
  metricKey: "active_customers",
  targetValue: 50,
  unit: "customers",
  urgencyText: "ASAP",
  source: "operator_attested",
  sourceNote: "Russell's objective, reported by Adam",
  targetDate: null,
});

console.log(JSON.stringify({
  id: saved.id,
  objective: saved.objective,
  metricKey: saved.metricKey,
  targetValue: saved.targetValue,
  status: saved.status,
}));
