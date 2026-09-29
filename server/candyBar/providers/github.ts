import {
  assertAllowedCandyBarRepository,
  type CiStatusArtifact,
  type PrStatusArtifact,
  type RepoContextArtifact,
} from "../../../shared/candyBar";
import type { GithubObserver } from "./types";

function parsePrNumber(prUrl?: string | null, prNumber?: number | null): number | null {
  if (typeof prNumber === "number" && Number.isFinite(prNumber)) return prNumber;
  if (!prUrl) return null;
  const match = prUrl.match(/\/pull\/(\d+)/);
  return match ? Number(match[1]) : null;
}

/**
 * Read-only GitHub observer. Uses GITHUB_TOKEN when present.
 * Never merges or deploys. Fail-closed on unknown repositories.
 */
export function createGithubApiObserver(env: NodeJS.ProcessEnv = process.env): GithubObserver {
  const token = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim() || "";

  async function gh<T>(path: string): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "candy-bar-v0",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API ${response.status}: ${body.slice(0, 200)}`);
    }
    return response.json() as Promise<T>;
  }

  return {
    providerId: "github",
    async getMainSha(repository, branch = "main") {
      assertAllowedCandyBarRepository(repository);
      const data = await gh<{ sha: string }>(
        `/repos/${repository}/commits/${encodeURIComponent(branch)}`
      );
      return data.sha;
    },
    async getRepoContext(input) {
      assertAllowedCandyBarRepository(input.repository);
      const mainSha = await this.getMainSha(input.repository, input.baseBranch);
      let recentMergedPrs: RepoContextArtifact["recentMergedPrs"] = [];
      let openPrs: RepoContextArtifact["openPrs"] = [];
      try {
        const merged = await gh<
          Array<{ number: number; title: string; merged_at: string | null }>
        >(
          `/repos/${input.repository}/pulls?state=closed&sort=updated&direction=desc&per_page=10`
        );
        recentMergedPrs = merged
          .filter(p => p.merged_at)
          .slice(0, 5)
          .map(p => ({
            number: p.number,
            title: p.title,
            mergedAt: p.merged_at!,
          }));
        const open = await gh<
          Array<{ number: number; title: string; draft: boolean; head: { ref: string } }>
        >(`/repos/${input.repository}/pulls?state=open&per_page=20`);
        openPrs = open.map(p => ({
          number: p.number,
          title: p.title,
          headRef: p.head.ref,
          draft: Boolean(p.draft),
        }));
      } catch {
        // Bounded context: empty lists are acceptable when GitHub is flaky.
      }
      return {
        repository: input.repository,
        baseBranch: input.baseBranch,
        mainSha,
        recentMergedPrs,
        openPrs,
        knownInvariants: [
          "Reuse goldline engineering agentsClient; do not fork a parallel engineer platform.",
          "Stop at READY_FOR_HUMAN; never auto-merge or deploy.",
          "Standing currentGoal may only change via authorized human action.",
        ],
        protectedAreas: input.protectedAreas,
        knownParallelWork: input.knownParallelWork,
        nonGoals: input.nonGoals,
        currentGoal: input.currentGoal,
        goalVersion: input.goalVersion,
        ciSummary: null,
      };
    },
    async observePr(input) {
      assertAllowedCandyBarRepository(input.repository);
      const number = parsePrNumber(input.prUrl, input.prNumber);
      if (!number) {
        return {
          exists: false,
          number: null,
          url: input.prUrl ?? null,
          state: "missing",
          draft: false,
          headSha: null,
          baseSha: null,
          mergeable: null,
          verified: true,
        };
      }
      try {
        const pr = await gh<{
          number: number;
          html_url: string;
          state: string;
          draft: boolean;
          merged_at: string | null;
          mergeable: boolean | null;
          head: { sha: string };
          base: { sha: string };
        }>(`/repos/${input.repository}/pulls/${number}`);
        const state: PrStatusArtifact["state"] = pr.merged_at
          ? "merged"
          : pr.state === "open"
            ? "open"
            : pr.state === "closed"
              ? "closed"
              : "unknown";
        return {
          exists: true,
          number: pr.number,
          url: pr.html_url,
          state,
          draft: Boolean(pr.draft),
          headSha: pr.head.sha,
          baseSha: pr.base.sha,
          mergeable: pr.mergeable,
          verified: true,
        };
      } catch {
        return {
          exists: false,
          number,
          url: input.prUrl ?? null,
          state: "missing",
          draft: false,
          headSha: null,
          baseSha: null,
          mergeable: null,
          verified: true,
        };
      }
    },
    async observeCi(input) {
      assertAllowedCandyBarRepository(input.repository);
      try {
        const status = await gh<{
          state: string;
          statuses: Array<{ context: string; state: string }>;
        }>(`/repos/${input.repository}/commits/${input.headSha}/status`);
        const failedChecks = status.statuses
          .filter(s => s.state === "failure" || s.state === "error")
          .map(s => s.context);
        const successChecks = status.statuses
          .filter(s => s.state === "success")
          .map(s => s.context);
        const mapped: CiStatusArtifact["status"] =
          status.state === "success"
            ? "success"
            : status.state === "failure" || status.state === "error"
              ? "failure"
              : status.state === "pending"
                ? "pending"
                : "unknown";
        return {
          headSha: input.headSha,
          status: mapped,
          failedChecks,
          successChecks,
          verified: true,
        };
      } catch {
        return {
          headSha: input.headSha,
          status: "unknown",
          failedChecks: [],
          successChecks: [],
          verified: false,
        };
      }
    },
  };
}

export type FakeGithubState = {
  mainSha: string;
  prs: Map<
    number,
    {
      url: string;
      state: PrStatusArtifact["state"];
      draft: boolean;
      headSha: string;
      baseSha: string;
      mergeable: boolean | null;
    }
  >;
  ci: Map<string, CiStatusArtifact>;
  openPrs: RepoContextArtifact["openPrs"];
  recentMergedPrs: RepoContextArtifact["recentMergedPrs"];
};

export function createFakeGithubObserver(state: FakeGithubState): GithubObserver {
  return {
    providerId: "github",
    async getMainSha(repository) {
      assertAllowedCandyBarRepository(repository);
      return state.mainSha;
    },
    async getRepoContext(input) {
      assertAllowedCandyBarRepository(input.repository);
      return {
        repository: input.repository,
        baseBranch: input.baseBranch,
        mainSha: state.mainSha,
        recentMergedPrs: state.recentMergedPrs,
        openPrs: state.openPrs,
        knownInvariants: ["fake-invariants"],
        protectedAreas: input.protectedAreas,
        knownParallelWork: input.knownParallelWork,
        nonGoals: input.nonGoals,
        currentGoal: input.currentGoal,
        goalVersion: input.goalVersion,
        ciSummary: null,
      };
    },
    async observePr(input) {
      assertAllowedCandyBarRepository(input.repository);
      const number = parsePrNumber(input.prUrl, input.prNumber);
      if (!number || !state.prs.has(number)) {
        return {
          exists: false,
          number: number,
          url: input.prUrl ?? null,
          state: "missing",
          draft: false,
          headSha: null,
          baseSha: null,
          mergeable: null,
          verified: true,
        };
      }
      const pr = state.prs.get(number)!;
      return {
        exists: true,
        number,
        url: pr.url,
        state: pr.state,
        draft: pr.draft,
        headSha: pr.headSha,
        baseSha: pr.baseSha,
        mergeable: pr.mergeable,
        verified: true,
      };
    },
    async observeCi(input) {
      assertAllowedCandyBarRepository(input.repository);
      return (
        state.ci.get(input.headSha) ?? {
          headSha: input.headSha,
          status: "unknown",
          failedChecks: [],
          successChecks: [],
          verified: true,
        }
      );
    },
  };
}
