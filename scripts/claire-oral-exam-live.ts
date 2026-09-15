/**
 * Claire Oral Exam — LIVE, against real business records, READ-ONLY.
 *
 * Runs Adam's acceptance conversations and a generated red team of natural
 * questions through Claire's real turn orchestration (the same code the phone
 * and desk use), with the real model when ANTHROPIC_API_KEY is set. Every
 * write path is replaced with a stub that records what WOULD have been
 * written, so nothing in the business changes.
 *
 * Usage (production data through the MySQL public proxy):
 *   railway run -s bldg-admin-api -- railway run -s MySQL -- \
 *     sh -c 'DATABASE_URL="$MYSQL_PUBLIC_URL" CLAIRE_EXAM_READ_ONLY=1 npx tsx scripts/claire-oral-exam-live.ts'
 *
 * Output: every conversation with answers and latency, then a red-team
 * summary of which questions fell through to "I don't know".
 */
import { writeFileSync } from "node:fs";
import { loadPaidOrderLedger } from "../server/analytics/paidOrderLedger";
import { customerGroupsMatchingName, groupCustomers } from "../server/analytics/businessMetrics";
import { handleVoiceCommitmentTurn } from "../server/claire/voiceCommitmentLoop";
import { listAccountRefs } from "../server/claire/knowledge/accountKnowledge";
import { answerWithEncyclopedia } from "../server/claire/knowledge/encyclopediaAgent";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState } from "../server/claire/turn/claireTurn";
import { getDashboardTimeZone, zonedDayStartUtc } from "../server/dashboardZoned";

if (process.env.CLAIRE_EXAM_READ_ONLY !== "1") {
  console.error("Refusing to run: set CLAIRE_EXAM_READ_ONLY=1 to confirm this is a read-only exam run.");
  process.exit(2);
}

const TENANT = process.env.CLAIRE_EXAM_TENANT ?? "default";
const OPERATOR = process.env.CLAIRE_EXAM_OPERATOR ?? "adam-admin";
const DAY_DIRECTOR_ACTOR = process.env.CLAIRE_EXAM_DAY_DIRECTOR_ACTOR ?? "1";

type Outcome = "answered" | "clarified" | "record_lookup" | "fallback" | "unavailable" | "work_proposed" | "listening";

type Exchange = { question: string; answer: string; outcome: Outcome; ms: number };

const wouldWrite: string[] = [];
let usedEncyclopedia = false;
let usedFollowUp = false;

function stubbedDeps(): Partial<ClaireTurnDeps> {
  return {
    commitment: (input, extra = {}) =>
      handleVoiceCommitmentTurn(input, {
        ...extra,
        accept: async args => {
          wouldWrite.push(`day-line accept: ${args.proposal.title} (${args.businessDate})`);
          return { id: "exam-not-saved" } as never;
        },
        updateCommitment: async args => {
          wouldWrite.push(`day-line update: ${args.commitmentId}`);
          return { ok: true as const, id: args.commitmentId };
        },
        editItem: async args => {
          wouldWrite.push(`day-line edit: ${args.item.displayTitle} → ${args.actionTitle}`);
          return { sourceId: args.item.sourceId, displayTitle: args.actionTitle } as never;
        },
        cancelItem: async args => {
          wouldWrite.push(`day-line cancel: ${args.item.displayTitle}`);
          return { sourceId: args.item.sourceId, displayTitle: args.item.displayTitle } as never;
        },
        approveEngineering: async () => {
          wouldWrite.push("engineering request");
          return { gap: null, reused: false, unavailableReason: null, speak: "(exam: engineering not contacted)" };
        },
        persistFieldCapture: async () => {
          wouldWrite.push("field capture");
          return { ok: true, id: "exam" };
        },
        confirmPlan: async () => {
          wouldWrite.push("confirm tomorrow plan");
        },
      }),
    confirmPlan: async () => {
      wouldWrite.push("confirm tomorrow plan");
    },
    commit: async parsed => {
      wouldWrite.push(`briefing commit: ${parsed.items.map(item => `${item.kind}:${item.title}@${item.businessDate}`).join(" | ")}`);
      return {
        added: parsed.items.filter(item => item.kind === "new_work" && !item.existing),
        completed: parsed.items.filter(item => item.kind === "completed"),
        failed: [],
        commitmentIds: [],
      };
    },
    commitFollowUp: async pending => {
      wouldWrite.push(`account follow-up: ${pending.accountName} → ${pending.dueDate}`);
      return { pipelineSaved: true, dayLineSaved: true, errors: [] };
    },
    followUp: async () => {
      usedFollowUp = true;
      return "(fell through to the brief-anchored follow-up)";
    },
    encyclopedia: process.env.ANTHROPIC_API_KEY?.trim()
      ? input => {
          usedEncyclopedia = true;
          return answerWithEncyclopedia({
            ...input,
            dayDirectorActorId: DAY_DIRECTOR_ACTOR,
            history: input.history.map(entry => ({ speaker: entry.speaker, text: entry.text })),
            now: new Date(),
            timeZone: getDashboardTimeZone(),
          });
        }
      : null,
  };
}

