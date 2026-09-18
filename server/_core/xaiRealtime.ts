/**
 * xAI realtime foundation -- connectivity + Zero Data Retention (ZDR)
 * verification ONLY. This module does not implement Grok/Claire voice
 * integration; it exists to prove that:
 *   1. The XAI_API_KEY credential authenticates against the xAI realtime
 *      WebSocket endpoint, and
 *   2. The connection is only ever treated as usable when the server's
 *      handshake response proves Zero Data Retention is active.
 *
 * Nothing beyond the WebSocket upgrade/handshake happens here: no audio,
 * no Claire instructions, no business or customer content is ever sent on
 * a connection opened by this module.
 *
 * Hard privacy invariant: ZDR must be verified BEFORE any other traffic on
 * the connection. If it cannot be verified as exactly `true`, the
 * connection is closed immediately and the caller only ever sees the
 * sanitized error identifier `XAI_ZDR_NOT_VERIFIED` -- never headers, the
 * API key, or any other credential/secret material.
 */
import WebSocket from "ws";
import { ENV } from "./env";

export const XAI_REALTIME_BASE_URL = "wss://api.x.ai/v1/realtime";

export const XAI_ZDR_HEADER = "x-zero-data-retention";

/** Sanitized error identifier -- safe to log, print, or return to a caller. */
export const XAI_ZDR_NOT_VERIFIED = "XAI_ZDR_NOT_VERIFIED";

export const XAI_API_KEY_MISSING = "XAI_API_KEY_MISSING";

export class XaiRealtimeError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "XaiRealtimeError";
  }
}

function buildRealtimeUrl(model: string): string {
  return `${XAI_REALTIME_BASE_URL}?model=${encodeURIComponent(model)}`;
}

/**
 * Reads the ZDR header off a handshake response and decides whether the
 * connection may be used. Accepts either the literal string "true" or the
 * boolean value `true` in case an intermediary normalizes header values --
 * anything else (missing, "false", other strings) fails closed.
 */
export function isZdrVerified(headerValue: string | string[] | boolean | undefined): boolean {
  if (headerValue === true) return true;
  if (typeof headerValue === "string") return headerValue.trim().toLowerCase() === "true";
  if (Array.isArray(headerValue)) return headerValue.some((v) => v.trim().toLowerCase() === "true");
  return false;
}

export type XaiRealtimeConnectResult = {
  /** The model that was requested in the connection URL. */
  requestedModel: string;
  /** Always true when this resolves -- ZDR was verified before any other use. */
  zdrVerified: true;
};

/**
 * Opens an authenticated xAI realtime WebSocket connection SOLELY to
 * verify credentials and ZDR, then immediately closes it. Resolves only if
 * the handshake succeeds AND `x-zero-data-retention` is verified true.
 * Otherwise rejects with an XaiRealtimeError whose `code` is a sanitized
 * identifier -- never the raw error, headers, or key material.
 */
export function verifyXaiRealtimeConnection(
  options: { apiKey?: string; model?: string } = {}
): Promise<XaiRealtimeConnectResult> {
  const apiKey = options.apiKey ?? ENV.xaiApiKey;
  const model = options.model ?? ENV.xaiVoiceModel;

  if (!apiKey) {
    return Promise.reject(new XaiRealtimeError(XAI_API_KEY_MISSING));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    let socket: WebSocket;
    try {
      socket = new WebSocket(buildRealtimeUrl(model), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
    } catch {
      // Never surface the thrown error -- it could echo the URL/auth header.
      settle(() => reject(new XaiRealtimeError(XAI_ZDR_NOT_VERIFIED)));
      return;
    }

    socket.on("unexpected-response", (_req, res) => {
      settle(() => {
        try {
          socket.terminate();
        } catch {
          // ignore
        }
        reject(new XaiRealtimeError(XAI_ZDR_NOT_VERIFIED));
      });
      void res;
    });

    socket.on("upgrade", (res) => {
      const zdrHeader = res.headers[XAI_ZDR_HEADER];
      const verified = isZdrVerified(zdrHeader as string | string[] | undefined);

      if (!verified) {
        settle(() => {
          try {
            socket.close();
            socket.terminate();
          } catch {
            // ignore
          }
          reject(new XaiRealtimeError(XAI_ZDR_NOT_VERIFIED));
        });
        return;
      }

      // ZDR verified. Foundation scope: prove connectivity + privacy only --
      // do not send anything else. Close immediately.
      settle(() => {
        try {
          socket.close();
        } catch {
          // ignore
        }
        resolve({ requestedModel: model, zdrVerified: true });
      });
    });

    socket.on("error", () => {
      // Never propagate the raw error object -- may contain the request URL
      // (which does not include the key, but stay conservative) or other
      // connection internals.
      settle(() => reject(new XaiRealtimeError(XAI_ZDR_NOT_VERIFIED)));
    });

    socket.on("close", () => {
      settle(() => reject(new XaiRealtimeError(XAI_ZDR_NOT_VERIFIED)));
    });
  });
}
