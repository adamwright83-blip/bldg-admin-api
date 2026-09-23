/**
 * Customer-facing platform name.
 *
 * product.joystick is the software. business.laundry_farm is the tenant.
 * service.laundry_butler is the laundry service. This constant is not a
 * tenant id, a route, or an API name.
 */
export const PRODUCT_NAME = "JOYSTICK" as const;

/** Tab and banner copy for a superseded public page. Blank names do not invent a product. */
export function legacyProductNoticeText(legacyName: string): string {
  const name = legacyName.trim();
  return name
    ? `${name} is a legacy page. The product is ${PRODUCT_NAME}.`
    : `This is a legacy page. The product is ${PRODUCT_NAME}.`;
}
