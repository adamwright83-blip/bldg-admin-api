import type { Container } from "pixi.js";

export class CameraController {
  private targetX = 0;

  constructor(private readonly world: Container) {}

  focusMainGate() {
    this.targetX = 0;
  }

  focusRecoveryPath() {
    this.targetX = -42;
  }

  update(deltaSeconds: number) {
    const easing = Math.min(1, deltaSeconds * 4.5);
    this.world.x += (this.targetX - this.world.x) * easing;
  }
}
