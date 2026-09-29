/**
 * Candy Bar V0 — public module surface.
 * Orchestration extends goldline engineering agentsClient; does not replace it.
 */
export { CandyBarOrchestrator } from "./orchestrator";
export { MemoryCandyBarStore, type CandyBarStore } from "./store";
export { MysqlCandyBarStore, CandyBarSchemaBlockedError } from "./mysqlStore";
export { startCandyBarHeartbeat } from "./heartbeat";
export { candyBarRouter } from "./router";
export * from "./prompts";
