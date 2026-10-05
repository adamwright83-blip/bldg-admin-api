/** Read-only acceptance against the configured canonical book; never emits customer PII. */
import { writeFileSync } from "node:fs";
import { parseBusinessTurn } from "../server/claire/businessConversation";
import { runBusinessQuery } from "../server/analytics/businessQuery";
const prompts = [
  "Who is John?",
  "How much has John spent?",
  "How did September compare with August?",
  "How much did Laundry Farm make in September?",
  "How much of that was Laundry Butler in September?",
  "How much was core Laundry Farm in September?",
  "How much is unresolved by service line in September?",
  "How much revenue came from Century Park East in September?",
  "Were all Century Park East customers Laundry Butler?",
  "Who hasn't ordered in 90 days?",
  "Who were my five biggest customers last month?",
  "What drove the September increase?",
];
const results = [];
for (const [index, prompt] of prompts.entries()) {
  const parsed = parseBusinessTurn(
    prompt,
    null,
    new Date("2026-10-04T22:00:00Z"),
    "America/Los_Angeles"
  );
  if (parsed.kind !== "query") {
    results.push({ acceptance: index + 1, parser: parsed.kind });
    continue;
  }
  const result = await runBusinessQuery("default", parsed.query);
  const data = result.status === "ok" ? result.data : null;
  const coverage = result.status === "ok" ? result.coverage : null;
  results.push({
    acceptance: index + 1,
    parser: parsed.kind,
    metric: parsed.query.metric,
    status: result.status,
    period: result.period,
    observationReference: coverage?.observationReference,
    precision: coverage?.canonicalRevenue?.precision,
    mayStateExact: coverage?.canonicalRevenue?.mayStateExact,
    dataKind: data?.kind,
    ...(data?.kind === "customers" ? { derivedCustomerCount: data.population.members.length } : {}),
    ...(data?.kind === "top_customers" ? { derivedCustomerCount: data.members.length } : {}),
    ...(data?.kind === "totals"
      ? { current: data.current, previous: data.previous }
      : {}),
    ...(data?.kind === "customer_history"
      ? {
          matchedCustomers: data.matches.length,
          knownCustomerResolved: data.matches.some(
            row => row.displayName.toLowerCase() === "john liang"
          ),
        }
      : {}),
    ...(data?.kind === "composition"
      ? { serviceLines: coverage?.lineage?.byServiceLine }
      : {}),
  });
}
const witness = {
  boundary:
    "candidate canonical reader against production database; deployed HTTP conversation unverified",
  results,
};
writeFileSync(
  process.argv[2] ?? "/tmp/claire-sales-reader-proof.json",
  JSON.stringify(witness, null, 2) + "\n"
);
console.log(
  JSON.stringify({
    acceptedQueries: results.filter(row => row.status === "ok").length,
    attempted: prompts.length,
  })
);
process.exit(0);
