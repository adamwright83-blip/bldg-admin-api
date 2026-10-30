import { expect, type Page } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Shared by the recordings (fridayCircuit.demo.spec.ts and fridayCircuit.phone.demo.spec.ts). */
const PAGE = `file://${resolve("tmp/friday-circuit/friday-circuit.local.html")}`;
const MARKS = resolve("tmp/prototypes-results/demo-marks.json");
export const courier = (page: Page) => page.getByTestId("courier");

export async function setJunction(page: Page, to: string) {
  const junction = page.getByTestId("junction");
  for (let i = 0; i < 3 && (await junction.getAttribute("data-junction")) !== to; i += 1) {
    await junction.click();
    await page.waitForTimeout(450);
  }
  await expect(junction).toHaveAttribute("data-junction", to);
}

export async function docksAt(page: Page, pad: string) {
  await expect(courier(page)).toHaveAttribute("data-at", pad, { timeout: 15_000 });
  await expect(courier(page)).toHaveAttribute("data-moment", "idle", { timeout: 15_000 });
}

export async function fresh(page: Page) {
  await page.goto(`${PAGE}#letters`);
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`${PAGE}#letters`);
}

/** Out on THEN, round the hotel on NOW, home on THEN; notes when the last leg home began. */
export async function circuit(page: Page, mark: (event: string) => void) {
  await setJunction(page, "west-north");
  await page.waitForTimeout(500);
  await page.getByTestId("wind").click();
  await docksAt(page, "P");
  await page.waitForTimeout(600);
  await page.getByTestId("layer-now").click();
  await page.waitForTimeout(1300);
  await page.getByTestId("wind").click();
  await docksAt(page, "Q");
  await page.waitForTimeout(800);
  await page.getByTestId("layer-then").click();
  await page.waitForTimeout(1300);
  await setJunction(page, "west-east");
  await page.waitForTimeout(500);
  mark("homeLeg");
  await page.getByTestId("wind").click();
  await docksAt(page, "S");
}

/** Taps the ending along, beat by beat, to the settled desk. */
export async function tapAlong(page: Page) {
  for (const beat of ["chapter", "hotel", "desk"]) {
    await page.waitForTimeout(900);
    await page.getByTestId("advance").click();
    await expect(page.getByTestId("friday-circuit")).toHaveAttribute("data-ending", beat);
  }
  await expect(page.getByTestId("desk")).toHaveAttribute("data-stage", "4", { timeout: 10_000 });
}

/** Notes, for trimming, how far into a recording something happened. */
export function recorder(name: string) {
  const started = Date.now();
  return (event: string) => {
    const marks = existsSync(MARKS) ? (JSON.parse(readFileSync(MARKS, "utf8")) as Record<string, Record<string, number>>) : {};
    marks[name] = { ...marks[name], [event]: Date.now() - started };
    writeFileSync(MARKS, JSON.stringify(marks, null, 2));
  };
}
