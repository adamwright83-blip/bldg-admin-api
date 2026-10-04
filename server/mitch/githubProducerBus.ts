import {
  handbackMarker,
  mitchProducerDesignReviewSchema,
  mitchProducerHandbackPayloadSchema,
  type MitchProducerDesignReview,
  type MitchProducerHandbackPayload,
} from "../../shared/mitchProducerBus";

export type GitHubIssueComment = {
  id: number;
  html_url: string;
  body: string;
  created_at: string;
  user?: { login?: string | null } | null;
};

export type GitHubProducerBusConfig = {
  token: string;
  repoFullName: string;
  issueNumber: number;
  apiBaseUrl?: string;
};

export class GitHubProducerBusConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubProducerBusConfigurationError";
  }
}

function parseJsonFence<T>(body: string, marker: string, parse: (value: unknown) => T): T | null {
  if (!body.includes(`<!-- ${marker} -->`)) return null;
  const afterMarker = body.slice(body.indexOf(`<!-- ${marker} -->`) + marker.length + 9);
  const match = afterMarker.match(/(?:```|~~~)(?:json|mitch-handback|mitch-review)?\s*([\s\S]*?)\s*(?:```|~~~)/i);
  if (!match) return null;
  try {
    return parse(JSON.parse(match[1]));
  } catch {
    return null;
  }
}

export class GitHubProducerBus {
  private readonly apiBaseUrl: string;

  constructor(private readonly config: GitHubProducerBusConfig) {
    if (!config.token?.trim()) throw new GitHubProducerBusConfigurationError("MITCH_GITHUB_TOKEN is required.");
    if (!config.repoFullName.includes("/")) {
      throw new GitHubProducerBusConfigurationError("MITCH_GITHUB_REPO must be owner/repo.");
    }
    if (!Number.isInteger(config.issueNumber) || config.issueNumber <= 0) {
      throw new GitHubProducerBusConfigurationError("MITCH_GITHUB_ISSUE_NUMBER must be a positive integer.");
    }
    this.apiBaseUrl = (config.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.config.token}`,
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
        "user-agent": "joystick-mitch-producer",
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`GitHub producer bus request failed ${response.status}: ${body.slice(0, 500)}`);
    }
    return response;
  }

  async listComments(): Promise<GitHubIssueComment[]> {
    const [owner, repo] = this.config.repoFullName.split("/");
    const out: GitHubIssueComment[] = [];
    for (let page = 1; page <= 10; page++) {
      const response = await this.request(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${this.config.issueNumber}/comments?per_page=100&page=${page}`
      );
      const batch = (await response.json()) as GitHubIssueComment[];
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }

  async postComment(body: string): Promise<GitHubIssueComment> {
    const [owner, repo] = this.config.repoFullName.split("/");
    const response = await this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${this.config.issueNumber}/comments`,
      { method: "POST", body: JSON.stringify({ body }) }
    );
    return (await response.json()) as GitHubIssueComment;
  }

  async hasMarker(marker: string): Promise<boolean> {
    const comments = await this.listComments();
    return comments.some(comment => comment.body.includes(`<!-- ${marker} -->`));
  }

  async waitForHandback(input: {
    workOrderId: string;
    after?: string | null;
    pollMs: number;
    timeoutMs: number;
  }): Promise<{ payload: MitchProducerHandbackPayload; comment: GitHubIssueComment }> {
    const marker = handbackMarker(input.workOrderId);
    const deadline = Date.now() + input.timeoutMs;
    while (Date.now() < deadline) {
      const comments = await this.listComments();
      for (const comment of comments) {
        if (input.after && new Date(comment.created_at).getTime() < new Date(input.after).getTime()) continue;
        const payload = parseJsonFence(comment.body, marker, value =>
          mitchProducerHandbackPayloadSchema.parse(value)
        );
        if (payload) return { payload, comment };
      }
      await new Promise(resolve => setTimeout(resolve, input.pollMs));
    }
    throw new Error(`Timed out waiting for CLAUDE → MITCH handback for work order ${input.workOrderId}.`);
  }

  async readDesignReview(input: {
    marker: string;
  }): Promise<{ review: MitchProducerDesignReview; comment: GitHubIssueComment } | null> {
    const comments = await this.listComments();
    for (const comment of comments) {
      const review = parseJsonFence(comment.body, input.marker, value =>
        mitchProducerDesignReviewSchema.parse(value)
      );
      if (review) return { review, comment };
    }
    return null;
  }
}
