import type {
  AuthoredFact,
  KnowledgePlane,
  KnowledgeState,
  NarrativeEventLedgerEntry,
  NarrativeState,
} from "../../shared/narratorOs/contracts";

export type OperatorScope = {
  tenantId: string;
  operatorUserId: string;
};

export type NarratorSnapshot = OperatorScope & {
  worldTruth: readonly AuthoredFact[];
  livedBio: readonly AuthoredFact[];
  knowledge: KnowledgeState;
  narrativeState: NarrativeState;
  ledger: readonly NarrativeEventLedgerEntry[];
  catalogVersion: {
    worldTruth: string;
    livedBio: string;
  };
};

export const EMPTY_KNOWLEDGE: KnowledgeState = {
  planes: {
    PLAYER: {
      plane: "PLAYER",
      knownFactIds: [],
      interpretations: {},
      factKinds: {},
    },
    CLAIRE: {
      plane: "CLAIRE",
      knownFactIds: [],
      interpretations: {},
      factKinds: {},
    },
    CHEMIST: {
      plane: "CHEMIST",
      knownFactIds: [],
      interpretations: {},
      factKinds: {},
    },
    OTHER: {
      plane: "OTHER",
      knownFactIds: [],
      interpretations: {},
      factKinds: {},
    },
  },
};

export const SEEDED_NARRATIVE_STATE: NarrativeState = {
  values: { m03: "ARMED" },
  closedForwardPaths: [],
  holdOpenedAtMs: {},
};

export type KnowledgeWrite =
  | {
      plane: KnowledgePlane;
      factId: string;
      op: "learn";
      kind: "EVENT_FACT" | "CHARACTER_INTERPRETATION";
    }
  | {
      plane: KnowledgePlane;
      factId: string;
      op: "set_interpretation";
      interpretation: string;
    };

export type NarrativeAtomicCommit = {
  knowledge: KnowledgeState;
  narrativeState: NarrativeState;
  ledgerEntry: Omit<
    NarrativeEventLedgerEntry,
    "id" | "tenantId" | "operatorUserId"
  > & {
    id?: string;
  };
};

export type NarratorStore = {
  initOperator(scope: OperatorScope): Promise<NarratorSnapshot>;
  load(scope: OperatorScope): Promise<NarratorSnapshot | null>;
  replaceKnowledge(
    scope: OperatorScope,
    knowledge: KnowledgeState
  ): Promise<void>;
  replaceNarrativeState(
    scope: OperatorScope,
    state: NarrativeState
  ): Promise<void>;
  appendLedger(
    scope: OperatorScope,
    entry: Omit<
      NarrativeEventLedgerEntry,
      "id" | "tenantId" | "operatorUserId"
    > & {
      id?: string;
    }
  ): Promise<NarrativeEventLedgerEntry>;
  /**
   * Knowledge + narrative state + ledger append, all or nothing.
   * Production beat fire must use this path.
   */
  commitAtomic(
    scope: OperatorScope,
    commit: NarrativeAtomicCommit
  ): Promise<NarrativeEventLedgerEntry>;
};

export class WorldTruthImmutableError extends Error {
  constructor() {
    super("WORLD_TRUTH cannot be rewritten at runtime");
    this.name = "WorldTruthImmutableError";
  }
}

export class LivedBioImmutableError extends Error {
  constructor() {
    super("CLAIRE_LIVED_BIO cannot be appended at runtime");
    this.name = "LivedBioImmutableError";
  }
}

export class UnknownBeatLedgerError extends Error {
  constructor(beatId: string) {
    super(`Unknown beat cannot be written to the event ledger: ${beatId}`);
    this.name = "UnknownBeatLedgerError";
  }
}

export class NonRepeatableReplayError extends Error {
  constructor(beatId: string) {
    super(`Non-repeatable beat cannot replay: ${beatId}`);
    this.name = "NonRepeatableReplayError";
  }
}

export function cloneKnowledge(knowledge: KnowledgeState): KnowledgeState {
  return {
    planes: {
      PLAYER: clonePlane(knowledge.planes.PLAYER),
      CLAIRE: clonePlane(knowledge.planes.CLAIRE),
      CHEMIST: clonePlane(knowledge.planes.CHEMIST),
      OTHER: clonePlane(knowledge.planes.OTHER),
    },
  };
}

function clonePlane(plane: KnowledgeState["planes"][KnowledgePlane]) {
  return {
    plane: plane.plane,
    knownFactIds: [...plane.knownFactIds],
    interpretations: { ...plane.interpretations },
    factKinds: { ...plane.factKinds },
  };
}

export function planeKnows(
  knowledge: KnowledgeState,
  plane: KnowledgePlane,
  factId: string
): boolean {
  return knowledge.planes[plane].knownFactIds.includes(factId);
}

export function applyKnowledgeWrite(
  knowledge: KnowledgeState,
  write: KnowledgeWrite
): KnowledgeState {
  const next = cloneKnowledge(knowledge);
  const plane = next.planes[write.plane];
  if (write.op === "learn") {
    if (!plane.knownFactIds.includes(write.factId)) {
      plane.knownFactIds = [...plane.knownFactIds, write.factId];
    }
    plane.factKinds = { ...plane.factKinds, [write.factId]: write.kind };
    return next;
  }
  plane.interpretations = {
    ...plane.interpretations,
    [write.factId]: write.interpretation,
  };
  return next;
}
