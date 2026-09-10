/**
 * Canonical Lantern City entry.
 *
 * The former Atlas implementation is preserved as
 * LanternCityAtlasV5.archived.tsx and is intentionally not routed.
 * All live Lantern City entry points resolve to V6.
 *
 * Re-export the legacy module's named helpers because other non-Lantern-City
 * screens still import shared classification/projection utilities from this
 * historical module path. `export *` does not re-export its default component,
 * so the live default remains V6.
 */
export { default } from "./LanternCitySceneV6/LanternCityScene";
export * from "./LanternCityAtlasV5.archived";
