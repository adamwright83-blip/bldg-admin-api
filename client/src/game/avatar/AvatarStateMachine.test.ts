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

describe("AvatarStateMachine premium choreography hooks", () => {
  it("exposes acceleration, deceleration, and reversal without needing new art", () => {
    const machine = new AvatarStateMachine();
    machine.setLocomotion(0.8);
    expect(machine.locomotionPhase).toBe("accelerating");
    machine.setLocomotion(0.1);
    expect(machine.locomotionPhase).toBe("decelerating");
    machine.noteReversal();
    expect(machine.locomotionPhase).toBe("reversing");
  });

  it("sequences a short human approach into encounter-ready staging", () => {
    const machine = new AvatarStateMachine();
    machine.beginHumanApproach(1_000);
    expect(machine.choreographyPhase).toBe("human_approach");
    machine.tick(1_319);
    expect(machine.choreographyPhase).toBe("human_approach");
    machine.tick(1_320);
    expect(machine.choreographyPhase).toBe("encounter_ready");
  });

  it("reacts only after an authoritative outcome hook and returns control", () => {
    const machine = new AvatarStateMachine();
    machine.acknowledgeAuthoritativeOutcome(2_000);
    expect(machine.choreographyPhase).toBe("outcome_reaction");
    machine.tick(2_420);
    expect(machine.choreographyPhase).toBe("departure");
    machine.returnToControl(2_500);
    machine.tick(2_680);
    expect(machine.choreographyPhase).toBe("traversal");
  });
});
