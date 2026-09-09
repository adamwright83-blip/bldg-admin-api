/**
 * Slice 9 asset contract. Declares every layered asset the premium art pass
 * needs, by exact repo path, without requiring the files to exist yet.
 * FirstChapter.tsx tries each path and falls back to the current vector
 * graybox drawing per-element when a file is missing — so this manifest is
 * safe to land before any art is generated, and each asset can be dropped in
 * independently as it's produced.
 */
import type { Room } from './model';

const BASE = '/assets/goldline/chapters/the-last-valet';

export type LayerAsset = { path: string; purpose: string; width: number; height: number };

export const ROOM_BACKGROUNDS: Record<Room, LayerAsset> = {
  arrival: { path: `${BASE}/backgrounds/arrival-court.webp`, purpose: 'Far background + architecture, ivory stone, teal water accents, warm brass', width: 960, height: 640 },
  garden: { path: `${BASE}/backgrounds/turntable-garden.webp`, purpose: 'Machinery garden midground set piece backdrop', width: 960, height: 640 },
  gallery: { path: `${BASE}/backgrounds/departure-gallery.webp`, purpose: 'Upper confrontation hall backdrop, ceremonial apparatus visible', width: 960, height: 640 },
};

export const ROOM_FOREGROUNDS: Record<Room, LayerAsset> = {
  arrival: { path: `${BASE}/foregrounds/arrival-rail.webp`, purpose: 'Lower-edge occluding rail, foot-level foliage', width: 960, height: 160 },
  garden: { path: `${BASE}/foregrounds/garden-rail.webp`, purpose: 'Foreground occluders around machinery perimeter', width: 960, height: 160 },
  gallery: { path: `${BASE}/foregrounds/gallery-rail.webp`, purpose: 'Foreground rail occluding feet at room edges', width: 960, height: 160 },
};

/** Existing Trailblazer directional idle set is reused; only new action frames are listed here. */
export const CHARACTER_FRAMES = {
  dodge: { path: `${BASE}/characters/heroine-dodge.webp`, purpose: 'Dodge roll frame set, teal motion trail compatible', width: 64, height: 94 },
  attack: { path: `${BASE}/characters/heroine-attack.webp`, purpose: 'Strike swing frame set matching existing reach/timing', width: 64, height: 94 },
  hurt: { path: `${BASE}/characters/heroine-hurt.webp`, purpose: 'Hit-reaction flinch frame, pairs with existing alpha-flicker i-frames', width: 64, height: 94 },
  inez: { path: `${BASE}/characters/inez-vale.webp`, purpose: 'Companion staging sprite, arrival/garden/gallery idle', width: 64, height: 94 },
  bellwether: { path: `${BASE}/characters/bellwether.webp`, purpose: 'Adversary directional sprite replacing placeholder capsule', width: 96, height: 140 },
  perrin: { path: `${BASE}/characters/perrin.webp`, purpose: 'Supporting-character staging sprite, gallery/garden', width: 64, height: 94 },
};

export const MECHANISM_STATES = {
  launcher: { path: `${BASE}/mechanisms/launcher-states.webp`, purpose: 'Dormant/active/launching states, one sprite sheet', width: 64, height: 64 },
  redirector: { path: `${BASE}/mechanisms/redirector-states.webp`, purpose: 'Dormant/active/redirecting heading-indicator states', width: 72, height: 72 },
  weight: { path: `${BASE}/mechanisms/weight.webp`, purpose: 'The launched trolley/weight object, single readable silhouette', width: 32, height: 32 },
  manualLatch: { path: `${BASE}/mechanisms/manual-latch.webp`, purpose: "Perrin's handle, closed/open states", width: 48, height: 48 },
  balcony: { path: `${BASE}/mechanisms/balcony.webp`, purpose: 'Return-secret balcony, locked (dim) and unlocked (lit) states', width: 96, height: 72 },
};

export const FX_ASSETS = {
  hitSpark: { path: `${BASE}/fx/hit-spark.webp`, purpose: 'Strike/guard impact flash', width: 48, height: 48 },
  telegraphLine: { path: `${BASE}/fx/telegraph-line.webp`, purpose: 'Enemy tell/charge trajectory line texture', width: 8, height: 8 },
  secretDiscovery: { path: `${BASE}/fx/secret-discovery.webp`, purpose: 'One-shot particle burst for the return-secret beat', width: 96, height: 96 },
};

export const ALL_LAYER_ASSETS: LayerAsset[] = [
  ...Object.values(ROOM_BACKGROUNDS),
  ...Object.values(ROOM_FOREGROUNDS),
  ...Object.values(CHARACTER_FRAMES),
  ...Object.values(MECHANISM_STATES),
  ...Object.values(FX_ASSETS),
];
