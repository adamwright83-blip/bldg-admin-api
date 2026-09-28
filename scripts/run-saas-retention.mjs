/* LEGACY DAYFORGE COMPATIBILITY: retained historical route/env literals only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */

const enabled = process.env.JOYSTICK_RETENTION_ENABLED === "1";
if (!enabled) {
  console.log("JOYSTICK retention scheduler is disabled; set JOYSTICK_RETENTION_ENABLED=1 after configuring secrets.");
  process.exit(0);
}

const baseUrl = process.env.JOYSTICK_RETENTION_URL?.replace(/\/$/, "");
const secret = process.env.JOYSTICK_RETENTION_SECRET;
if (!baseUrl || !secret) {
  throw new Error(
    "JOYSTICK retention is enabled but JOYSTICK_RETENTION_URL / JOYSTICK_RETENTION_SECRET are not configured"
  );
}

const batchLimitRaw = Number(process.env.JOYSTICK_RETENTION_BATCH_LIMIT ?? "250");
const batchLimit = Number.isInteger(batchLimitRaw)
  ? Math.min(1000, Math.max(1, batchLimitRaw))
  : 250;
const dryRun = process.env.JOYSTICK_RETENTION_DRY_RUN === "1";

const response = await fetch(
  `${baseUrl}/api/internal/dayforge/retention/run`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ dryRun, batchLimit }),
  }
);

const body = await response.text();
if (!response.ok) {
  throw new Error(
    `Retention request failed (${response.status}): ${body.slice(0, 1000)}`
  );
}

let parsed;
try {
  parsed = JSON.parse(body);
} catch {
  throw new Error("Retention endpoint returned non-JSON success response");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      dryRun: parsed.dryRun,
      batchLimit: parsed.batchLimit,
      totalEligible: parsed.totalEligible,
      resources: Array.isArray(parsed.resources)
        ? parsed.resources.map(resource => ({
            resource: resource.resource,
            eligible: resource.eligible,
            purged: resource.purged,
          }))
        : [],
      policyVersion: parsed.policyVersion,
    },
    null,
    2
  )
);
