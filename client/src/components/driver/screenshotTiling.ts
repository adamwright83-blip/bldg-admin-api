/**
 * Preparing a phone screenshot so the text in it survives the trip.
 *
 * THE FAILURE THIS EXISTS TO FIX
 *
 * A CleanCloud screenshot from a modern phone is around 1170x2532. The vision
 * provider resizes any image whose long edge exceeds ~1568px before it ever
 * reaches the model, so a 2532px-tall screenshot arrives downscaled to about
 * 62% — and the row text (customer name, address, order number, the small
 * pickup/dropoff marker) is exactly the detail that does not survive that.
 *
 * The model then answers honestly: it cannot read the rows. That surfaced to
 * the operator as "No jobs could be read from those screenshots", which reads
 * as "your screenshot was bad" when the truth was "we shrank it until it was".
 *
 * THE FIX
 *
 * Cut the tall screenshot into horizontal bands, each short enough to pass
 * under the provider's resize threshold at NATIVE resolution. Nothing is
 * downsampled, so nothing becomes illegible.
 *
 * Bands overlap. A job row sitting exactly on a cut line would otherwise be
 * split in half and read as two unusable fragments, or missed entirely; the
 * overlap guarantees every row appears whole in at least one band. The caller
 * de-duplicates, and the operator reviews everything regardless.
 *
 * A wide-but-short image is left completely alone: if it already fits, cutting
 * it up would only cost the model context it could have used.
 */

/**
 * Long-edge budget. The provider resizes above roughly 1568px, so bands are
 * kept meaningfully under it rather than at the boundary — a screenshot whose
 * height divides awkwardly should not produce one band that lands right on the
 * limit and gets shrunk anyway.
 */
export const MAX_EDGE_PX = 1400;

/**
 * Vertical overlap between adjacent bands, in pixels. Comfortably taller than
 * a CleanCloud job row so a row cannot fall into the seam between two bands.
 */
export const BAND_OVERLAP_PX = 180;

/**
 * The request accepts at most 6 images, and that ceiling is shared with any
 * screenshots the operator selected themselves. Tiling must not silently eat
 * that budget.
 */
export const MAX_IMAGES = 6;

/** JPEG quality for emitted bands. High enough that small text stays crisp. */
export const BAND_QUALITY = 0.92;

export type TilePlan = {
  /** Top edge of each band in source pixels. */
  offsets: number[];
  /** Height of each band in source pixels. */
  bandHeight: number;
};

/**
 * Works out where to cut, in pure arithmetic, so the rule is testable without
 * a canvas or a DOM.
 *
 * Returns a single full-height band when the image already fits — the caller
 * treats that as "send the original untouched".
 */
export function planTiles(
  width: number,
  height: number,
  budget: number = MAX_EDGE_PX,
  overlap: number = BAND_OVERLAP_PX,
  maxBands: number = MAX_IMAGES
): TilePlan {
  if (height <= budget && width <= budget) {
    return { offsets: [0], bandHeight: height };
  }
  // A very wide image cannot be helped by horizontal banding; the width itself
  // is over budget and the provider will resize regardless. Send it whole
  // rather than pretending cutting it solved something.
  if (width > budget) {
    return { offsets: [0], bandHeight: height };
  }

  const stride = Math.max(1, budget - overlap);
  const needed = Math.ceil((height - overlap) / stride);
  const bands = Math.max(1, Math.min(needed, maxBands));

  // With a band cap, spread the cuts evenly across the whole image rather than
  // marching from the top and losing the bottom of the screenshot entirely.
  const offsets: number[] = [];
  if (bands === 1) {
    offsets.push(0);
  } else {
    const span = height - budget;
    for (let i = 0; i < bands; i += 1) {
      offsets.push(Math.round((span * i) / (bands - 1)));
    }
  }
  return { offsets, bandHeight: Math.min(budget, height) };
}

/** True when this image would be downscaled by the provider as-is. */
export function wouldBeDownscaled(
  width: number,
  height: number,
  budget: number = MAX_EDGE_PX
): boolean {
  return Math.max(width, height) > budget;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Screenshot could not be decoded"));
    img.src = dataUrl;
  });
}

/**
 * Turns one screenshot into the images actually sent for extraction.
 *
 * Returns the original untouched when it already fits. Never returns more than
 * `remainingBudget` images. Falls back to the original on any canvas failure —
 * a slightly-shrunk screenshot the model may still read is strictly better
 * than no import at all.
 */
export async function prepareScreenshotForExtraction(
  dataUrl: string,
  remainingBudget: number = MAX_IMAGES
): Promise<string[]> {
  if (remainingBudget <= 0) return [];
  try {
    const img = await loadImage(dataUrl);
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) return [dataUrl];
    if (!wouldBeDownscaled(width, height)) return [dataUrl];

    const plan = planTiles(width, height, MAX_EDGE_PX, BAND_OVERLAP_PX, remainingBudget);
    if (plan.offsets.length <= 1) return [dataUrl];

    const bands: string[] = [];
    for (const offset of plan.offsets) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.min(plan.bandHeight, height - offset);
      const ctx = canvas.getContext("2d");
      if (!ctx) return [dataUrl];
      ctx.drawImage(
        img,
        0,
        offset,
        width,
        canvas.height,
        0,
        0,
        width,
        canvas.height
      );
      bands.push(canvas.toDataURL("image/jpeg", BAND_QUALITY));
    }
    return bands.length > 0 ? bands : [dataUrl];
  } catch {
    // Decoding or canvas failure must not block the import.
    return [dataUrl];
  }
}

/**
 * Prepares every selected screenshot, sharing the request's image budget
 * across them so a two-screenshot selection cannot exceed the limit.
 */
export async function prepareScreenshotsForExtraction(
  dataUrls: string[]
): Promise<string[]> {
  const prepared: string[] = [];
  for (const dataUrl of dataUrls) {
    const remaining = MAX_IMAGES - prepared.length;
    if (remaining <= 0) break;
    // Leave room for at least one band per remaining screenshot.
    const others = dataUrls.length - dataUrls.indexOf(dataUrl) - 1;
    const budget = Math.max(1, remaining - others);
    prepared.push(...(await prepareScreenshotForExtraction(dataUrl, budget)));
  }
  return prepared.slice(0, MAX_IMAGES);
}
