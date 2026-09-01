/**
 * Closure / performance capture may only talk to a disposable local proof
 * server. A mis-set GOLDLINE_PROOF_URL must fail closed rather than write a
 * Field Journal into a real deployment.
 */
export function assertLocalProofUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid GOLDLINE_PROOF_URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Refusing non-http Goldline proof target: ${url.protocol}`);
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(
      `Refusing to run a Goldline proof capture against a non-local host (${url.hostname}). Disposable proof servers only.`
    );
  }
}
