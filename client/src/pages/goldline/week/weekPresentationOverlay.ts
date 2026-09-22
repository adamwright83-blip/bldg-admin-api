/**
 * Presentation-only skin for a locked week.
 * Never stored on WeeklyIntent. Never business truth.
 * An empty overlay is a finished brochure: weekday, objective, paper, loadout.
 */
export type WeekDayPresentation = {
  fictionTitle?: string;
  artVariant?: string;
  chapterSkinId?: string;
};

export type WeekPresentationOverlay = Record<string, WeekDayPresentation>;

export function presentationForDay(
  overlay: WeekPresentationOverlay | undefined,
  businessDate: string
): WeekDayPresentation {
  return overlay?.[businessDate] ?? {};
}
