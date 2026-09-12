/** Horizontal carousel navigation from a pointer gesture. */
export type CarouselSwipeDirection = "next" | "prev";

/**
 * Decide whether a pointer gesture should advance the custody carousel.
 * Flick right advances (car → cleaners → closet); flick left goes back.
 */
export function resolveCarouselSwipe(input: {
  deltaX: number;
  deltaY: number;
  elapsedMs: number;
}): CarouselSwipeDirection | null {
  const { deltaX, deltaY, elapsedMs } = input;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  const velocity = absX / Math.max(elapsedMs, 1);

  if (absY > 36 && absY > absX * 0.85) return null;

  if (velocity >= 0.32 && absX >= 10)
    return deltaX > 0 ? "next" : "prev";

  if (absX >= 24 && absX > absY * 1.05)
    return deltaX > 0 ? "next" : "prev";

  return null;
}

export function isCarouselTap(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) < 12 && Math.abs(deltaY) < 12;
}
