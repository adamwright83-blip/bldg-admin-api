import type {
  IMitchAgentWakeProvider,
  MitchAgentWake,
} from "./mitchAgentWake";

export type GitHubActionsMitchWakeProviderOptions = {
  token: string;
  repoFullName: string;
  ref?: string;
};

const ACTOR_WORKFLOWS: Record<string, string> = {
  "github-producer-bus:claude": "mitch-claude-executor.yml",
  "claude_independent_review": "mitch-independent-reviewer.yml",
};

export class GitHubActionsMitchWakeProvider
  implements IMitchAgentWakeProvider
{
  private readonly ref: string;

  constructor(
    private readonly options: GitHubActionsMitchWakeProviderOptions
  ) {
    if (!options.token.trim())
      throw new Error("MITCH_GITHUB_TOKEN is required for GitHub Actions wake");
    if (!options.repoFullName.includes("/"))
      throw new Error("MITCH_GITHUB_REPO must be owner/repo");
    this.ref = options.ref?.trim() || "main";
  }

  hasTarget(actorId: string): boolean {
    return Boolean(ACTOR_WORKFLOWS[actorId]);
  }

  async wake(input: MitchAgentWake): Promise<void> {
    const workflow = ACTOR_WORKFLOWS[input.actorId];
    if (!workflow)
      throw new Error(
        `No GitHub Actions Mitch workflow is configured for actor "${input.actorId}"`
      );
    const [owner, repo] = this.options.repoFullName.split("/");
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.options.token}`,
          "content-type": "application/json",
          "user-agent": "joystick-mitch-producer",
          "x-github-api-version": "2022-11-28",
        },
        body: JSON.stringify({
          ref: this.ref,
          inputs: { wake: JSON.stringify(input) },
        }),
      }
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Mitch could not dispatch ${workflow} (${response.status}): ${body.slice(0, 500)}`
      );
    }
  }
}
