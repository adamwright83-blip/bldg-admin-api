/* LEGACY DAYFORGE COMPATIBILITY: retained historical route/env literals only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */

import { pathToFileURL } from "node:url";

/**
 * Fail closed. A live delete is sent only for a manual workflow_dispatch that
 * sets JOYSTICK_RETENTION_DRY_RUN=0 and JOYSTICK_RETENTION_CONFIRM_DELETE=1.
 * Scheduled runs, missing flags, and unconfirmed delete requests do not delete.
 */
export function resolveRetentionMode(env) {
  const flag = env.JOYSTICK_RETENTION_DRY_RUN;
  const confirm = env.JOYSTICK_RETENTION_CONFIRM_DELETE === "1";
  const dispatched = env.GITHUB_EVENT_NAME === "workflow_dispatch";
  if (flag === "0") {
    if (confirm && dispatched) return { action: "delete" };
    return {
      action: "refuse",
      reason:
        "Retention live delete refused. A delete requires a manual workflow_dispatch with dry_run=false and confirm_delete=true. No request was sent.",
    };
  }
  return { action: "dry_run" };
}

export async function runRetention(env = process.env, fetchImpl = globalThis.fetch) {
  const enabled = env.JOYSTICK_RETENTION_ENABLED === "1";
  if (!enabled) {
    console.log("JOYSTICK retention scheduler is disabled; set JOYSTICK_RETENTION_ENABLED=1 after configuring secrets.");
    return 0;
  }

  const mode = resolveRetentionMode(env);
  if (mode.action === "refuse") {
    console.error(mode.reason);
    return 1;
  }

  const baseUrl = env.JOYSTICK_RETENTION_URL?.replace(/\/$/, "");
  const secret = env.JOYSTICK_RETENTION_SECRET;
  if (!baseUrl || !secret) {
    throw new Error(
      "JOYSTICK retention is enabled but JOYSTICK_RETENTION_URL / JOYSTICK_RETENTION_SECRET are not configured"
    );
  }

  const batchLimitRaw = Number(env.JOYSTICK_RETENTION_BATCH_LIMIT ?? "250");
  const batchLimit = Number.isInteger(batchLimitRaw)
    ? Math.min(1000, Math.max(1, batchLimitRaw))
    : 250;
  const dryRun = mode.action !== "delete";

  const response = await fetchImpl(
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
  return 0;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runRetention().then(
    code => process.exit(code),
    error => {
      console.error(error instanceof Error ? error.message : "Retention run failed");
      process.exit(1);
    }
  );
}
