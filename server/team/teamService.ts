import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  commercialMissions,
  dayforgeSaasMemberships,
  employeeOperatingProfileEvents,
  employeeOperatingProfiles,
  users,
} from "../../drizzle/schema";
import { sourcedFact, unknownValue } from "../../shared/businessGame";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import type { TeamProjection } from "./teamTypes";

function skills(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function getTeamProjection(input: { tenantId: string }): Promise<TeamProjection> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const memberships = await db.select().from(dayforgeSaasMemberships).where(and(
    eq(dayforgeSaasMemberships.tenantId, input.tenantId), eq(dayforgeSaasMemberships.active, true), ne(dayforgeSaasMemberships.role, "owner")
  ));
  const userIds = memberships.map(member => member.userOpenId);
  const [profiles, userRows, missions] = await Promise.all([
    userIds.length ? db.select().from(employeeOperatingProfiles).where(and(eq(employeeOperatingProfiles.tenantId, input.tenantId), inArray(employeeOperatingProfiles.userOpenId, userIds))) : [],
    userIds.length ? db.select().from(users).where(and(eq(users.tenantId, input.tenantId), inArray(users.openId, userIds))) : [],
    userIds.length ? db.select().from(commercialMissions).where(and(eq(commercialMissions.tenantId, input.tenantId), inArray(commercialMissions.assignedTo, userIds), inArray(commercialMissions.status, ["selected", "game_ready", "game_active", "game_completed", "phone_ready", "preparing", "en_route", "arrived", "visit_completed", "follow_up"]))) : [],
  ]);
  const members = memberships.map(member => {
    const profile = profiles.find(item => item.userOpenId === member.userOpenId);
    const user = userRows.find(item => item.openId === member.userOpenId);
    return {
      userOpenId: member.userOpenId,
      membershipRole: member.role as "admin" | "operator" | "field",
      displayName: profile?.displayName ?? user?.name?.trim() ?? member.userOpenId,
      employmentStatus: profile?.employmentStatus ?? "active" as const,
      skills: skills(profile?.skillsJson),
      weeklyCapacityUnits: profile?.weeklyCapacityUnits == null ? unknownValue<number>("No operating capacity configured for this member") : sourcedFact(profile.weeklyCapacityUnits, `employee_operating_profiles:${profile.id}`),
      assignedCommercialMissions: missions.filter(mission => mission.assignedTo === member.userOpenId).map(mission => ({ id: mission.id, code: mission.code, status: mission.status, destinationPath: `/driver/sales-mission/${mission.id}` })),
      profileId: profile?.id ?? null,
    };
  });
  const knownCapacity = members.map(member => member.weeklyCapacityUnits.value).filter((value): value is number => value != null);
  return {
    generatedAt: new Date().toISOString(), active: members.length > 0, members,
    totalKnownWeeklyCapacity: knownCapacity.length === members.length && members.length ? sourcedFact(knownCapacity.reduce((sum, value) => sum + value, 0), "employee_operating_profiles.weeklyCapacityUnits") : unknownValue("At least one active member has unknown capacity"),
    ownerIndependentRevenue: unknownValue("Orders do not yet carry verified primary executor attribution; sales mission assignment is not production execution"),
    dataQuality: { status: members.length > 0 && members.every(member => member.profileId) ? "partial" : "insufficient", warnings: ["Owner-independent revenue remains unknown until job executor assignment is authoritative", ...members.filter(member => !member.profileId).map(member => `${member.displayName} has no operating profile`)], sources: ["dayforge_saas_memberships", "users", "employee_operating_profiles", "commercial_missions"] },
  };
}

export async function saveEmployeeOperatingProfile(input: { tenantId: string; userOpenId: string; displayName: string; employmentStatus: "active" | "leave" | "ended"; skills: string[]; weeklyCapacityUnits: number | null; actorId: string; requestId: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const readReplay = async () => {
    const [event] = await db.select().from(employeeOperatingProfileEvents).where(and(eq(employeeOperatingProfileEvents.tenantId, input.tenantId), eq(employeeOperatingProfileEvents.requestId, input.requestId))).limit(1);
    if (!event) return null;
    const [profile] = await db.select().from(employeeOperatingProfiles).where(and(eq(employeeOperatingProfiles.tenantId, input.tenantId), eq(employeeOperatingProfiles.id, event.profileId))).limit(1);
    return profile ?? null;
  };
  const replay = await readReplay();
  if (replay) return replay;
  try {
    return await db.transaction(async tx => {
      const [membership] = await tx.select().from(dayforgeSaasMemberships).where(and(eq(dayforgeSaasMemberships.tenantId, input.tenantId), eq(dayforgeSaasMemberships.userOpenId, input.userOpenId), eq(dayforgeSaasMemberships.active, true), ne(dayforgeSaasMemberships.role, "owner"))).limit(1);
      if (!membership) throw new Error("Employee operating profiles require a real active non-owner tenant membership");
      const [existing] = await tx.select().from(employeeOperatingProfiles).where(and(eq(employeeOperatingProfiles.tenantId, input.tenantId), eq(employeeOperatingProfiles.userOpenId, input.userOpenId))).limit(1);
      const profileId = existing?.id ?? randomUUID();
      if (existing) await tx.update(employeeOperatingProfiles).set({ displayName: input.displayName, employmentStatus: input.employmentStatus, skillsJson: input.skills, weeklyCapacityUnits: input.weeklyCapacityUnits, updatedBy: input.actorId }).where(and(eq(employeeOperatingProfiles.tenantId, input.tenantId), eq(employeeOperatingProfiles.id, profileId)));
      else await tx.insert(employeeOperatingProfiles).values({ id: profileId, tenantId: input.tenantId, userOpenId: input.userOpenId, displayName: input.displayName, employmentStatus: input.employmentStatus, skillsJson: input.skills, weeklyCapacityUnits: input.weeklyCapacityUnits, createdBy: input.actorId, updatedBy: input.actorId });
      await tx.insert(employeeOperatingProfileEvents).values({ id: randomUUID(), tenantId: input.tenantId, profileId, eventType: existing ? "profile_updated" : "profile_created", actorId: input.actorId, requestId: input.requestId, metadataJson: { userOpenId: input.userOpenId, employmentStatus: input.employmentStatus } });
      const [saved] = await tx.select().from(employeeOperatingProfiles).where(and(eq(employeeOperatingProfiles.tenantId, input.tenantId), eq(employeeOperatingProfiles.id, profileId))).limit(1);
      return saved!;
    });
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
    const concurrentReplay = await readReplay();
    if (!concurrentReplay) throw error;
    return concurrentReplay;
  }
}
