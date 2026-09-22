/**
 * Anonymous Conversation Relay upgrade probe.
 * Sends no Twilio signature and no Claire token unless
 * CLAIRE_RELAY_PROBE_MODE=authenticated and both values are already in the
 * environment. Never prompts. Never prints those values or a query string.
 */
import tls from "node:tls";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const GOLDLINE_RELAY_UPGRADE_REJECTED = "goldline-relay-upgrade-rejected";
export const RELAY_PROBE_PATH = "/api/claire/twilio/conversation-relay";

const BODY_CAP = 256;

export function classifyUpgradeProbe({ status, contentType, markerHeader, body, authenticated }) {
  const marker = GOLDLINE_RELAY_UPGRADE_REJECTED;
  const headerHit = typeof markerHeader === "string" && markerHeader.trim() === marker;
  const bodyHit = typeof body === "string" && body.trim() === marker;
  const html = /text\/html/i.test(contentType ?? "") || /^\s*</.test(body ?? "");

  if (status === 403 && (headerHit || bodyHit)) {
    return {
      classification: "UPGRADE PATH REACHES APPLICATION",
      detail: "Goldline 403 marker",
    };
  }
  if (status === 200 && html) {
    return {
      classification: "REQUEST DID NOT HIT THE UPGRADE HANDLER",
      detail: "old code or proxy downgraded",
    };
  }
  if (status === 400 && !headerHit && !bodyHit) {
    return {
      classification: "UPGRADE REJECTED BEFORE OUR HANDLER",
      detail: "edge-generated 400",
    };
  }
  if (status === 101) {
    if (authenticated) {
      return {
        classification: "AUTHENTICATED UPGRADE",
        detail: "101 only in explicit authenticated probe mode",
      };
    }
    return {
      classification: "UNEXPECTED ANONYMOUS 101",
      detail: "anonymous probe does not treat 101 as proof",
    };
  }
  if (status === 403) {
    return {
      classification: "403 WITHOUT GOLDLINE MARKER",
      detail: "not the Goldline upgrade handler",
    };
  }
  if (status === 200) {
    return {
      classification: "REQUEST DID NOT HIT THE UPGRADE HANDLER",
      detail: "non-upgrade HTTP response",
    };
  }
  return {
    classification: "UNCLASSIFIED",
    detail: status == null ? "no status" : `status ${status}`,
  };
}

export function authenticatedProbePlan(env = process.env) {
  if (env.CLAIRE_RELAY_PROBE_MODE !== "authenticated") {
    return { mode: "anonymous", send: true, token: "", signature: "" };
  }
  const token = typeof env.CLAIRE_RELAY_PROBE_TOKEN === "string" ? env.CLAIRE_RELAY_PROBE_TOKEN.trim() : "";
  const signature =
    typeof env.CLAIRE_RELAY_PROBE_SIGNATURE === "string" ? env.CLAIRE_RELAY_PROBE_SIGNATURE.trim() : "";
  if (!token || !signature) {
    return {
      mode: "authenticated",
      send: false,
      token: "",
      signature: "",
      reason:
        "authenticated probe not sent; CLAIRE_RELAY_PROBE_TOKEN and CLAIRE_RELAY_PROBE_SIGNATURE must already be set",
    };
  }
  return { mode: "authenticated", send: true, token, signature };
}

export function publicProbeLine(record) {
  return {
    host: record.host ?? null,
    path: RELAY_PROBE_PATH,
    mode: record.mode ?? "anonymous",
    status: record.status ?? null,
    contentType: record.contentType ?? null,
    server: record.server ?? null,
    marker: record.marker === true,
    classification: record.classification ?? "UNCLASSIFIED",
    detail: record.detail ?? null,
  };
}

export function parseUpgradeProbeResponse(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer));
  const split = data.indexOf("\r\n\r\n");
  const headerText = (split === -1 ? data : data.subarray(0, split)).toString("utf8");
  const bodySample = split === -1 ? "" : data.subarray(split + 4, split + 4 + BODY_CAP).toString("utf8");
  const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d+)/.exec(headerText);
  const status = statusMatch ? Number(statusMatch[1]) : null;
  return {
    status,
    contentType: headerValue(headerText, "content-type"),
    markerHeader: headerValue(headerText, "x-goldline-relay-upgrade"),
    server: headerValue(headerText, "server"),
    bodySample,
  };
}

