import { describe, expect, it } from "vitest";
import { foundationWeaponsFor, FOUNDATION_WEAPONS } from "./armoryFoundation";
import {
  personalEvidenceConfidence,
  personalEvidenceSummary,
} from "./armoryTypes";
import { MAX_ENCOUNTER_WEAPONS } from "./armoryWeaponService";

describe("foundation loadout", () => {
  it("keeps all four archetypes playable before any corpus is ingested", () => {
    for (const archetype of ["ANCHOR", "GATEKEEPER", "GHOST", "STALLER"] as const) {
      const anyChannel = (["phone", "in_person", "follow_up", "proposal"] as const).some(
        channel => foundationWeaponsFor({ archetype, channel }).length > 0
      );
      expect(anyChannel).toBe(true);
    }
  });

  it("returns different baseline moves per channel for the same archetype", () => {
    const phone = foundationWeaponsFor({
      archetype: "GATEKEEPER",
      channel: "phone",
    }).map(weapon => weapon.id);
    const proposal = foundationWeaponsFor({
      archetype: "GATEKEEPER",
      channel: "proposal",
    }).map(weapon => weapon.id);
    expect(phone).not.toEqual(proposal);
  });

  it("preserves the Run-1 Anchor foundation entries unchanged", () => {
    const anchorIds = FOUNDATION_WEAPONS.filter(
      weapon => weapon.archetype === "ANCHOR"
    ).map(weapon => weapon.id);
    expect(anchorIds).toEqual([
      "foundation:fast-response",
      "foundation:no-risk-trial",
      "foundation:social-proof",
    ]);
  });

  it("makes no effectiveness or statistical claim in baseline copy", () => {
    for (const weapon of FOUNDATION_WEAPONS) {
      const copy = `${weapon.title} ${weapon.spokenLine ?? ""} ${weapon.discoveryQuestion ?? ""} ${weapon.principle}`;
      expect(copy).not.toMatch(/\d+\s?%/);
      expect(copy.toLowerCase()).not.toMatch(/closes|guarantee|proven to|always works/);
    }
  });
});

describe("personal evidence bands", () => {
  it("treats a handful of uses as insufficient", () => {
    expect(personalEvidenceConfidence({ uses: 0, outcomeEvidence: 0 })).toBe(
      "insufficient"
    );
    expect(personalEvidenceConfidence({ uses: 2, outcomeEvidence: 2 })).toBe(
      "insufficient"
    );
  });

  it("only calls evidence strong with both volume and observed outcomes", () => {
    expect(personalEvidenceConfidence({ uses: 8, outcomeEvidence: 3 })).toBe(
      "strong"
    );
    expect(personalEvidenceConfidence({ uses: 8, outcomeEvidence: 1 })).toBe(
      "emerging"
    );
    expect(personalEvidenceConfidence({ uses: 4, outcomeEvidence: 4 })).toBe(
      "emerging"
    );
  });

  it("describes evidence as observation and never as causation", () => {
    const summary = personalEvidenceSummary({
      uses: 9,
      outcomeEvidence: 4,
      confidence: "strong",
    });
    expect(summary).toMatch(/observed/i);
    expect(summary.toLowerCase()).not.toMatch(
      /caused|because of|thanks to|works|effective|success rate/
    );
    expect(summary).not.toMatch(/\d+\s?%/);
  });

  it("says plainly when there is not enough of the player's own evidence", () => {
    expect(
      personalEvidenceSummary({
        uses: 2,
        outcomeEvidence: 1,
        confidence: "insufficient",
      })
    ).toMatch(/not enough/i);
  });
});

describe("encounter loadout size", () => {
  it("caps encounter choices at three", () => {
    expect(MAX_ENCOUNTER_WEAPONS).toBe(3);
  });
});
