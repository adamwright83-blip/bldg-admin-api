import { describe, expect, it } from "vitest";
import { PRESENTATION_CONSENT_TEXT, setPresentationConsent, type PresentationConsentPorts } from "./presentationConsentService";

/** An in-memory preference store behind the real consent rules. */
function harness(initial: { adaptation?: boolean; experimentation?: boolean } = {}) {
  const prefs = new Map<string, boolean>();
  if (initial.adaptation !== undefined) prefs.set("adaptation_enabled", initial.adaptation);
  if (initial.experimentation !== undefined) prefs.set("safe_experimentation", initial.experimentation);
  const observations: any[] = [];
  const writes: Array<[string, boolean, string]> = [];
  let failReadback = false;
  const ports: PresentationConsentPorts = {
    resolveIdentity: (async () => ({ ok: true, identity: { canonicalOperatorId: "op-1" } })) as never,
    recordObservation: (async (input: any) => {
      observations.push(input);
      return { id: `obs-${observations.length}` };
    }) as never,
    setPreference: (async (input: any) => {
      writes.push([input.preferenceKey, input.value, input.sourceObservationId]);
      if (!failReadback) prefs.set(input.preferenceKey, input.value);
      return {} as never;
    }) as never,
    loadConsent: async () => {
      const adaptationAllowed = prefs.get("adaptation_enabled") === true;
      const stored = prefs.get("safe_experimentation") === true;
      return { adaptationAllowed, experimentationAllowed: adaptationAllowed && stored, evidenceRefs: [], experimentationChoiceStored: stored };
    },
    experimentsRunning: () => true,
    now: () => new Date("2026-10-17T16:00:00Z"),
  };
  return { ports, prefs, observations, writes, failReadback: () => (failReadback = true) };
}
const scope = { tenantId: "t", operatorUserId: "operator:t" };

describe("operator consent for Daphne's presentation experiments", () => {
  it("records each choice as the operator's attested statement with the exact versioned text, then reads it back", async () => {
    const h = harness();
    const view = await setPresentationConsent({ ...scope, choice: "adaptation", granted: true }, h.ports);
    expect(view.adaptationAllowed).toBe(true);
    expect(view.experimentationAllowed).toBe(false);
    expect(h.observations).toHaveLength(1);
    expect(h.observations[0]).toMatchObject({
      evidenceChannel: "stated",
      verificationStatus: "attested",
      observationKind: "preference_declaration",
      sourceType: "authenticated_app_presentation_consent",
      payload: { preferenceKey: "adaptation_enabled", value: true, consentTextVersion: PRESENTATION_CONSENT_TEXT.version, consentText: PRESENTATION_CONSENT_TEXT.adaptation },
    });
    expect(h.writes).toEqual([["adaptation_enabled", true, "obs-1"]]);
  });

  it("experimentation is a separate affirmative choice that needs adaptation first", async () => {
    const h = harness();
    await expect(setPresentationConsent({ ...scope, choice: "experimentation", granted: true }, h.ports)).rejects.toThrow(/first; nothing was changed/);
    expect(h.writes).toEqual([]);
    await setPresentationConsent({ ...scope, choice: "adaptation", granted: true }, h.ports);
    expect((await setPresentationConsent({ ...scope, choice: "experimentation", granted: true }, h.ports)).experimentationAllowed).toBe(true);
  });

  it("stopping adaptation also stops experimentation, so re-allowing adaptation never silently resumes experiments", async () => {
    const h = harness({ adaptation: true, experimentation: true });
    const off = await setPresentationConsent({ ...scope, choice: "adaptation", granted: false }, h.ports);
    expect(off).toMatchObject({ adaptationAllowed: false, experimentationAllowed: false });
    expect(h.writes.map(([key, value]) => [key, value])).toEqual([["safe_experimentation", false], ["adaptation_enabled", false]]);
    const back = await setPresentationConsent({ ...scope, choice: "adaptation", granted: true }, h.ports);
    expect(back).toMatchObject({ adaptationAllowed: true, experimentationAllowed: false });
  });

  it("a failure part-way through stopping adaptation never leaves experiments to resume later", async () => {
    const h = harness({ adaptation: true, experimentation: true });
    const failing: PresentationConsentPorts = {
      ...h.ports,
      setPreference: (async (input: any) => {
        if (input.preferenceKey === "adaptation_enabled") throw new Error("write failed");
        return h.ports.setPreference(input);
      }) as never,
    };
    await expect(setPresentationConsent({ ...scope, choice: "adaptation", granted: false }, failing)).rejects.toThrow(/write failed/);
    expect(h.prefs.get("safe_experimentation")).toBe(false);
    const view = await setPresentationConsent({ ...scope, choice: "adaptation", granted: true }, h.ports);
    expect(view).toMatchObject({ adaptationAllowed: true, experimentationAllowed: false });
  });

  it("re-allowing adaptation clears an experimentation value left behind while adaptation was off", async () => {
    const h = harness({ adaptation: false, experimentation: true });
    const view = await setPresentationConsent({ ...scope, choice: "adaptation", granted: true }, h.ports);
    expect(view).toMatchObject({ adaptationAllowed: true, experimentationAllowed: false });
    expect(h.prefs.get("safe_experimentation")).toBe(false);
  });

  it("re-confirming adaptation while it is on leaves an existing experiment choice alone", async () => {
    const h = harness({ adaptation: true, experimentation: true });
    const view = await setPresentationConsent({ ...scope, choice: "adaptation", granted: true }, h.ports);
    expect(view).toMatchObject({ adaptationAllowed: true, experimentationAllowed: true });
    expect(h.writes.map(([key]) => key)).toEqual(["adaptation_enabled"]);
  });

  it("stopping experimentation leaves adaptation as it was", async () => {
    const h = harness({ adaptation: true, experimentation: true });
    const view = await setPresentationConsent({ ...scope, choice: "experimentation", granted: false }, h.ports);
    expect(view).toMatchObject({ adaptationAllowed: true, experimentationAllowed: false });
  });

  it("never reports a choice the read-back does not show", async () => {
    const h = harness();
    h.failReadback();
    await expect(setPresentationConsent({ ...scope, choice: "adaptation", granted: true }, h.ports)).rejects.toThrow(/read-back/);
  });
});
