import { describe, expect, it } from "vitest";
import { AvatarStateMachine } from "./AvatarStateMachine";

describe("AvatarStateMachine jump phases", () => {
  it("sequences jump_start -> jump_air -> land without collapsing to one pose", () => {
    const machine = new AvatarStateMachine();
    machine.beginAction("JUMP", 0);
    expect(machine.state).toBe("jump_start");

    machine.tick(50);
    expect(machine.state).toBe("jump_start");

    machine.tick(300);
    expect(machine.state).toBe("jump_air");

    machine.tick(600);
    expect(machine.state).toBe("land");
  });

  it("returns to idle only through release, not automatically", () => {
    const machine = new AvatarStateMachine();
    machine.beginAction("JUMP", 0);
    machine.tick(600);
    expect(machine.state).toBe("land");
    machine.release();
    expect(machine.state).toBe("idle");
  });

  it("does not sequence phases for single-phase actions", () => {
    const machine = new AvatarStateMachine();
    machine.beginAction("CLIMB", 0);
    machine.tick(300);
    expect(machine.state).toBe("climb");
  });

  it("produces a bell-curve height factor, zero at both ends and peak mid-arc", () => {
    const machine = new AvatarStateMachine();
    machine.beginAction("JUMP", 0);
    const duration = machine.actionDurationMs("JUMP");
    expect(machine.jumpHeightFactor(0)).toBeCloseTo(0, 5);
    expect(machine.jumpHeightFactor(duration)).toBeCloseTo(0, 5);
    const mid = machine.jumpHeightFactor(duration / 2);
    expect(mid).toBeGreaterThan(0.9);
  });

  it("locomotion input is ignored mid-jump so the arc cannot be interrupted", () => {
    const machine = new AvatarStateMachine();
    machine.beginAction("JUMP", 0);
    machine.tick(50);
    machine.setLocomotion(1);
    expect(machine.state).toBe("jump_start");
  });
});
