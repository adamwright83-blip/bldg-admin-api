export type DayDirectorActorContext = {
  user?: { id?: unknown };
};

/** Canonical authenticated-user key for all Day Director state. */
export function dayDirectorActorId(ctx: DayDirectorActorContext): string {
  return String(ctx.user?.id ?? "unknown");
}
