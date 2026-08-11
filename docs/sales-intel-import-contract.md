# Sales Intel import contract

How a sourced trainer corpus is handed to the system. Researchers never touch
the database: they produce JSON in this shape, it is validated at the boundary,
and the pipeline persists it with full provenance.

Endpoint: `system.salesIntel.importCorpus` (tRPC mutation, **admin role only**).
Schema of record: `salesIntelImportSchema` in [`shared/salesIntel.ts`](../shared/salesIntel.ts).

One payload describes **one source** and every framework extracted from it.

## Payload

```jsonc
{
  "creator": {
    "name": "Trainer Name",          // required
    "handle": "@handle"              // optional
  },
  "source": {
    "type": "youtube",               // manual_url | instagram | youtube | podcast
                                     // | uploaded_transcript | test_fixture | other
    "url": "https://www.youtube.com/watch?v=VIDEOID",  // optional
    "externalId": "VIDEOID",         // optional, but strongly preferred
    "publishedAt": "2026-02-01T00:00:00.000Z",         // optional, ISO 8601
    "title": "Handling the incumbent objection"        // optional
  },
  "transcript": {                    // optional; omit if not yet available
    "text": "full transcript text",
    "contentKind": "supplied_transcript",  // or caption_only / audio_transcription
                                           // / video_understanding
    "provider": null,
    "model": null,
    "segments": [
      { "startMs": 0, "endMs": 4200, "text": "..." }
    ]
  },
  "frameworks": [
    {
      "archetype": "ANCHOR",         // ANCHOR | GATEKEEPER | GHOST | STALLER
      "channel": "phone",            // phone | in_person | follow_up | proposal
      "exactObjection": "We already have a company",
      "diagnosis": "Incumbent inertia, not price",
      "frameworkName": "Price vs Cost",
      "principle": "Reframe the comparison from rate to total cost",
      "responseFamily": "reframe_cost",
      "discoveryQuestions": ["What does a missed pickup cost you?"],
      "exampleLanguage": [
        { "kind": "exact_source_phrase", "text": "verbatim words from the source" },
        { "kind": "paraphrased_principle", "text": "restated idea" }
      ],
      "whenToUse": ["Incumbent is entrenched but the contract is ending"],
      "whenNotToUse": ["They have already signed for another term"],
      "followUpMoves": ["Ask for the renewal date"],
      "badResponses": ["Attacking the incumbent directly"],
      "confidence": 0.86,            // 0..1, your certainty this is genuinely taught
      "transcriptStartMs": 61000,    // optional grounding
      "transcriptEndMs": 88000
    }
  ]
}
```

## Rules the validator enforces

- **A source must be identifiable.** Supply `source.url`, `source.externalId`,
  or a `transcript`. A payload with none of the three is rejected.
- **`transcriptEndMs` may not precede `transcriptStartMs`.**
- Field lengths and array sizes are bounded (see the schema); overlong values
  are rejected rather than silently truncated.
- `exampleLanguage` entries may be given as bare strings. A bare string is
  recorded as `paraphrased_principle` — **a paraphrase is never promoted into a
  quote.** Mark something `exact_source_phrase` only when those words genuinely
  appear in the source.

## Rules the pipeline enforces

- **Contradiction is preserved.** Two trainers who disagree produce two
  frameworks. Nothing is averaged into a "balanced best practice".
- **Identity, not formatting, defines a source.** YouTube `watch?v=`,
  `youtu.be/`, and `/shorts/` forms for one video collapse onto one artifact;
  Instagram `/reel/`, `/reels/`, `/p/`, and `/tv/` forms likewise. Re-importing
  the same source updates it rather than duplicating the corpus.
- **Re-import supersedes, it never destroys.** A framework re-imported with the
  same identity becomes version N+1; version N is marked inactive with a
  `supersededAt` stamp and remains queryable as provenance.
- **Acceptance is part of the pipeline.** Human-curated imports are accepted on
  arrival, so they are immediately eligible in the game. There is **no separate
  publish or send-to-driver step**.
- **Fixtures can never pose as real material.** Anything with
  `source.type: "test_fixture"` is held at `review_required` regardless of
  confidence and is excluded from driver-visible queries.

## What reaches the driver

A framework is offered to the game only when **all** of these hold:

| Condition | Requirement |
|---|---|
| Source status | `extracted` |
| Framework review state | `accepted` |
| Framework version | `active` |
| Archetype / channel | matches the encounter context |
| Source type | not `test_fixture` |

So a source that is `awaiting_content`, `processing`, or `failed` — and any
framework that is `review_required` or `rejected` — is never a driver weapon.

## Provenance retained

Every driver-visible trainer weapon can answer: who taught it, from which
source artifact and URL, from which transcript version and range, under which
extraction version, model, and prompt version, and at what confidence and
review state.

Personal evidence — how often *this* player used a weapon and what was observed
afterwards — is stored separately, scoped to tenant and actor, and is never
merged into the trainer's teaching.
