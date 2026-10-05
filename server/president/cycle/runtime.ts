import { presidentPool } from "../database";
import { MysqlPresidentIntelligenceStore } from "../intelligenceStore";
import { MysqlPresidentCycleStore } from "./store";
import { PresidentCycleService } from "./service";
import { PresidentCycleRunner } from "../fabric/runner";
import { PresidentEngineeringExecutor } from "../fabric/engineering";

let singleton:
  | {
      store: MysqlPresidentCycleStore;
      intelligence: MysqlPresidentIntelligenceStore;
      service: PresidentCycleService;
      runner: PresidentCycleRunner;
    }
  | undefined;

export function getPresidentCycleRuntime() {
  if (singleton) return singleton;
  const pool = presidentPool();
  const store = new MysqlPresidentCycleStore(pool);
  const intelligence = new MysqlPresidentIntelligenceStore(pool);
  const service = new PresidentCycleService(store, intelligence);
  singleton = {
    store,
    intelligence,
    service,
    runner: new PresidentCycleRunner(store),
  };
  return singleton;
}

export async function presidentCycleReadiness() {
  let databaseReady = false;
  let chatgpt = false;
  let claude = false;
  let engineering = false;
  let reason: string | null = null;

  try {
    const runtime = getPresidentCycleRuntime();
    await runtime.store.pool.query("SELECT 1");
    databaseReady = true;
    const deliberation = await runtime.service.readiness();
    chatgpt = deliberation.chatgpt;
    claude = deliberation.claude;
    engineering = await new PresidentEngineeringExecutor().available();
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }

  return {
    appRunningIndependentOfPresidentExecution: true,
    databaseReady,
    deliberation: {
      chatgpt,
      claude,
      requiredSequence: [
        "CHATGPT_PROPOSAL",
        "CLAUDE_CRITIQUE",
        "CHATGPT_SYNTHESIS",
      ] as const,
      ready: chatgpt && claude,
    },
    engineering: {
      ready: engineering,
      requiresGitRepository: true,
      requiresGithubCliAuth: true,
      executionBackend: process.env.ANTHROPIC_API_KEY?.trim()
        ? "ANTHROPIC_API"
        : "CLAUDE_CLI",
      requiresClaudeCli: !process.env.ANTHROPIC_API_KEY?.trim(),
      requiresAnthropicApiKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
      independentReviewer: true,
      mergeAllowed: false,
    },
    presidentAutonomousExecutionReady:
      databaseReady && chatgpt && claude && engineering,
    reason,
  };
}
