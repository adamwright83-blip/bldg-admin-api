# Goldline Instagram Sales Intel capture

## Product path

Installed Goldline on Android is registered as a Web Share Target. A public Instagram Reel can enter the system either by:

1. Instagram → Share → Goldline, or
2. Driver → `+ CAPTURE INTEL` → paste Reel URL.

The phone path is intentionally capture-first:

`Reel URL → durable source artifact → background media resolution → Gemini media understanding → persisted transcript/analysis → generalized Sales Intel teaching extraction → review_required`

The HTTP response returns after the source artifact is saved. Processing failure never deletes the source; sharing the same Reel again or tapping retry resumes the same logical artifact because Instagram shortcode identity is stable.

## Authorization boundary

The existing `system.salesIntel` router remains admin-only.

Drivers receive only `system.salesIntelCapture`:

- `captureInstagram`
- `status`
- `retry`

There is no driver endpoint to list sources, review/accept/reject teachings, import a corpus, or mutate accepted Sales Intel.

## Media resolver

The repository does not call arbitrary public Cobalt instances. Automatic Reel media acquisition is opt-in through a configured, controlled Cobalt instance.

Environment:

- `COBALT_API_URL` — base URL of the controlled Cobalt API. Required for automatic media acquisition.
- `COBALT_API_KEY` — optional API-key auth for that instance.

The resolver requests `alwaysProxy: true` and accepts only tunnel/picker media URLs whose origin is the configured Cobalt origin. Direct third-party redirects are rejected rather than becoming arbitrary server-side fetch targets.

If `COBALT_API_URL` is absent, the Reel is still saved truthfully as `awaiting_content`; no transcript is invented.

## Gemini media understanding

After media resolution, the server downloads the short-form media under a bounded size/time budget and uploads it to the Gemini Files API. The temporary Gemini file is analyzed with the configured video model and then best-effort deleted.

Existing Gemini environment is reused:

- `GEMINI_API_KEY`
- `GEMINI_VIDEO_MODEL`
- `GEMINI_VIDEO_TIMEOUT_MS`

Optional:

- `INSTAGRAM_MEDIA_MAX_BYTES` — downloaded-media cap; defaults to 100 MiB and is hard-capped at 200 MiB.

A malformed `GEMINI_VIDEO_MODEL` is rejected before a network request.

## Human review

Generalized trainer teachings and any derived objection-framework mappings are persisted as `review_required`, regardless of model confidence. Confidence remains evidence; it is not permission to publish trainer doctrine into the driver-visible corpus.

## Deployment / production prerequisites

This feature adds no new database migration. It depends on migration `0056_sales_intel_teachings.sql` from PR #46 being present before generalized teaching persistence runs.

The share-target manifest change may require an installed Android PWA to refresh/reinstall before Goldline appears in the system share sheet, depending on browser/OS manifest refresh behavior.

Before merge/deploy, run the focused tests, TypeScript baseline comparison, full Vitest suite, build, Goldline bundle budget, and secret scan. Automatic media end-to-end production proof additionally requires a configured controlled Cobalt instance.
