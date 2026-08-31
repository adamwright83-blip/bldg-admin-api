import { createHash } from "node:crypto";

export type TowerImageRequest = {
  physicalEntityId: string;
  prompt: string;
  promptVersion: string;
  sourceEvidenceIds: string[];
};

export type TowerImageResult = {
  provider: string;
  modelVersion: string | null;
  mimeType: "image/png" | "image/webp";
  bytes: Buffer;
  promptVersionHash: string;
};

export interface TowerImageProvider {
  readonly key: string;
  configured(): boolean;
  generate(input: TowerImageRequest): Promise<TowerImageResult>;
}

export function towerPromptHash(input: TowerImageRequest) {
  return createHash("sha256").update(JSON.stringify({
    prompt: input.prompt,
    promptVersion: input.promptVersion,
    sourceEvidenceIds: [...input.sourceEvidenceIds].sort(),
  })).digest("hex");
}

export class UnconfiguredTowerImageProvider implements TowerImageProvider {
  readonly key = "unconfigured";
  configured() { return false; }
  async generate(): Promise<TowerImageResult> {
    throw new Error("TOWER_IMAGE_PROVIDER_UNCONFIGURED");
  }
}

export class OpenAITowerImageProvider implements TowerImageProvider {
  readonly key = "openai";
  constructor(
    private readonly apiKey = process.env.OPENAI_API_KEY ?? "",
    private readonly model = process.env.GOLDLINE_IMAGE_MODEL ?? "gpt-image-1",
    private readonly fetchImpl: typeof fetch = fetch
  ) {}
  configured() { return Boolean(this.apiKey.trim()); }
  async generate(input: TowerImageRequest): Promise<TowerImageResult> {
    if (!this.configured()) throw new Error("TOWER_IMAGE_PROVIDER_UNCONFIGURED");
    const response = await this.fetchImpl("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: input.prompt, size: "1024x1536", quality: "high", output_format: "png" }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Tower image generation failed with HTTP ${response.status}`);
    const body = await response.json() as { data?: Array<{ b64_json?: string }> };
    const encoded = body.data?.[0]?.b64_json;
    if (!encoded) throw new Error("Tower image provider returned no image bytes");
    return { provider: this.key, modelVersion: this.model, mimeType: "image/png", bytes: Buffer.from(encoded, "base64"), promptVersionHash: towerPromptHash(input) };
  }
}

/** Test-only adapter. Its bytes are labeled and must never be selected in production. */
export class DeterministicTestTowerImageProvider implements TowerImageProvider {
  readonly key = "deterministic_test_only";
  configured() { return true; }
  async generate(input: TowerImageRequest): Promise<TowerImageResult> {
    const hash = towerPromptHash(input);
    return { provider: this.key, modelVersion: "fixture-v1", mimeType: "image/png", bytes: Buffer.from(`GOLDLINE_TEST_ONLY_IMAGE:${hash}`), promptVersionHash: hash };
  }
}

export function productionTowerImageProvider(): TowerImageProvider {
  const openai = new OpenAITowerImageProvider();
  return openai.configured() ? openai : new UnconfiguredTowerImageProvider();
}
