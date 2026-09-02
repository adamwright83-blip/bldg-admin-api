const fs = require("fs");

function replaceOne(path, oldText, newText) {
  let s = fs.readFileSync(path, "utf8");
  const count = s.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${path}: expected 1 match, found ${count}`);
  fs.writeFileSync(path, s.replace(oldText, newText));
}
function replaceN(path, oldText, newText, expected) {
  let s = fs.readFileSync(path, "utf8");
  const count = s.split(oldText).length - 1;
  if (count !== expected) throw new Error(`${path}: expected ${expected} matches, found ${count}`);
  fs.writeFileSync(path, s.split(oldText).join(newText));
}

replaceOne(
  "drizzle/schema.ts",
  '    outcome: mysqlEnum("outcome", ["follow_up", "won", "lost"]).notNull(),',
  `    outcome: mysqlEnum("outcome", [
      "follow_up",
      "won",
      "lost",
      "no_contact",
      "no_decision",
    ]).notNull(),`
);

replaceN(
  "client/src/game/actions/actionServices.ts",
  '    outcome: "follow_up" | "won" | "lost";',
  '    outcome: "follow_up" | "won" | "lost" | "no_contact" | "no_decision";',
  1
);
replaceN(
  "client/src/game/actions/actionServices.ts",
  '  outcome: "follow_up" | "won" | "lost";',
  '  outcome: "follow_up" | "won" | "lost" | "no_contact" | "no_decision";',
  1
);

replaceOne(
  "server/commercialMissions/commercialMissionFieldService.ts",
  '  outcome: "follow_up" | "won" | "lost";',
  '  outcome: "follow_up" | "won" | "lost" | "no_contact" | "no_decision";'
);

const servicePath = "server/commercialMissions/commercialMissionFieldService.ts";
let service = fs.readFileSync(servicePath, "utf8");
const markerStart = '      await transitionCommercialMissionWith(tx, {\n        tenantId: input.tenantId,\n        missionId: input.missionId,\n        expectedVersion: mission.version,\n        toStatus: input.outcome,';
const idx = service.indexOf(markerStart);
if (idx < 0) throw new Error("field service: second outcome transition start not found");
const endNeedle = '      });\n    });\n  } catch (error) {';
const endIdx = service.indexOf(endNeedle, idx);
if (endIdx < 0) throw new Error("field service: second outcome transition end not found");
const oldBlock = service.slice(idx, endIdx + '      });'.length);
const inner = oldBlock.replace(/^      /gm, '        ');
const newBlock = `      if (
        input.outcome === "follow_up" ||
        input.outcome === "won" ||
        input.outcome === "lost"
      ) {
${inner}
      }`;
service = service.slice(0, idx) + newBlock + service.slice(endIdx + '      });'.length);
fs.writeFileSync(servicePath, service);

replaceOne(
  "server/commercialMissions/commercialMissionRouter.ts",
  '          outcome: z.enum(["follow_up", "won", "lost"]),',
  '          outcome: z.enum(["follow_up", "won", "lost", "no_contact", "no_decision"]),'
);

replaceOne(
  "client/src/game/actions/GoldlineActionSurface.tsx",
  `  const [outcome, setOutcome] =
    useState<VisitOutcomeRequest["outcome"]>("follow_up");
  const [followUpAt, setFollowUpAt] = useState("");`,
  `  const [outcome, setOutcome] =
    useState<VisitOutcomeRequest["outcome"]>("no_decision");
  const [followUpAt, setFollowUpAt] = useState("");
  const [decisionMakerStatus, setDecisionMakerStatus] =
    useState<VisitOutcomeRequest["decisionMakerStatus"]>("not_recorded");
  const [collateralDelivered, setCollateralDelivered] = useState(false);
  const [quoteRequested, setQuoteRequested] = useState(false);
  const [pilotRequested, setPilotRequested] = useState(false);
  const [followUpRequested, setFollowUpRequested] = useState(false);`
);

replaceOne(
  "client/src/game/actions/GoldlineActionSurface.tsx",
  `              <option value="follow_up">Follow-up agreed</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>`,
  `              <option value="no_contact">Decision maker unavailable</option>
              <option value="no_decision">Spoke — no decision</option>
              <option value="follow_up">Follow-up agreed</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>`
);

replaceOne(
  "client/src/game/actions/GoldlineActionSurface.tsx",
  `          {outcome === "follow_up" ? (
            <label>
              AGREED FOLLOW-UP DATE
              <input
                type="datetime-local"
                value={followUpAt}
                onChange={event => setFollowUpAt(event.target.value)}
              />
            </label>
          ) : null}
          <label>
            WHAT HAPPENED`,
  `          {outcome === "follow_up" ? (
            <label>
              AGREED FOLLOW-UP DATE
              <input
                type="datetime-local"
                value={followUpAt}
                onChange={event => setFollowUpAt(event.target.value)}
              />
            </label>
          ) : null}
          <label>
            DECISION MAKER
            <select
              value={outcome === "no_contact" ? "unavailable" : decisionMakerStatus}
              disabled={outcome === "no_contact"}
              onChange={event =>
                setDecisionMakerStatus(
                  event.target.value as VisitOutcomeRequest["decisionMakerStatus"]
                )
              }
            >
              <option value="not_recorded">Not recorded</option>
              <option value="unavailable">Unavailable</option>
              <option value="met">Met</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={collateralDelivered}
              onChange={event => setCollateralDelivered(event.target.checked)}
            />
            Collateral delivered
          </label>
          <label>
            <input
              type="checkbox"
              checked={quoteRequested}
              disabled={outcome === "no_contact"}
              onChange={event => setQuoteRequested(event.target.checked)}
            />
            Pricing / quote requested
          </label>
          <label>
            <input
              type="checkbox"
              checked={pilotRequested}
              disabled={outcome === "no_contact"}
              onChange={event => setPilotRequested(event.target.checked)}
            />
            Pilot requested
          </label>
          <label>
            <input
              type="checkbox"
              checked={followUpRequested || outcome === "follow_up"}
              disabled={outcome === "follow_up"}
              onChange={event => setFollowUpRequested(event.target.checked)}
            />
            Follow-up requested
          </label>
          <label>
            WHAT HAPPENED`
);

replaceOne(
  "client/src/game/actions/GoldlineActionSurface.tsx",
  `                    decisionMakerStatus: "not_recorded",
                    collateralDelivered: false,
                    quoteRequested: false,
                    pilotRequested: false,
                    followUpRequested: outcome === "follow_up",`,
  `                    decisionMakerStatus:
                      outcome === "no_contact"
                        ? "unavailable"
                        : decisionMakerStatus,
                    collateralDelivered,
                    quoteRequested:
                      outcome === "no_contact" ? false : quoteRequested,
                    pilotRequested:
                      outcome === "no_contact" ? false : pilotRequested,
                    followUpRequested:
                      outcome === "follow_up" || followUpRequested,`
);

fs.writeFileSync(
  "drizzle/0064_real_workday_visit_outcomes.sql",
  "ALTER TABLE `commercial_visit_outcomes`\n  MODIFY COLUMN `outcome` enum('follow_up','won','lost','no_contact','no_decision') NOT NULL;\n"
);

fs.writeFileSync(
  "server/commercialMissions/realWorkdayVisitOutcomeTruth.test.ts",
`import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../drizzle/schema.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../drizzle/0064_real_workday_visit_outcomes.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("./commercialMissionFieldService.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("./commercialMissionRouter.ts", import.meta.url), "utf8");
const actionServices = readFileSync(new URL("../../client/src/game/actions/actionServices.ts", import.meta.url), "utf8");
const actionSurface = readFileSync(new URL("../../client/src/game/actions/GoldlineActionSurface.tsx", import.meta.url), "utf8");

describe("Real Workday visit outcome truth", () => {
  it("stores unresolved reality without forcing win, loss, or scheduled follow-up", () => {
    expect(schema).toContain('\"no_contact\"');
    expect(schema).toContain('\"no_decision\"');
    expect(migration).toContain("'no_contact','no_decision'");
    expect(router).toContain('\"no_contact\", \"no_decision\"');
    expect(actionServices).toContain('\"no_contact\" | \"no_decision\"');
    expect(service).toContain('\"no_contact\" | \"no_decision\"');
    expect(service).toContain('toStatus: \"visit_completed\"');
  });

  it("advances past visit_completed only for explicit follow-up, won, or lost truth", () => {
    expect(service).toContain('input.outcome === \"follow_up\"');
    expect(service).toContain('input.outcome === \"won\"');
    expect(service).toContain('input.outcome === \"lost\"');
    expect(service).toContain("toStatus: input.outcome");
    expect(router).toContain('value.outcome === \"follow_up\" && !value.followUpAt');
  });

  it("makes uncertainty the UI default and captures supported real evidence", () => {
    expect(actionSurface).toContain('VisitOutcomeRequest[\"outcome\"]>(\"no_decision\")');
    expect(actionSurface).toContain('value=\"no_contact\"');
    expect(actionSurface).toContain('value=\"no_decision\"');
    expect(actionSurface).toContain("setDecisionMakerStatus");
    expect(actionSurface).toContain("setCollateralDelivered");
    expect(actionSurface).toContain("setQuoteRequested");
    expect(actionSurface).toContain("setPilotRequested");
    expect(actionSurface).toContain("setFollowUpRequested");
  });
});
`
);
