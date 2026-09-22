import {
  applyAuthoritativeEvidence,
  applyGameplayMutation,
  authorityKey,
  bindVisualPackage,
  emptyConsequence,
  initialRealGate,
  markNotReadyToday,
  noteEntrance,
  replacementDependsOnMissingPrep,
  resumeExperience,
  type AuthoritativeEvidence,
  type MissionEntrance,
  type MissionExperienceInstance,
  type SelectedWorkRef,
  type UnreadinessObservation,
} from "../../shared/missionExperience";
import {
  missionExperienceInstanceId,
  type MissionExperienceStore,
} from "./missionExperienceStore";

export type ResolveMissionExperienceResult =
  | {
      ok: true;
      instance: MissionExperienceInstance;
      replacement: MissionExperienceInstance | null;
      created: boolean;
    }
  | { ok: false; reason: "NO_AUTHORITATIVE_IDENTITY" | "EMPTY_OBJECTIVE" };

export async function resolveMissionExperience(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
  selectedWorkRef: SelectedWorkRef;
  store: MissionExperienceStore;
  nowIso?: string;
  evidence?: AuthoritativeEvidence | null;
  unreadiness?: UnreadinessObservation | null;
}): Promise<ResolveMissionExperienceResult> {
  const unreadiness = input.unreadiness ?? null;
  const persisted = await persistSelectedWork({
    ...input,
    role: "original",
    replacesMissionInstanceId: null,
    notReady: Boolean(unreadiness?.notReady),
  });
  if (!persisted.ok) return persisted;
  const instance = persisted.instance;
  const replacement = unreadiness?.notReady
    ? await persistReplacement({
        tenantId: input.tenantId,
        operatorId: input.operatorId,
        businessDate: input.businessDate,
        store: input.store,
        nowIso: input.nowIso,
        original: instance,
        unreadiness,
      })
    : null;
  return { ok: true, instance, replacement, created: persisted.created };
}

export async function openMissionExperience(input: {
  instanceId: string;
  entrance: MissionEntrance;
  store: MissionExperienceStore;
  nowIso?: string;
}): Promise<MissionExperienceInstance | null> {
  const existing = await input.store.getById(input.instanceId);
  if (!existing) return null;
  const nowIso = input.nowIso ?? new Date().toISOString();
  const next = noteEntrance(existing, input.entrance, nowIso);
  await input.store.update(next);
  return next;
}

export async function recordGameplay(input: {
  instanceId: string;
  store: MissionExperienceStore;
  nowIso?: string;
  fictionalState?: unknown;
  hostPhase?: string | null;
  checkpointRef?: string | null;
}): Promise<MissionExperienceInstance | null> {
  const existing = await input.store.getById(input.instanceId);
  if (!existing) return null;
  const nowIso = input.nowIso ?? new Date().toISOString();
  const next = applyGameplayMutation(
    existing,
    {
      fictionalState: input.fictionalState,
      hostPhase: input.hostPhase,
      checkpointRef: input.checkpointRef,
    },
    nowIso
  );
  await input.store.update(next);
  return next;
}

export async function resumeMissionExperience(input: {
  instanceId: string;
  store: MissionExperienceStore;
  evidence?: AuthoritativeEvidence | null;
  nowIso?: string;
}): Promise<MissionExperienceInstance | null> {
  const existing = await input.store.getById(input.instanceId);
  if (!existing) return null;
  const nowIso = input.nowIso ?? new Date().toISOString();
  const next = resumeExperience(existing, input.evidence ?? null, nowIso);
  if (next !== existing) await input.store.update(next);
  return next;
}

async function persistReplacement(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
  store: MissionExperienceStore;
  nowIso?: string;
  original: MissionExperienceInstance;
  unreadiness: UnreadinessObservation;
}): Promise<MissionExperienceInstance | null> {
  const fallback = input.unreadiness.existingFallback;
  if (!fallback) return null;
  if (replacementDependsOnMissingPrep(fallback, input.unreadiness.missingPrepTexts)) return null;
  const fallbackKey = authorityKey(fallback);
  if (!fallbackKey || fallbackKey === input.original.authorityRef.authorityKey) return null;
  const persisted = await persistSelectedWork({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    businessDate: input.businessDate,
    selectedWorkRef: fallback,
    store: input.store,
    nowIso: input.nowIso,
    role: "replacement",
    replacesMissionInstanceId: input.original.id,
    notReady: false,
  });
  if (!persisted.ok) return null;
  if (persisted.instance.id === input.original.id) return null;
  return persisted.instance;
}

