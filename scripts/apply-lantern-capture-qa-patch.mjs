import fs from "node:fs/promises";
import path from "node:path";

const file = path.resolve("scripts/capture-lantern-city.mjs");
let source = await fs.readFile(file, "utf8");

const debugAnchor = 'const territoryDebug = process.env.LANTERN_TERRITORY_DEBUG === "1";';
if (!source.includes('const worldTruth = process.env.LANTERN_WORLD_TRUTH === "1";')) {
  if (!source.includes(debugAnchor)) throw new Error("capture-lantern-city debug flag anchor changed");
  source = source.replace(
    debugAnchor,
    `${debugAnchor}\nconst worldTruth = process.env.LANTERN_WORLD_TRUTH === "1";`
  );
}

const gotoAnchor = '  await page.goto(`${origin}/growth/lantern-city${territoryDebug ? "?territoryDebug=1" : ""}`, { waitUntil: "networkidle" });';
if (source.includes(gotoAnchor)) {
  source = source.replace(
    gotoAnchor,
    `  const query = new URLSearchParams();\n  if (territoryDebug) query.set("territoryDebug", "1");\n  if (worldTruth) query.set("worldTruth", "1");\n  const queryString = query.toString();\n  await page.goto(\`${'${origin}'}/growth/lantern-city${'${queryString ? `?${queryString}` : ""}'}\`, { waitUntil: "networkidle" });`
  );
}

source = source.replace(
  '  const file = `lantern-city-${scenario}-${customerScenario}${territoryDebug ? "-territory-debug" : ""}-${viewport.name}.jpg`;',
  '  const file = `lantern-city-${scenario}-${customerScenario}${territoryDebug ? "-territory-debug" : ""}${worldTruth ? "-world-truth" : ""}-${viewport.name}.jpg`;'
);

const screenshotAnchor = '  await page.screenshot({ path: path.join(outputDir, file), type: "jpeg", quality: 82 });';
if (!source.includes("lantern-city-vector-fantasy-zoom-200")) {
  if (!source.includes(screenshotAnchor)) throw new Error("capture-lantern-city screenshot anchor changed");
  source = source.replace(
    screenshotAnchor,
    `${screenshotAnchor}\n\n  // Browser-level zoom QA for the real Admin composition. The camera uses\n  // factor = exp(-deltaY * .0016), so these wheel deltas are approximately\n  // 2x and then 3x relative to the default pose. This exercises the actual\n  // Goldline camera instead of merely cropping the generated master.\n  if (viewport.name === "1920x1080" && !worldTruth && !territoryDebug) {\n    const host = page.locator(".cr-world-camera");\n    const box = await host.boundingBox();\n    if (box) {\n      await page.mouse.move(box.x + box.width * 0.56, box.y + box.height * 0.52);\n      await page.mouse.wheel(0, -433);\n      await page.waitForTimeout(350);\n      await page.screenshot({\n        path: path.join(outputDir, "lantern-city-vector-fantasy-zoom-200.jpg"),\n        type: "jpeg",\n        quality: 88,\n      });\n      await page.mouse.wheel(0, -253);\n      await page.waitForTimeout(350);\n      await page.screenshot({\n        path: path.join(outputDir, "lantern-city-vector-fantasy-zoom-300.jpg"),\n        type: "jpeg",\n        quality: 88,\n      });\n    }\n  }`
  );
}

source = source.replace(
  '    viewport: viewport.name, file, scenario, customerScenario, briefing,',
  '    viewport: viewport.name, file, scenario, customerScenario, worldTruth, briefing,'
);

await fs.writeFile(file, source);
console.log("capture-lantern-city patched for truth-vs-fantasy and 100/200/300 browser QA.");
