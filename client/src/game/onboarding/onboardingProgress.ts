/**
 * First-run teaching persists as a small set of lightweight milestone flags,
 * not a dedicated onboarding engine or backend table. Stored client-side
 * (same pattern as AudioManager's mute flag) so it survives reload without a
 * migration; a shared device across multiple drivers would show the hint
 * again for the second driver, which is the acceptable trade-off for
 * avoiding new backend state for something this disposable.
 */
export const ONBOARDING_MILESTONES = [
  "movement",
  "jump",
  "climb",
  "vault",
  "first_armory_choice",
  "first_mission_engaged",
  "first_business_resolution",
  "first_entry_explained",
] as const;

export type OnboardingMilestone = (typeof ONBOARDING_MILESTONES)[number];

const STORAGE_KEY = "goldline:onboarding:v1";

function readCompleted(): Set<OnboardingMilestone> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((value): value is OnboardingMilestone =>
        (ONBOARDING_MILESTONES as readonly string[]).includes(value)
      )
    );
  } catch {
    return new Set();
  }
}

export function hasOnboardingMilestone(milestone: OnboardingMilestone): boolean {
  try {
    return readCompleted().has(milestone);
  } catch {
    return false;
  }
}

/** Idempotent — marking an already-completed milestone is a no-op. */
export function markOnboardingMilestone(milestone: OnboardingMilestone): void {
  if (typeof window === "undefined") return;
  try {
    const completed = readCompleted();
    if (completed.has(milestone)) return;
    completed.add(milestone);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(completed)));
  } catch {
    // Best-effort only — a lost tutorial flag just means the hint reappears.
  }
}
