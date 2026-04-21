import {
  createInitialDriverPrepState,
  getMissionDayKey,
  normalizeHydratedDriverPrepState,
  type DriverPrepState,
} from "./driverPrepMachine";

export const DRIVER_PREP_STORAGE_KEY = "driverPrepMechanic:v2";

export function hydrateDriverPrepState(): DriverPrepState {
  const todayKey = getMissionDayKey();
  if (typeof window === "undefined") {
    return createInitialDriverPrepState(1, todayKey);
  }

  try {
    const raw = window.localStorage.getItem(DRIVER_PREP_STORAGE_KEY);
    if (!raw) return createInitialDriverPrepState(1, todayKey);
    return normalizeHydratedDriverPrepState(JSON.parse(raw), todayKey);
  } catch {
    return createInitialDriverPrepState(1, todayKey);
  }
}

export function persistDriverPrepState(state: DriverPrepState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DRIVER_PREP_STORAGE_KEY, JSON.stringify(state));
}

export function clearDriverPrepState(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DRIVER_PREP_STORAGE_KEY);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image."));
    image.src = src;
  });
}

function getCanvasMimeType(fileType: string): "image/jpeg" | "image/webp" {
  return fileType === "image/webp" ? "image/webp" : "image/jpeg";
}

export async function compressImageForMissionPreview(file: File): Promise<string> {
  const rawDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(rawDataUrl);
  const maxEdge = 1280;
  const longestEdge = Math.max(image.width, image.height);
  const scale = longestEdge > maxEdge ? maxEdge / longestEdge : 1;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return rawDataUrl;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);

  const mimeType = getCanvasMimeType(file.type);
  return canvas.toDataURL(mimeType, 0.72);
}
