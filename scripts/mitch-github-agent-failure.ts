import { randomUUID } from "node:crypto";

type Wake = {
  wakeId: string;
  actorId: string;
  kind: string;
  tenantId: string;
  gameId: string;
  milestoneId: string;
  workOrderId: string;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required");
  return value;
}

async function githubOidc(): Promise<string> {
  const rawUrl = required("ACTIONS_ID_TOKEN_REQUEST_URL");
  const requestToken = required("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
  const url = new URL(rawUrl);
  url.searchParams.set("audience", "joystick-mitch-agent");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${requestToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`OIDC token request failed (${response.status})`);
  const body = (await response.json()) as { value?: string };
  if (!body.value) throw new Error("OIDC response contained no token");
  return body.value;
}

async function main(): Promise<void> {
  const wake = JSON.parse(required("MITCH_WAKE")) as Wake;
  if (
    wake.actorId !== "github-producer-bus:claude" ||
    !wake.tenantId ||
    !wake.gameId ||
    !wake.milestoneId ||
    !wake.workOrderId
  ) {
    throw new Error("Invalid Mitch executor wake identity");
  }

  const token = await githubOidc();
  const base = required("MITCH_PRODUCER_BASE_URL").replace(/\/$/, "");
  const response = await fetch(base + "/api/mitch/autonomous/event", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      eventId: randomUUID(),
      type: "agent_failed",
      tenantId: wake.tenantId,
      gameId: wake.gameId,
      milestoneId: wake.milestoneId,
      workOrderId: wake.workOrderId,
      actorId: "github-producer-bus:claude",
      error:
        process.env.MITCH_EXECUTOR_FAILURE_MESSAGE?.trim() ||
        "GitHub Actions executor step failed before a structured implementation handback.",
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (response.ok) return;
  const body = await response.text();
  // If the primary agent already returned agent_failed, the lease is no longer
  // valid. That means the control plane already recovered the attempt.
  if (
    response.status === 422 &&
    /Invalid or expired executor lease|Work order is not executing/i.test(body)
  ) {
    return;
  }
  throw new Error(
    `Mitch failure callback failed (${response.status}): ${body.slice(0, 800)}`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