export function upgradeProbeBodyLimit(headerText, status) {
  if (status === 101) return 0;
  const match = /content-length:\s*(\d+)/i.exec(headerText);
  if (!match) return BODY_CAP;
  return Math.min(Number(match[1]), BODY_CAP);
}

function headerValue(headerText, name) {
  const prefix = `${name.toLowerCase()}:`;
  for (const line of headerText.split("\r\n")) {
    if (line.toLowerCase().startsWith(prefix)) return line.slice(line.indexOf(":") + 1).trim();
  }
  return null;
}

function defaultHosts(env) {
  return [env.CLAIRE_PUBLIC_HOST || "admin.bldg.chat", env.CLAIRE_RAILWAY_HOST || "bldg-admin-api-production.up.railway.app"];
}

async function probeHost(host, plan) {
  const socket = await connectTls(host);
  const query = plan.mode === "authenticated" ? `?token=${encodeURIComponent(plan.token)}` : "";
  const signatureHeader =
    plan.mode === "authenticated" ? `X-Twilio-Signature: ${plan.signature}\r\n` : "";
  socket.write(
    `GET ${RELAY_PROBE_PATH}${query} HTTP/1.1\r\n` +
      `Host: ${host}\r\n` +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      signatureHeader +
      "\r\n"
  );
  try {
    return await readLimitedResponse(socket);
  } finally {
    socket.destroy();
  }
}

function connectTls(host) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host }, () => resolve(socket));
    socket.setTimeout(12_000, () => {
      socket.destroy();
      reject(new Error("timeout"));
    });
    socket.on("error", reject);
  });
}

function readLimitedResponse(socket) {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => finish(), 12_000);
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(parseUpgradeProbeResponse(data));
    }
    socket.on("data", chunk => {
      data = Buffer.concat([data, chunk]);
      const split = data.indexOf("\r\n\r\n");
      if (split === -1) {
        if (data.length > 8192) finish();
        return;
      }
      const headerText = data.subarray(0, split).toString("utf8");
      const status = Number(/^HTTP\/\d(?:\.\d)?\s+(\d+)/.exec(headerText)?.[1] ?? NaN);
      const limit = upgradeProbeBodyLimit(headerText, status);
      if (data.length >= split + 4 + limit) finish();
    });
    socket.on("end", finish);
    socket.on("error", error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  const plan = authenticatedProbePlan(process.env);
  if (!plan.send) {
    console.log(
      JSON.stringify(
        publicProbeLine({
          mode: plan.mode,
          classification: "AUTHENTICATED PROBE NOT SENT",
          detail: plan.reason,
          marker: false,
          status: null,
        })
      )
    );
    return;
  }
  for (const host of defaultHosts(process.env)) {
    try {
      const observed = await probeHost(host, plan);
      const classified = classifyUpgradeProbe({
        status: observed.status,
        contentType: observed.contentType,
        markerHeader: observed.markerHeader,
        body: observed.bodySample,
        authenticated: plan.mode === "authenticated",
      });
      const marker =
        observed.markerHeader === GOLDLINE_RELAY_UPGRADE_REJECTED ||
        observed.bodySample.trim() === GOLDLINE_RELAY_UPGRADE_REJECTED;
      console.log(
        JSON.stringify(
          publicProbeLine({
            host,
            mode: plan.mode,
            status: observed.status,
            contentType: observed.contentType,
            server: observed.server,
            marker,
            classification: classified.classification,
            detail: classified.detail,
          })
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "probe failed";
      console.log(
        JSON.stringify(
          publicProbeLine({
            host,
            mode: plan.mode,
            classification: "PROBE ERROR",
            detail: message.slice(0, 160),
            marker: false,
            status: null,
          })
        )
      );
    }
  }
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedDirectly()) {
  await main();
}
