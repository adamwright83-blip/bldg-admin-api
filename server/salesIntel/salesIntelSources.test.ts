import { describe, expect, it } from "vitest";
import {
  canonicalizeInstagramUrl,
  canonicalizeYouTubeUrl,
  classifySalesIntelInput,
  reviewStateForExtraction,
  salesIntelImportSchema,
  isDriverVisibleReviewState,
} from "../../shared/salesIntel";
import { salesIntelContentHash } from "./salesIntelIdentity";
import {
  createSalesIntelAdapterRegistry,
  InstagramSourceAdapter,
  SuppliedTranscriptAdapter,
  YouTubeSourceAdapter,
} from "./sourceAdapters";
import {
  UnconfiguredVideoUnderstandingProvider,
  VideoUnderstandingFailedError,
  type VideoUnderstandingProvider,
} from "./videoUnderstanding";

const noMetadata = async () => null;

function stubVideoProvider(text: string): VideoUnderstandingProvider {
  return {
    key: "stub",
    configured: true,
    async analyze() {
      return {
        text,
        segments: [{ startMs: 0, endMs: 4_000, text }],
        provider: "stub",
        model: "stub-video-1",
        analysisVersion: "stub-v1",
      };
    },
  };
}

describe("YouTube URL canonicalization", () => {
  it("resolves every common URL form to one identity", () => {
    const forms = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    ];
    for (const form of forms) {
      const identity = canonicalizeYouTubeUrl(form);
      expect(identity?.externalContentId).toBe("dQw4w9WgXcQ");
      expect(identity?.canonicalUrl).toBe(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      );
    }
  });

  it("gives URL variants of one video the same content hash", () => {
    const hashes = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    ].map(form => {
      const identity = canonicalizeYouTubeUrl(form)!;
      return salesIntelContentHash({
        sourceType: "youtube",
        canonicalUrl: identity.canonicalUrl,
        externalContentId: identity.externalContentId,
      });
    });
    expect(new Set(hashes).size).toBe(1);
  });

  it("refuses to invent an identity for a malformed video reference", () => {
    expect(canonicalizeYouTubeUrl("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(canonicalizeYouTubeUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(canonicalizeYouTubeUrl("not a url")).toBeNull();
  });
});

describe("Instagram URL canonicalization", () => {
  it("collapses Reel URL variants to one identity", () => {
    const forms = [
      "https://www.instagram.com/reel/Cx1y2Z3aBcD/",
      "https://instagram.com/reels/Cx1y2Z3aBcD",
      "https://www.instagram.com/somecreator/reel/Cx1y2Z3aBcD/?igsh=abc",
    ];
    for (const form of forms) {
      expect(canonicalizeInstagramUrl(form)?.externalContentId).toBe(
        "Cx1y2Z3aBcD"
      );
    }
  });

  it("reads the creator handle only when the URL actually carries one", () => {
    expect(
      canonicalizeInstagramUrl(
        "https://www.instagram.com/somecreator/reel/Cx1y2Z3aBcD/"
      )?.creatorHandle
    ).toBe("@somecreator");
    expect(
      canonicalizeInstagramUrl("https://www.instagram.com/reel/Cx1y2Z3aBcD/")
        ?.creatorHandle
    ).toBeNull();
  });
});

describe("input classification", () => {
  it("treats free text as a transcript rather than a URL source", () => {
    expect(classifySalesIntelInput("They said they already have a company")).toBeNull();
  });

  it("routes each URL kind to its own source type", () => {
    expect(
      classifySalesIntelInput("https://youtu.be/dQw4w9WgXcQ")?.sourceType
    ).toBe("youtube");
    expect(
      classifySalesIntelInput("https://www.instagram.com/reel/Cx1y2Z3aBcD/")
        ?.sourceType
    ).toBe("instagram");
    expect(
      classifySalesIntelInput("https://example.com/a-sales-talk")?.sourceType
    ).toBe("manual_url");
  });
});

