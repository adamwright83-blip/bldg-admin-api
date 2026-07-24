import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_MISSION_PROOF_MAX_BYTES,
  assertCommercialMissionProofReadAccess,
  assertCommercialMissionProofReviewAccess,
  assertCommercialMissionProofSubmissionAccess,
  commercialMissionProofReviewStatus,
  commercialMissionProofStorageKey,
  commercialMissionProofSubmissionPlan,
  manualCommercialMissionProofVerifier,
  validateCommercialMissionProofUpload,
} from "./commercialMissionProofService";

const serviceSource = readFileSync(
  new URL("./commercialMissionProofService.ts", import.meta.url),
  "utf8"
);

const mission = {
  id: 41,
  tenantId: "tenant-a",
  assignedTo: "field-user-a",
};

const step = {
  id: 73,
  tenantId: "tenant-a",
  missionId: 41,
  position: 2,
  status: "active" as const,
};

describe("commercial mission proof authorization", () => {
  it("allows only the exact assignee to submit to the exact tenant mission step", () => {
    expect(() =>
      assertCommercialMissionProofSubmissionAccess({
        tenantId: "tenant-a",
        missionId: 41,
        missionStepId: 73,
        actorId: "field-user-a",
        mission,
        step,
      })
    ).not.toThrow();

    expect(() =>
      assertCommercialMissionProofSubmissionAccess({
        tenantId: "tenant-a",
        missionId: 41,
        missionStepId: 73,
        actorId: "field-user-b",
        mission,
        step,
      })
    ).toThrow(/assigned field user/);
  });

  it.each([
    {
      label: "mission tenant",
      changedMission: { ...mission, tenantId: "tenant-b" },
      changedStep: step,
    },
    {
      label: "step tenant",
      changedMission: mission,
      changedStep: { ...step, tenantId: "tenant-b" },
    },
    {
      label: "step mission",
      changedMission: mission,
      changedStep: { ...step, missionId: 999 },
    },
    {
      label: "step identity",
      changedMission: mission,
      changedStep: { ...step, id: 999 },
    },
  ])(
    "rejects a mismatched $label without crossing tenant boundaries",
    ({ changedMission, changedStep }) => {
      expect(() =>
        assertCommercialMissionProofSubmissionAccess({
          tenantId: "tenant-a",
          missionId: 41,
          missionStepId: 73,
          actorId: "field-user-a",
          mission: changedMission,
          step: changedStep,
        })
      ).toThrow(/context not found/);
    }
  );

  it("blocks proof for locked, completed, and skipped steps", () => {
    for (const status of ["locked", "completed", "skipped"] as const) {
      expect(() =>
        assertCommercialMissionProofSubmissionAccess({
          tenantId: "tenant-a",
          missionId: 41,
          missionStepId: 73,
          actorId: "field-user-a",
          mission,
          step: { ...step, status },
        })
      ).toThrow(new RegExp(`cannot accept proof from ${status}`));
    }
  });

  it("lets owners and admins read tenant proof while keeping other roles assignment-scoped", () => {
    for (const actorRole of ["owner", "admin"] as const) {
      expect(() =>
        assertCommercialMissionProofReadAccess({
          tenantId: "tenant-a",
          actorId: `${actorRole}-user`,
          actorRole,
          mission,
        })
      ).not.toThrow();
    }
    expect(() =>
      assertCommercialMissionProofReadAccess({
        tenantId: "tenant-a",
        actorId: "different-field-user",
        actorRole: "field",
        mission,
      })
    ).toThrow(/not available/);
    expect(() =>
      assertCommercialMissionProofReadAccess({
        tenantId: "tenant-a",
        actorId: "owner-user",
        actorRole: "owner",
        mission: { ...mission, tenantId: "tenant-b" },
      })
    ).toThrow(/context not found/);
  });

  it("restricts review and override to an owner/admin in the same tenant", () => {
    for (const actorRole of ["owner", "admin"] as const) {
      expect(() =>
        assertCommercialMissionProofReviewAccess({
          tenantId: "tenant-a",
          actorRole,
          proofTenantId: "tenant-a",
        })
      ).not.toThrow();
    }
    for (const actorRole of ["operator", "field"] as const) {
      expect(() =>
        assertCommercialMissionProofReviewAccess({
          tenantId: "tenant-a",
          actorRole,
          proofTenantId: "tenant-a",
        })
      ).toThrow(/owner or admin/);
    }
    expect(() =>
      assertCommercialMissionProofReviewAccess({
        tenantId: "tenant-a",
        actorRole: "owner",
        proofTenantId: "tenant-b",
      })
    ).toThrow(/not found/);
  });
});

