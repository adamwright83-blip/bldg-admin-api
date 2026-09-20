import { describe, expect, it } from "vitest";
import { salesFollowUpObligation } from "../../../shared/claireProactive";
import { operatorVisibleObligations } from "../proactive/boardService";
import { loadDayWork } from "./operationsKnowledge";
import { filterOperatorVisibleDayforgeRows } from "../../dayforgeToday/dayforgeTodayService";
import { isOperatorVisibleMissionSnapshot } from "./sourceVisibility";

const PRODUCTION = { tenantId: "default", operatorUserId: "adam-admin" };
const WRITER = {
  providerName: "production-verifier",
  accountType: "property_management_test",
  identityKey: "not-a-prefix-hash",
  name: "A perfectly ordinary hotel name",
};
const REAL = {
  providerName: "greystar",
  accountType: "luxury_hotel",
  identityKey: "acct:louise",
  name: "The Louise",
};

describe("synthetic commercial leak — real reader joins", () => {
  it("proactive board does not surface a verification-writer sales follow-up", () => {
    const synthetic = salesFollowUpObligation({
      accountKey: "99",
      accountName: "A perfectly ordinary hotel name",
      dueDate: "2026-09-22",
      nextStep: "Call the property manager",
      lastOutcome: null,
      history: ["Call the property manager"],
      accountProvenance: WRITER,
    });
    const real = salesFollowUpObligation({
      accountKey: "11",
      accountName: "The Louise",
      dueDate: "2026-09-22",
      nextStep: "Bring the rate card",
      lastOutcome: null,
      history: ["Bring the rate card"],
      accountProvenance: REAL,
    });
    const visible = operatorVisibleObligations([synthetic, real], PRODUCTION);
    expect(visible.map(item => item.accountProvenance?.providerName)).toEqual(["greystar"]);
    expect(visible.some(item => item.title === synthetic.title)).toBe(false);
  });

  it("account-history mission snapshots hide fixture evidence without reading the title", () => {
    expect(
      isOperatorVisibleMissionSnapshot({
        name: "A perfectly ordinary hotel name",
        accountType: WRITER.accountType,
        providerName: WRITER.providerName,
        evidence: [{ fixture: true, externalProvider: false }],
      })
    ).toBe(false);
    expect(
      isOperatorVisibleMissionSnapshot({
        name: REAL.name,
        accountType: REAL.accountType,
        providerName: REAL.providerName,
        evidence: [{ fixture: false }],
      })
    ).toBe(true);
  });

  it("Day Line / operations does not surface derived synthetic work, and keeps real rows", async () => {
    const work = await loadDayWork(
      {
        tenantId: "default",
        operatorUserId: "adam-admin",
        dayDirectorActorId: "1",
        businessDate: "2026-09-20",
        now: new Date("2026-09-20T18:00:00Z"),
        timeZone: "America/Los_Angeles",
      },
      {
        getState: async () =>
          ({
            commitments: [
              {
                id: "syn",
                title: "Follow up: A perfectly ordinary hotel name",
                status: "open",
                detailNote: null,
                completedAt: null,
                claireProactive: true,
                proactiveSourceKind: "sales_follow_up",
                accountProvenance: WRITER,
              },
              {
                id: "real",
                title: "Follow up: The Louise",
                status: "open",
                detailNote: null,
                completedAt: null,
                claireProactive: true,
                proactiveSourceKind: "sales_follow_up",
                accountProvenance: REAL,
              },
              {
                id: "legacy",
                title: "Follow up: A perfectly ordinary hotel name",
                status: "open",
                detailNote: null,
                completedAt: null,
                claireProactive: true,
                proactiveSourceKind: "sales_follow_up",
              },
            ],
          }) as never,
        getField: async () =>
          ({
            timeline: [
              {
                id: "route-syn",
                kind: "follow_up",
                title: "A perfectly ordinary hotel name",
                scheduledAt: null,
                accountProvenance: WRITER,
              },
              {
                id: "route-real",
                kind: "follow_up",
                title: "The Louise",
                scheduledAt: null,
                accountProvenance: REAL,
              },
            ],
          }) as never,
      }
    );
    expect(work.open.map(item => item.title).join(" ")).toMatch(/The Louise/);
    expect(work.open.some(item => item.id === "day-director:syn" || item.id === "route-syn" || item.id === "day-director:legacy")).toBe(false);
    expect(work.open.some(item => item.id === "day-director:real")).toBe(true);
    expect(work.open.some(item => item.id === "route-real")).toBe(true);
  });

  it("Field Today / Dayforge join-shaped rows drop the verification writer and keep real commercial", () => {
    const rows = [
      { accountName: WRITER.name, accountType: WRITER.accountType, providerName: WRITER.providerName, identityKey: WRITER.identityKey },
      { accountName: REAL.name, accountType: REAL.accountType, providerName: REAL.providerName, identityKey: REAL.identityKey },
    ];
    const visible = filterOperatorVisibleDayforgeRows(rows, PRODUCTION);
    expect(visible).toEqual([rows[1]]);
  });
});
