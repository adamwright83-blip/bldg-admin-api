import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SMALL_COMFORTS_ART } from "./artAssets";

describe("Small Comforts runtime art manifest", () => {
  it("uses the validated suitcase v3 contract", () => {
    expect(SMALL_COMFORTS_ART.suitcase.url).toContain("sc_suitcase_v3.glb");
    expect(SMALL_COMFORTS_ART.suitcase.openAngleDeg).toBe(107);
    expect(SMALL_COMFORTS_ART.suitcase.hinge).toEqual([0, 0.9333333373069763, -2.4666666984558105]);
    expect(SMALL_COMFORTS_ART.suitcase.expectedNodes).toContain("Suitcase_Lid");
    expect(SMALL_COMFORTS_ART.suitcase.expectedNodes).toContain("Brass_Latch");
  });

  it("uses the validated v2 bed and lamp", () => {
    expect(SMALL_COMFORTS_ART.bed.url).toContain("sc_bed_v2.glb");
    expect(SMALL_COMFORTS_ART.lamp.url).toContain("sc_lamp_v2.glb");
  });

  it("keeps the Tin Can House WebP container complete", () => {
    const bytes = readFileSync(
      resolve(process.cwd(), "client/public/assets/joystick-home/tin-can-house.webp"),
    );

    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(bytes.readUInt32LE(4) + 8).toBe(bytes.length);

    let offset = 12;
    let sawImageChunk = false;

    while (offset + 8 <= bytes.length) {
      const chunkType = bytes.subarray(offset, offset + 4).toString("ascii");
      const chunkSize = bytes.readUInt32LE(offset + 4);
      const chunkEnd = offset + 8 + chunkSize;

      expect(chunkEnd).toBeLessThanOrEqual(bytes.length);

      if (chunkType === "VP8 " || chunkType === "VP8L" || chunkType === "ANMF") {
        sawImageChunk = true;
      }

      offset = chunkEnd + (chunkSize % 2);
    }

    expect(offset).toBe(bytes.length);
    expect(sawImageChunk).toBe(true);
  });
});
