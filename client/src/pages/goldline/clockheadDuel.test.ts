import { expect, it } from "vitest";
import { createClockDuel, stepClockDuel } from "./clockheadDuelEngine";
it("cannot win by time, holding strike, or attacking a closed window", () => {
  let s = createClockDuel();
  for (let i = 0; i < 2000; i++) s = stepClockDuel(s, 16, { x: 0, y: 0, strike: true });
  expect(s.bossHp).toBe(9); expect(s.stage).toBe("lost");
});
it("requires nine distinct close-range vulnerable-window strikes and escalates patterns", () => {
  let s = createClockDuel();
  const phases = new Set<number>(); const patterns = new Set<string>();
  for (let hit = 0; hit < 9; hit++) {
    // Isolate attack-window contract; browser proof exercises movement and danger.
    s = { ...s, stage: "exposed", clock: 0, struck: false, player: { x: 50, y: 50 }, freezeMs: 0 };
    s = stepClockDuel(s, 16, { x: 0, y: 0, strike: true });
    phases.add(s.phase);
    const hp = s.bossHp;
    s = stepClockDuel({ ...s, freezeMs: 0 }, 16, { x: 0, y: 0, strike: true });
    expect(s.bossHp).toBe(hp);
    if (s.stage !== "won") { s = stepClockDuel({ ...s, clock: 1250, freezeMs: 0 }, 16, { x: 0, y: 0 }); patterns.add(s.pattern); }
  }
  expect([...phases]).toEqual([1, 2, 3]); expect(patterns.has("aimed")).toBe(true); expect(patterns.has("sweep")).toBe(true); expect(patterns.has("deadline")).toBe(true);
  expect(s.stage).toBe("won"); expect(s.hp).toBe(3);
});
it("shows a full tell before dangerous attacks and permits timed dodge", () => {
  let s = createClockDuel();
  for (let i = 0; i < 20; i++) s = stepClockDuel(s, 40, { x: 0, y: 0 });
  expect(s.stage).toBe("tell"); expect(s.projectiles).toHaveLength(0);
  s = stepClockDuel(s, 40, { x: 1, y: 0, dodge: true });
  expect(s.dodgeMs).toBe(320); expect(s.player.x).toBeGreaterThan(50);
});
