/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/**
 * True for a cookie from the shared DRIVER_PASSWORD form. It still opens the
 * Day Line, but it is not a JOYSTICK membership, so Claire and member-only
 * surfaces refuse it (server: `authorizeJoystickClaireDesk`).
 */
export function signedInWithLegacyDriverPassword(user: {
  openId?: string | null;
  role?: string | null;
} | null | undefined): boolean {
  if (!user?.openId || user.role !== "driver") return false;
  return !user.openId.startsWith("dayforge:");
}
