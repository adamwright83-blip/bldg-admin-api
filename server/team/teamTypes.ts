import type { DataQuality, ProvenancedValue } from "../../shared/businessGame";

export type TeamMemberProjection = {
  userOpenId: string;
  membershipRole: "admin" | "operator" | "field";
  displayName: string;
  employmentStatus: "active" | "leave" | "ended";
  skills: string[];
  weeklyCapacityUnits: ProvenancedValue<number>;
  assignedCommercialMissions: Array<{ id: number; code: string; status: string; destinationPath: string }>;
  profileId: string | null;
};

export type TeamProjection = {
  generatedAt: string;
  active: boolean;
  members: TeamMemberProjection[];
  totalKnownWeeklyCapacity: ProvenancedValue<number>;
  ownerIndependentRevenue: ProvenancedValue<number>;
  dataQuality: DataQuality;
};
