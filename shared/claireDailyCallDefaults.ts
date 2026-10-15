/**
 * Canonical recommended schedules for Claire's two independent standing call grants.
 * Local clock time in the operator's business timezone; saved authorizations are
 * never silently rewritten when these recommendations change.
 */
export const CLAIRE_DAILY_CALL_DEFAULTS = {
  morning_readiness: {
    label: "Morning readiness",
    when: "every day, 7:30–8:00 AM",
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    start: "07:30",
    end: "08:00",
  },
  evening_debrief: {
    label: "Evening debrief",
    when: "every day, 6:30–7:00 PM",
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    start: "18:30",
    end: "19:00",
  },
} as const;

export type ClaireDailyCallPurpose = keyof typeof CLAIRE_DAILY_CALL_DEFAULTS;

export function matchesClaireDailyCallDefaults(
  purpose: ClaireDailyCallPurpose,
  grant: { weekdays: number[]; localStart: string; localEnd: string } | null | undefined
): boolean {
  if (!grant) return false;
  const expected = CLAIRE_DAILY_CALL_DEFAULTS[purpose];
  return (
    grant.localStart === expected.start &&
    grant.localEnd === expected.end &&
    grant.weekdays.length === expected.weekdays.length &&
    expected.weekdays.every(day => grant.weekdays.includes(day))
  );
}