describe("source adapters", () => {
  it("ingests pasted transcript text immediately", async () => {
    const draft = await new SuppliedTranscriptAdapter().resolve({
      input: "When they say they already have someone, ask what would have to change.",
    });
    expect(draft.content?.kind).toBe("supplied_transcript");
    expect(draft.awaitingReason).toBeNull();
  });

  it("produces analyzable content from a YouTube URL when a provider is configured", async () => {
    const adapter = new YouTubeSourceAdapter(
      stubVideoProvider("Handle the incumbent objection by isolating the real constraint."),
      noMetadata
    );
    const draft = await adapter.resolve({
      input: "https://youtu.be/dQw4w9WgXcQ",
    });
    expect(draft.externalContentId).toBe("dQw4w9WgXcQ");
    expect(draft.content?.kind).toBe("video_understanding");
    expect(draft.content?.provider).toBe("stub");
    expect(draft.content?.model).toBe("stub-video-1");
  });

  it("keeps a YouTube source without fabricating a transcript when no provider is configured", async () => {
    const adapter = new YouTubeSourceAdapter(
      new UnconfiguredVideoUnderstandingProvider(),
      noMetadata
    );
    const draft = await adapter.resolve({
      input: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(draft.content).toBeNull();
    expect(draft.awaitingReason?.code).toBe("provider_unavailable");
    expect(draft.canonicalUrl).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
  });

  it("preserves a YouTube source when analysis fails", async () => {
    const failing: VideoUnderstandingProvider = {
      key: "failing",
      configured: true,
      async analyze() {
        throw new VideoUnderstandingFailedError(
          "provider returned 503",
          "provider_http_503",
          true
        );
      },
    };
    const draft = await new YouTubeSourceAdapter(failing, noMetadata).resolve({
      input: "https://youtu.be/dQw4w9WgXcQ",
    });
    expect(draft.content).toBeNull();
    expect(draft.awaitingReason?.code).toBe("provider_http_503");
    expect(draft.awaitingReason?.retryable).toBe(true);
    expect(draft.externalContentId).toBe("dQw4w9WgXcQ");
  });

  it("prefers a supplied transcript over model analysis", async () => {
    const adapter = new YouTubeSourceAdapter(
      stubVideoProvider("model derived"),
      noMetadata
    );
    const draft = await adapter.resolve({
      input: "https://youtu.be/dQw4w9WgXcQ",
      transcriptText: "operator supplied",
    });
    expect(draft.content?.kind).toBe("supplied_transcript");
    expect(draft.content?.text).toBe("operator supplied");
  });

  it("stores an Instagram Reel URL and waits for content instead of scraping", async () => {
    const draft = await new InstagramSourceAdapter().resolve({
      input: "https://www.instagram.com/reel/Cx1y2Z3aBcD/",
    });
    expect(draft.content).toBeNull();
    expect(draft.awaitingReason?.code).toBe("content_required");
    expect(draft.externalContentId).toBe("Cx1y2Z3aBcD");
  });

  it("extracts an Instagram Reel once a transcript is supplied", async () => {
    const draft = await new InstagramSourceAdapter().resolve({
      input: "https://www.instagram.com/reel/Cx1y2Z3aBcD/",
      transcriptText: "Ask what would have to be true for them to switch.",
    });
    expect(draft.content?.kind).toBe("supplied_transcript");
    expect(draft.awaitingReason).toBeNull();
  });

  it("routes each input kind to the adapter that owns it", () => {
    const registry = createSalesIntelAdapterRegistry();
    expect(registry.resolveAdapter({ input: "https://youtu.be/dQw4w9WgXcQ" }).key).toBe("youtube");
    expect(
      registry.resolveAdapter({
        input: "https://www.instagram.com/reel/Cx1y2Z3aBcD/",
      }).key
    ).toBe("instagram");
    expect(registry.resolveAdapter({ input: "plain transcript text" }).key).toBe(
      "supplied_transcript"
    );
    expect(
      registry.resolveAdapter({ input: "https://example.com/talk" }).key
    ).toBe("manual_url");
  });
});

describe("acceptance policy", () => {
  it("accepts confident extraction without a second sync step", () => {
    const state = reviewStateForExtraction({
      confidence: 0.82,
      sourceType: "youtube",
    });
    expect(state).toBe("accepted");
    expect(isDriverVisibleReviewState(state)).toBe(true);
  });

  it("holds low-confidence and unscored extraction for review", () => {
    expect(
      reviewStateForExtraction({ confidence: 0.2, sourceType: "youtube" })
    ).toBe("review_required");
    expect(
      reviewStateForExtraction({ confidence: null, sourceType: "youtube" })
    ).toBe("review_required");
  });

  it("never auto-accepts synthetic fixture material", () => {
    expect(
      reviewStateForExtraction({ confidence: 0.99, sourceType: "test_fixture" })
    ).toBe("review_required");
  });
});

describe("import contract", () => {
  it("rejects a source that cannot be traced", () => {
    const result = salesIntelImportSchema.safeParse({
      creator: { name: "Supplied Trainer" },
      source: { type: "manual_url" },
      frameworks: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a transcript-identified source and defaults phrase kind to paraphrase", () => {
    const result = salesIntelImportSchema.safeParse({
      creator: { name: "Supplied Trainer" },
      source: { type: "uploaded_transcript" },
      transcript: { text: "some teaching" },
      frameworks: [
        {
          archetype: "ANCHOR",
          channel: "phone",
          exactObjection: "We already have someone",
          frameworkName: "Constraint isolation",
          principle: "Find the constraint before proposing a switch",
          responseFamily: "isolate_constraint",
          exampleLanguage: ["What would have to change?"],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an inverted transcript range", () => {
    const result = salesIntelImportSchema.safeParse({
      creator: { name: "Supplied Trainer" },
      source: { type: "uploaded_transcript" },
      transcript: { text: "some teaching" },
      frameworks: [
        {
          archetype: "GHOST",
          channel: "follow_up",
          exactObjection: "No reply",
          frameworkName: "Re-open",
          principle: "Change channel",
          responseFamily: "channel_switch",
          transcriptStartMs: 9_000,
          transcriptEndMs: 1_000,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
