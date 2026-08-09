export type ObjectionArchetype = "ANCHOR" | "GHOST" | "GATEKEEPER" | "STALLER";

export type ArmoryItem = {
  id: string;
  title: string;
  cue: string;
  response: string;
  outcome: "worked" | "did_not_work" | "guidance";
  provenance: "personal_journal" | "curated_source" | "foundation" | "evidence_backed_mission_context";
  sourceReference: string;
};

export type ArchetypeSummary = {
  archetype: ObjectionArchetype;
  count: number;
  explanation: string;
  evidence: Array<{ text: string; sourceReference: string }>;
};
