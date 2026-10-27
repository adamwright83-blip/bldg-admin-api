import { describe, expect, it } from "vitest";
import { classifyTether, headPosition, tetherPath, unlockLineY, type TetherGeometry } from "./claireTetherModel";

const g: TetherGeometry = { width: 390, height: 844, restX: 345, restY: 43, size: 58 };
const line = unlockLineY(g);

const at = (headY: number, extra: Partial<Parameters<typeof classifyTether>[0]> = {}) =>
  classifyTether({ geometry: g, previous: "pulling", dx: 0, dy: headY - g.restY, headY, armedAtX: null, pointerX: g.restX, velocityX: 0, ...extra });

describe("Claire tether", () => {
  it("treats a tiny movement as a tap, not a pull", () => {
    expect(classifyTether({ geometry: g, previous: "rest", dx: 3, dy: 4, headY: g.restY + 4, armedAtX: null, pointerX: g.restX + 3, velocityX: 0 })).toBe("rest");
  });
  it("does nothing until the head crosses the message line", () => {
    expect(at(line - 40)).toBe("pulling");
    expect(at(line + 1)).toBe("message");
  });
  it("switches to calling only after a rightward slide past the line", () => {
    const armedAtX = g.restX - 10;
    expect(at(line + 10, { previous: "message", armedAtX, pointerX: armedAtX + 20 })).toBe("message");
    expect(at(line + 10, { previous: "message", armedAtX, pointerX: armedAtX + 40 })).toBe("call");
    expect(at(line + 10, { previous: "message", armedAtX, pointerX: armedAtX + 16, velocityX: 900 })).toBe("call");
    expect(at(line + 10, { previous: "message", armedAtX, pointerX: g.width })).toBe("call");
  });
  it("sliding back left returns from calling to messaging", () => {
    const armedAtX = 300;
    expect(at(line + 10, { previous: "call", armedAtX, pointerX: 305 })).toBe("message");
  });
  it("pulling back above the line disarms, with a little slack", () => {
    expect(at(line - 10, { previous: "message", armedAtX: 300, pointerX: 300 })).toBe("message");
    expect(at(line - 60, { previous: "message", armedAtX: 300, pointerX: 300 })).toBe("pulling");
  });
  it("keeps the head on screen and hugging the right edge before arming", () => {
    const p = headPosition(g, "pulling", -200, 5000);
    expect(p.y).toBeLessThan(g.height);
    expect(p.x).toBeGreaterThan(g.restX - 80);
    expect(tetherPath(g, p)).toMatch(/^M [\d.]+ [\d.-]+ Q/);
  });
});
