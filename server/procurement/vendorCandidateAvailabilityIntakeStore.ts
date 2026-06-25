// Slice 78b. Vendor candidate availability intake -- profile/intake data
// only. This module never creates a booking, never connects Google
// Calendar, never sends an onboarding link/email/SMS, and never touches
// any vendor_contact_attempts truth column. One row per
// (tenantId, candidateId), enforced by the table's own UNIQUE KEY;
// upsertForCandidate is idempotent.

import { randomUUID } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";

export const MOBILE_SERVICE_CONFIRMED_VALUES = ["yes", "no", "unknown"] as const;
export type MobileServiceConfirmed = (typeof MOBILE_SERVICE_CONFIRMED_VALUES)[number];

export const CALENDAR_METHODS = ["held_schedule", "booking_url", "google_calendar_later", "manual_confirmation"] as const;
export type CalendarMethod = (typeof CALENDAR_METHODS)[number];

export const PREFERRED_CONTACT_CHANNELS = ["phone", "email", "text", "website", "booking_url"] as const;
export type PreferredContactChannel = (typeof PREFERRED_CONTACT_CHANNELS)[number];

export type RecurringAvailabilityBlock = { days: string[]; startTime: string; endTime: string; note?: string | null };

export type VendorCandidateAvailabilityIntake = {
  id: string;
  tenantId: string;
  candidateId: string;
  mobileServiceConfirmed: MobileServiceConfirmed;
  serviceAreas: string[] | null;
  recurringAvailability: RecurringAvailabilityBlock[] | null;
  minimumNoticeHours: number | null;
  appointmentDurationMinutes: number | null;
  travelBufferMinutes: number | null;
  bookingUrl: string | null;
  calendarMethod: CalendarMethod | null;
  preferredContactChannel: PreferredContactChannel | null;
  blackoutNotes: string | null;
  onboardingNotes: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

type IntakeDbRow = RowDataPacket & {
  id: string; tenant_id: string; candidate_id: string; mobile_service_confirmed: MobileServiceConfirmed;
  service_areas_json: string | string[] | null; recurring_availability_json: string | RecurringAvailabilityBlock[] | null;
  minimum_notice_hours: number | null; appointment_duration_minutes: number | null; travel_buffer_minutes: number | null;
  booking_url: string | null; calendar_method: CalendarMethod | null; preferred_contact_channel: PreferredContactChannel | null;
  blackout_notes: string | null; onboarding_notes: string | null; created_by: string; created_at: Date; updated_at: Date;
};

function parseJsonArray<T>(value: string | T[] | null): T[] | null {
  if (value === null) return null;
  return typeof value === "string" ? (JSON.parse(value) as T[]) : value;
}

function mapRow(row: IntakeDbRow): VendorCandidateAvailabilityIntake {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    candidateId: row.candidate_id,
    mobileServiceConfirmed: row.mobile_service_confirmed,
    serviceAreas: parseJsonArray<string>(row.service_areas_json),
    recurringAvailability: parseJsonArray<RecurringAvailabilityBlock>(row.recurring_availability_json),
    minimumNoticeHours: row.minimum_notice_hours,
    appointmentDurationMinutes: row.appointment_duration_minutes,
    travelBufferMinutes: row.travel_buffer_minutes,
    bookingUrl: row.booking_url,
    calendarMethod: row.calendar_method,
    preferredContactChannel: row.preferred_contact_channel,
    blackoutNotes: row.blackout_notes,
    onboardingNotes: row.onboarding_notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `id, tenant_id, candidate_id, mobile_service_confirmed, service_areas_json, recurring_availability_json,
  minimum_notice_hours, appointment_duration_minutes, travel_buffer_minutes, booking_url, calendar_method,
  preferred_contact_channel, blackout_notes, onboarding_notes, created_by, created_at, updated_at`;

export type UpsertAvailabilityIntakeInput = {
  tenantId: string;
  candidateId: string;
  mobileServiceConfirmed?: MobileServiceConfirmed;
  serviceAreas?: string[] | null;
  recurringAvailability?: RecurringAvailabilityBlock[] | null;
  minimumNoticeHours?: number | null;
  appointmentDurationMinutes?: number | null;
  travelBufferMinutes?: number | null;
  bookingUrl?: string | null;
  calendarMethod?: CalendarMethod | null;
  preferredContactChannel?: PreferredContactChannel | null;
  blackoutNotes?: string | null;
  onboardingNotes?: string | null;
  createdBy: string;
};

export class VendorCandidateAvailabilityIntakeStore {
  constructor(private readonly pool: Pool) {}

  async getByCandidateId(input: { tenantId: string; candidateId: string }): Promise<VendorCandidateAvailabilityIntake | null> {
    const [rows] = await this.pool.execute<IntakeDbRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM vendor_candidate_availability_intake WHERE tenant_id = ? AND candidate_id = ?`,
      [input.tenantId, input.candidateId],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Idempotent upsert: relies on the table's own
   * uq_vendor_candidate_availability_intake_candidate UNIQUE KEY
   * (tenant_id, candidate_id) -- a second call for the same candidate
   * updates the existing row rather than creating a duplicate.
   */
  async upsertForCandidate(input: UpsertAvailabilityIntakeInput): Promise<VendorCandidateAvailabilityIntake> {
    const id = randomUUID();
    await this.pool.execute(
      `INSERT INTO vendor_candidate_availability_intake
        (id, tenant_id, candidate_id, mobile_service_confirmed, service_areas_json, recurring_availability_json,
         minimum_notice_hours, appointment_duration_minutes, travel_buffer_minutes, booking_url, calendar_method,
         preferred_contact_channel, blackout_notes, onboarding_notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         mobile_service_confirmed = VALUES(mobile_service_confirmed),
         service_areas_json = VALUES(service_areas_json),
         recurring_availability_json = VALUES(recurring_availability_json),
         minimum_notice_hours = VALUES(minimum_notice_hours),
         appointment_duration_minutes = VALUES(appointment_duration_minutes),
         travel_buffer_minutes = VALUES(travel_buffer_minutes),
         booking_url = VALUES(booking_url),
         calendar_method = VALUES(calendar_method),
         preferred_contact_channel = VALUES(preferred_contact_channel),
         blackout_notes = VALUES(blackout_notes),
         onboarding_notes = VALUES(onboarding_notes)`,
      [
        id,
        input.tenantId,
        input.candidateId,
        input.mobileServiceConfirmed ?? "unknown",
        input.serviceAreas == null ? null : JSON.stringify(input.serviceAreas),
        input.recurringAvailability == null ? null : JSON.stringify(input.recurringAvailability),
        input.minimumNoticeHours ?? null,
        input.appointmentDurationMinutes ?? null,
        input.travelBufferMinutes ?? null,
        input.bookingUrl ?? null,
        input.calendarMethod ?? null,
        input.preferredContactChannel ?? null,
        input.blackoutNotes ?? null,
        input.onboardingNotes ?? null,
        input.createdBy,
      ],
    );
    const saved = await this.getByCandidateId({ tenantId: input.tenantId, candidateId: input.candidateId });
    if (!saved) throw new Error("Failed to read back availability intake after upsert");
    return saved;
  }
}
