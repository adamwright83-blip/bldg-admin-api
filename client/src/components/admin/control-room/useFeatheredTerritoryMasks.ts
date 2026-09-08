import { useEffect, useState } from "react";
import { territoryMaskSrc } from "@shared/territoryMaskPackage";

/**
 * Feathered copies of the canonical territory masks, produced at render time.
 *
 * The authoritative masks are hard-edged grayscale PNGs (white = territory).
 * Two things make them unusable as-is for a painterly state gel:
 *
 *  1. They carry no alpha channel, so CSS `mask-image` (alpha mode) would
 *     treat the whole bbox as opaque and the gel would become a rectangle.
 *  2. A hard polygon edge under a flat tint reads as posterized vector art,
 *     which is exactly the look this world is not allowed to have.
 *
 * So each mask is loaded once, converted to alpha (luminance → alpha) and given
 * a small blur relative to its own size. Geometry is never redrawn or moved:
 * the 50% contour of the feathered mask is the original mask edge.
 *
 * Falls back to the raw mask URL (with `mask-mode: luminance` in CSS) when a
 * canvas is unavailable, so the gel is still clipped to the real territory.
 */

const WORK_WIDTH = 512;
/** Blur radius as a share of the mask's working width. */
const FEATHER_SHARE = 0.022;

const cache = new Map<string, Promise<string>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`mask failed to load: ${src}`));
    image.src = src;
  });
}

export async function featheredTerritoryMask(territoryId: string): Promise<string> {
  const raw = territoryMaskSrc(territoryId);
  const cached = cache.get(territoryId);
  if (cached) return cached;
  const job = (async () => {
    if (typeof document === "undefined") return raw;
    const image = await loadImage(raw);
    const scale = WORK_WIDTH / Math.max(1, image.naturalWidth);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return raw;
    const blur = Math.max(2, Math.round(width * FEATHER_SHARE));
    if ("filter" in ctx) {
      ctx.filter = `blur(${blur}px)`;
    }
    ctx.drawImage(image, 0, 0, width, height);
    ctx.filter = "none";
    const pixels = ctx.getImageData(0, 0, width, height);
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      // Luminance → alpha. Masks are grayscale so any channel is the value.
      const lum = data[i];
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = lum;
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png");
  })().catch(() => raw);
  cache.set(territoryId, job);
  return job;
}

/**
 * Resolves feathered masks for the given territory ids. Returns a map that
 * fills in as each mask becomes ready; missing entries mean "use the raw mask".
 */
export function useFeatheredTerritoryMasks(
  territoryIds: readonly string[]
): Record<string, string> {
  const [masks, setMasks] = useState<Record<string, string>>({});
  const key = territoryIds.join("|");

  useEffect(() => {
    let live = true;
    if (!territoryIds.length) return;
    Promise.all(
      territoryIds.map(async id => [id, await featheredTerritoryMask(id)] as const)
    ).then(entries => {
      if (!live) return;
      setMasks(current => {
        const next = { ...current };
        for (const [id, url] of entries) next[id] = url;
        return next;
      });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return masks;
}