function classify(answer: string, kind: string): Outcome {
  if (kind === "listening") return "listening";
  if (kind === "briefing_proposed" || kind === "follow_up_proposed" || kind === "commitment") return "work_proposed";
  if (usedFollowUp || /I don't have a record that answers that/.test(answer)) return "fallback";
  if (/\bwon't guess\b|couldn't (?:get|load|reach|search|check)/i.test(answer)) return "unavailable";
  if (/Which one do you mean\?|Which one\?|Which two periods/.test(answer)) return "clarified";
  if (usedEncyclopedia) return "record_lookup";
  return "answered";
}

async function conversation(title: string, questions: string[], surface: "voice" | "text" = "voice"): Promise<Exchange[]> {
  const state: ClaireTurnState = {};
  const deps = stubbedDeps();
  const exchanges: Exchange[] = [];
  console.log(`\n## ${title}`);
  for (const question of questions) {
    usedEncyclopedia = false;
    usedFollowUp = false;
    const started = Date.now();
    let answer: string;
    let kind = "answered";
    try {
      const result = await runClaireTurn(
        {
          tenantId: TENANT,
          operatorUserId: OPERATOR,
          dayDirectorActorId: DAY_DIRECTOR_ACTOR,
          surface,
          utterance: question,
          state,
          conversationKey: `claire-exam:${title}`,
          brief: "(exam brief)",
          context: { businessDate: new Date().toISOString().slice(0, 10) } as never,
          allowFragmentWait: false,
        },
        deps
      );
      answer = result.speak;
      kind = result.kind;
    } catch (error) {
      answer = `ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
    const exchange = { question, answer, outcome: classify(answer, kind), ms: Date.now() - started };
    exchanges.push(exchange);
    console.log(`ME: ${question}\nCLAIRE [${exchange.outcome}, ${exchange.ms}ms]: ${answer}`);
  }
  return exchanges;
}

const ACCEPTANCE: Array<[string, string[]]> = [
  [
    "September 15 briefing (spoken, one turn)",
    [
      "Delivered John's order. It's 9:30am on Tuesday September 15th. Agenda: Pickup from two dry cleaning orders from Coast 1hr Dry Cleaners, for Yassie & Carol. Pickup KITH TREATS aprons on Rodeo Drive anytime from now to noon. Pickup OPUS LA gym towels. Drive to Lugos Lavanderia. Deposit laundromat money for payroll. Make three black bows. 7pm: Deliver gym towels to OPUS LA. Tomorrow, Wednesday September 16th: 9 - 10am window: Deliver Carol & Yassie dry cleaning orders to Century Park East.",
      "Yes.",
    ],
  ],
  [
    "The phone fragments from September 15",
    [
      "Yes, I have to.  Pick up from the dry cleaners this morning.  For Yazzie and Carol.  And then I have to pick up from kit treats on Rodeo Drive.",
      "And create down.  Then I have to drive to lugo's Lavon, Zaria are processing center.  Then I have to deposit laundromat money for payroll.  Then I have to make three black bows while Elizabeth processes orders.  And then I have to deliver Jim towels to  open late.",
      "and then tomorrow morning, I have to deliver  dry cleaning orders, to Century Park, East for Carol and Yazzie.",
      "Yes.",
    ],
  ],
  [
    "Final acceptance conversation",
    [
      "Morning. John is already delivered. I need Coast for Carol and Yassie, KITH before noon, OPUS towels, Lugo's, payroll deposit, three bows, and OPUS back at seven. Carol and Yassie go back tomorrow between nine and ten. By the way, how much has John spent with me this year?",
      "What about Carol?",
      "Which of them ordered most recently?",
      "How much has OPUS done this month?",
      "Previous month?",
      "Who drove the difference?",
      "What happened last time I went to The Louise?",
      "Put the follow-up on Thursday.",
    ],
  ],
  [
    "Lineage and GUMBALL thread",
    [
      "What was revenue the last 30 days?",
      "Is that Laundry Butler only or Laundry Farm too?",
      "How much is Stripe?",
      "What about Clearent?",
      "What about CleanCloud?",
      "Add them together.",
      "Does that include OPUS?",
      "Exclude OPUS.",
      "What's the latest sale you have?",
      "Who was it for?",
      "How much?",
      "Was that from CleanCloud?",
      "When did CleanCloud last update?",
      "Did GUMBALL run today?",
      "Is the CleanCloud data current?",
    ],
  ],
  ["Revenue thread", ["What was revenue the last 30 days?", "Previous 30?", "Which period did more orders?", "What was AOV?", "Who were the top customers?"]],
  [
    "Active and dormant",
    ["How many active customers do I have?", "No, use sixty days.", "Only people with more than one order.", "Who are they?", "Which of those hasn't ordered in the last thirty?"],
  ],
  ["Accounts", ["How much has OPUS LA generated?", "This month.", "How many orders?", "Who ordered most recently?", "Who orders the most there?", "What was the first order we ever got from Century Park East?"]],
  ["Sales history", ["What happened with The Louise?", "When was my last contact?", "What did I say happened there?", "Do I owe them a follow-up?"]],
  ["Operations", ["What do I have left today?", "What did I already finish?", "What is tomorrow?"]],
  ["Profit and coverage", ["What was profit last month?", "What data do you have?", "Who still owes money?"]],
  [
    "Novel routing paraphrases",
    [
      "What was revenue the last 30 days?",
      "How much is Stripe?",
      "What about Clearent?",
      "Add them together.",
      "Tell me what happened last time I went to The Louise",
      "Remind me whether I owe them a follow-up",
    ],
  ],
];

async function redTeam(): Promise<Exchange[]> {
  const timeZone = getDashboardTimeZone();
  const ledger = await loadPaidOrderLedger({
    tenantId: TENANT,
    startUtc: zonedDayStartUtc("2020-01-01", timeZone),
    endExclusiveUtc: new Date(Date.now() + 86_400_000),
    timeZone,
  });
  const customers = groupCustomers(ledger.events)
    .map(group => ({ name: group.records.find(record => record.customerName)?.customerName ?? "", orders: group.records.length }))
    .filter(customer => customer.name && customer.orders >= 2)
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 6);
  const firstNames = customers.map(customer => customer.name.split(/\s+/)[0]!).filter(name => customerGroupsMatchingName(ledger.events, name).length >= 1);
  const accounts = (await listAccountRefs(TENANT)).slice(0, 4).map(account => account.name);
  const periods = ["last month", "this year", "in July", "the last 60 days", "since June", "last week", "yesterday", "all time"];
  const scopes = ["Laundry Farm", "Laundry Butler", "Stripe", "Clearent", "CleanCloud", "OPUS LA", "Century Park East", "dry cleaning", "fluff and fold"];
  const questions = new Set<string>();
  for (const period of periods) {
    questions.add(`How much revenue did we do ${period}?`);
    questions.add(`How many orders ${period}?`);
    questions.add(`Who ordered ${period}?`);
    questions.add(`What was our average order ${period}?`);
  }
  for (const scope of scopes) {
    questions.add(`How much did ${scope} do last month?`);
    questions.add(`What are my ${scope} sales this year?`);
    questions.add(`Who are my biggest ${scope} customers?`);
    questions.add(`When was the last ${scope} order?`);
  }
  for (const name of firstNames) {
    questions.add(`How much has ${name} spent with me?`);
    questions.add(`When did ${name} last order?`);
    questions.add(`How often does ${name} normally order?`);
    questions.add(`What did ${name} order last time?`);
    questions.add(`Is ${name} ordering less often now?`);
    questions.add(`What's ${name}'s address?`);
  }
  for (const account of accounts) {
    questions.add(`What happened with ${account}?`);
    questions.add(`When did I last visit ${account}?`);
    questions.add(`Do I owe ${account} a follow-up?`);
    questions.add(`What did I tell you about ${account}?`);
  }
  for (const question of [
    "What was our best month this year?",
    "What was our worst month?",
    "What was our biggest order ever?",
    "Who are my ten biggest customers ever?",
    "Which customers order most frequently?",
    "Which customers used to order frequently and stopped?",
    "Who has not ordered in 30 days?",
    "What percentage of revenue comes from my top five customers?",
    "Which customers live in Los Feliz?",
    "Which buildings have the most residents ordering?",
    "What sales follow-ups are overdue?",
    "Which prospects have I visited but never followed up with?",
    "What commitments do I still have open?",
    "What did I finish yesterday?",
    "Is GUMBALL working?",
    "What's the most recent Laundry Butler order?",
    "How many CleanCloud orders came in today?",
    "What's the latest Clearent-related sale?",
    "How much cash did Laundry Farm take last month?",
    "What was revenue between July 1 and August 15?",
  ]) {
    questions.add(question);
  }
  const all: Exchange[] = [];
  for (const question of Array.from(questions)) {
    all.push(...(await conversation(`red team: ${question}`, [question], "text")));
  }
  return all;
}

async function main() {
  const acceptance: Exchange[] = [];
  for (const [title, questions] of ACCEPTANCE) acceptance.push(...(await conversation(title, questions)));
  const red = process.env.CLAIRE_EXAM_SKIP_RED_TEAM === "1" ? [] : await redTeam();
  const tally = (exchanges: Exchange[]) =>
    exchanges.reduce<Record<string, number>>((counts, exchange) => ({ ...counts, [exchange.outcome]: (counts[exchange.outcome] ?? 0) + 1 }), {});
  const latency = (exchanges: Exchange[]) => {
    const values = exchanges.map(exchange => exchange.ms).sort((a, b) => a - b);
    return values.length ? { p50: values[Math.floor(values.length / 2)], p90: values[Math.floor(values.length * 0.9)], max: values[values.length - 1] } : null;
  };
  console.log("\n# Summary");
  console.log("acceptance:", JSON.stringify(tally(acceptance)), "latency:", JSON.stringify(latency(acceptance)));
  console.log("red team:", JSON.stringify(tally(red)), "latency:", JSON.stringify(latency(red)));
  console.log("fell through or unavailable:");
  for (const exchange of [...acceptance, ...red].filter(item => item.outcome === "fallback" || item.outcome === "unavailable")) {
    console.log(` - ${exchange.question} → ${exchange.answer}`);
  }
  console.log(`writes that would have happened (none were made): ${wouldWrite.length}`);
  wouldWrite.forEach(line => console.log(` - ${line}`));
  const out = process.env.CLAIRE_EXAM_OUT;
  if (out) writeFileSync(out, JSON.stringify({ acceptance, red, wouldWrite }, null, 2));
  process.exit(0);
}

void main();
