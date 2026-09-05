/** Coordinates registered against the supplied 1536 × 1024 courtyard artwork. */
export const SIEGE_ART = "/assets/goldline/siege";
export const STAGE_PADS = [
  { x: 507, y: 750 },
  { x: 1029, y: 611 },
  { x: 537, y: 471 },
];
// The route follows the painted paving; it makes no assertion about real access geometry.
const ROUTE = [
  { x: 681, y: 963 },
  { x: 818, y: 869 },
  { x: 891, y: 773 },
  { x: 864, y: 686 },
  { x: 779, y: 620 },
  { x: 698, y: 559 },
  { x: 700, y: 511 },
  { x: 759, y: 465 },
  { x: 801, y: 443 },
];
export function stagePoint(t: number) {
  const n = Math.max(0, Math.min(1, t)) * (ROUTE.length - 1);
  const i = Math.min(ROUTE.length - 2, Math.floor(n));
  const u = n - i;
  const a = ROUTE[i],
    b = ROUTE[i + 1];
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}
export function stageCamera(width: number, height: number) {
  const portrait = width / height < 1.15;
  const view = portrait
    ? { x: 363, y: 270, width: 830, height: 754 }
    : { x: 0, y: 0, width: 1536, height: 1024 };
  const scale = Math.min(width / view.width, height / view.height);
  return {
    scale,
    x: (width - view.width * scale) / 2 - view.x * scale,
    y: (height - view.height * scale) / 2 - view.y * scale,
  };
}
export function screenPoint(
  point: { x: number; y: number },
  width: number,
  height: number
) {
  const camera = stageCamera(width, height);
  return {
    x: point.x * camera.scale + camera.x,
    y: point.y * camera.scale + camera.y,
  };
}
