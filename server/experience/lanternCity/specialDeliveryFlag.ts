/**
 * Rook's airmail station in Silver Lake (SPECIAL DELIVERY) is off unless the business is listed:
 *   JOYSTICK_SPECIAL_DELIVERY_TENANTS  comma-separated tenant ids (no wildcard)
 * Unset, empty, or a tenant not on the list: the routes answer `{ enabled: false }` and refuse every write.
 * Turning it off hides the station and its desk; nothing it remembered is deleted.
 */
export function specialDeliveryTenants(
  env: NodeJS.ProcessEnv = process.env
): ReadonlySet<string> {
  return new Set(
    (env.JOYSTICK_SPECIAL_DELIVERY_TENANTS ?? "")
      .split(",")
      .map(value => value.trim())
      .filter(value => value.length > 0 && value !== "*")
  );
}

export function isSpecialDeliveryEnabled(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return specialDeliveryTenants(env).has(tenantId);
}