describe("commercial mission proof upload policy", () => {
  it("hashes allowed binary images and rejects empty, oversized, or non-image uploads", () => {
    const jpeg = validateCommercialMissionProofUpload({
      data: new Uint8Array([0xff, 0xd8, 0xff, 0xdb]),
      mimeType: " IMAGE/JPEG ",
    });
    expect(jpeg).toMatchObject({
      mimeType: "image/jpeg",
      sizeBytes: 4,
    });
    expect(jpeg.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(() =>
      validateCommercialMissionProofUpload({
        data: new Uint8Array(),
        mimeType: "image/jpeg",
      })
    ).toThrow(/empty/);
    expect(() =>
      validateCommercialMissionProofUpload({
        data: new Uint8Array(COMMERCIAL_MISSION_PROOF_MAX_BYTES + 1),
        mimeType: "image/jpeg",
      })
    ).toThrow(/exceeds/);
    expect(() =>
      validateCommercialMissionProofUpload({
        data: new Uint8Array([1]),
        mimeType: "text/html",
      })
    ).toThrow(/Unsupported proof MIME/);
    expect(() =>
      validateCommercialMissionProofUpload({
        data: new TextEncoder().encode("<script>alert(1)</script>"),
        mimeType: "image/jpeg",
      })
    ).toThrow(/bytes do not match/);
  });

  it("rejects a browser data URL instead of treating local preview state as proof", () => {
    expect(() =>
      validateCommercialMissionProofUpload({
        data: "data:image/jpeg;base64,/9j/" as unknown as Uint8Array,
        mimeType: "image/jpeg",
      })
    ).toThrow(/binary data/);
  });

  it("builds a private relative storage key without exposing the tenant identifier", () => {
    const key = commercialMissionProofStorageKey({
      tenantId: "private-tenant-name",
      missionId: 41,
      missionStepId: 73,
      proofId: "f6f1ba6d-14b6-4baf-9cf7-f9de3526bcaf",
      contentHash:
        "d2a4f1182c674ce3a5b95b72aefb99be107740690c06c2fd7cff60794de1cc74",
      mimeType: "image/webp",
    });
    expect(key).toMatch(
      /^dayforge-evidence\/[0-9a-f]{24}\/41\/73\/[0-9a-f-]+-[0-9a-f]{16}\.webp$/
    );
    expect(key).not.toContain("private-tenant-name");
    expect(key).not.toMatch(/^(?:data|blob|https?|file):/);
  });
});

describe("commercial mission proof review and retry policy", () => {
  it("starts at attempt one and permits a linked retry only after rejection", () => {
    expect(commercialMissionProofSubmissionPlan({ latestProof: null })).toEqual(
      { attemptNumber: 1, previousProofId: null }
    );
    expect(
      commercialMissionProofSubmissionPlan({
        latestProof: {
          id: "proof-1",
          attemptNumber: 1,
          reviewStatus: "rejected",
        },
      })
    ).toEqual({ attemptNumber: 2, previousProofId: "proof-1" });
    for (const reviewStatus of [
      "pending",
      "approved",
      "overridden",
      "superseded",
    ] as const) {
      expect(() =>
        commercialMissionProofSubmissionPlan({
          latestProof: { id: "proof-1", attemptNumber: 1, reviewStatus },
        })
      ).toThrow(new RegExp(`latest attempt is ${reviewStatus}`));
    }
  });

  it("allows normal decisions only from pending and override only from rejected", () => {
    expect(
      commercialMissionProofReviewStatus({
        currentStatus: "pending",
        decision: "approve",
      })
    ).toBe("approved");
    expect(
      commercialMissionProofReviewStatus({
        currentStatus: "pending",
        decision: "reject",
      })
    ).toBe("rejected");
    expect(
      commercialMissionProofReviewStatus({
        currentStatus: "rejected",
        decision: "override",
      })
    ).toBe("overridden");
    expect(() =>
      commercialMissionProofReviewStatus({
        currentStatus: "pending",
        decision: "override",
      })
    ).toThrow(/Only rejected proof/);
    expect(() =>
      commercialMissionProofReviewStatus({
        currentStatus: "approved",
        decision: "reject",
      })
    ).toThrow(/not reviewable/);
  });

  it("ships a manual verifier without pretending to judge the photo", async () => {
    await expect(
      manualCommercialMissionProofVerifier.evaluate({
        proofId: "proof-1",
        mimeType: "image/jpeg",
        sizeBytes: 4,
      })
    ).resolves.toEqual({ verdict: "manual_review_required" });
  });
});

describe("commercial mission proof persistence contract", () => {
  it("uses private server storage and never makes local browser state authoritative", () => {
    expect(serviceSource).toContain("storagePut(storageKey, upload.data");
    expect(serviceSource).toContain("storageGet(proof.storageKey)");
    expect(serviceSource).not.toContain("localStorage");
    expect(serviceSource).not.toContain("previewDataUrl");
  });

  it("tenant-scopes reads and writes, serializes on the step, and binds request IDs", () => {
    expect(serviceSource).toContain(
      "eq(dayforgeEvidenceUploads.tenantId, input.tenantId)"
    );
    expect(serviceSource).toContain(
      "eq(commercialMissionSteps.tenantId, input.tenantId)"
    );
    expect(serviceSource).toContain('.for("update")');
    expect(serviceSource).toContain("assertSubmissionRequestBinding");
    expect(serviceSource).toContain("onDuplicateKeyUpdate");
  });

  it("keeps rejected attempts and review changes in the durable audit timeline", () => {
    expect(serviceSource).toContain("writeDayforgeEventWith(tx");
    expect(serviceSource).toContain('eventName: "proof_superseded"');
    expect(serviceSource).toContain('return "proof_overridden"');
    expect(serviceSource).toContain("before: proofAuditSnapshot(proof)");
    expect(serviceSource).toContain("unlockedStepId");
  });
});
