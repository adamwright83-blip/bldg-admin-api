import "./lantern-city-production-safety.css";

/**
 * Production safety gate for Lantern City's territory mosaic.
 *
 * The generated 61-piece vector mosaic is geographically registered but
 * visually unacceptable: it reads as a posterized street map rather than the
 * approved authored fantasy city. Keep this component mounted so its scoped
 * production-art safety rules load, but render no generated map art until an
 * authored, reviewed territory set is explicitly approved.
 *
 * The authored atlas underneath remains the production surface.
 */
export function LanternTerritoryMosaic() {
  return null;
}