async function persistSelectedWork(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
  selectedWorkRef: SelectedWorkRef;
  store: MissionExperienceStore;
  nowIso?: string;
  evidence?: AuthoritativeEvidence | null;
  role: "original" | "replacement";
  replacesMissionInstanceId: string | null;
  notReady: boolean;
}): Promise<
  | { ok: true; instance: MissionExperienceInstance; created: boolean }
  | { ok: false; reason: "NO_AUTHORITATIVE_IDENTITY" | "EMPTY_OBJECTIVE" }
> {
  const key = authorityKey(input.selectedWorkRef);
  if (!key) return { ok: false, reason: "NO_AUTHORITATIVE_IDENTITY" };
  if (!input.selectedWorkRef.realObjective.trim() || !input.selectedWorkRef.title.trim()) {
    return { ok: false, reason: "EMPTY_OBJECTIVE" };
  }
  const nowIso = input.nowIso ?? new Date().toISOString();
  const id = missionExperienceInstanceId({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    businessDate: input.businessDate,
    authorityKey: key,
  });
  let created = false;
  let instance = await input.store.getById(id);
  if (!instance) {
    created = true;
    instance = blankInstance({
      id,
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      businessDate: input.businessDate,
      authorityKey: key,
      ref: input.selectedWorkRef,
      nowIso,
    });
  } else if (typeof input.selectedWorkRef.visualPackageId === "string") {
    instance = bindVisualPackage(instance, input.selectedWorkRef.visualPackageId);
  }
  if (input.role === "replacement" && input.replacesMissionInstanceId) {
    instance = {
      ...instance,
      replacement: {
        reason: "ORIGINAL_MISSION_NOT_READY",
        replacesMissionInstanceId: input.replacesMissionInstanceId,
      },
    };
  }
  if (input.notReady) {
    instance = markNotReadyToday(instance, nowIso);
  }
  if (input.evidence) {
    instance = applyAuthoritativeEvidence(instance, input.evidence, nowIso);
  }
  instance = { ...instance, updatedAt: nowIso };
  if (created) {
    const inserted = await input.store.insert(instance);
    if (inserted === "exists") {
      instance = (await input.store.getById(id)) ?? instance;
      created = false;
    }
  } else {
    await input.store.update(instance);
  }
  return { ok: true, instance, created };
}

function blankInstance(input: {
  id: string;
  tenantId: string;
  operatorId: string;
  businessDate: string;
  authorityKey: string;
  ref: SelectedWorkRef;
  nowIso: string;
}): MissionExperienceInstance {
  const playShape = input.ref.playShape ?? (input.ref.gameplayHost ? "rich_host" : "compact");
  return {
    id: input.id,
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    businessDate: input.businessDate,
    authorityRef: {
      authorityKey: input.authorityKey,
      dailyCommandItemId: input.ref.dailyCommandItemId?.trim() || null,
      missionDirectorPlanId: input.ref.missionDirectorPlanId?.trim() || null,
      missionDirectorSelection: input.ref.missionDirectorSelection ?? null,
      campaignRunId: input.ref.campaignRunId?.trim() || null,
    },
    source: input.ref.source,
    title: input.ref.title.trim(),
    realObjective: input.ref.realObjective.trim(),
    status: "ACTIVE",
    phase: "BRIEFING",
    playShape,
    gameplayHost: input.ref.gameplayHost ?? null,
    gameplay: {
      host: input.ref.gameplayHost ?? null,
      checkpointRef: null,
      hostPhase: null,
      fictionalState: null,
    },
    realGate: initialRealGate(input.ref),
    consequence: emptyConsequence(),
    replacement: null,
    visualPackageId: input.ref.visualPackageId ?? null,
    entrances: [],
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };
}
