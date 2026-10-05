import Anthropic from "@anthropic-ai/sdk";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ENV } from "../../_core/env";
import type { PresidentCycleMission } from "../../../shared/presidentCycle";
import { runPresidentCommand } from "./exec";
import { isPresidentMitchPath, isPresidentProtectedPath } from "./policy";

const MAX_READ_BYTES = 180_000;
const MAX_TOOL_TURNS = 16;

function resolveWorkspacePath(cwd: string, relativePath: string): {
  absolute: string;
  relative: string;
} {
  if (!relativePath || path.isAbsolute(relativePath))
    throw new Error("President workspace tool requires a relative path");
  const absolute = path.resolve(cwd, relativePath);
  const prefix = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
  if (absolute !== cwd && !absolute.startsWith(prefix))
    throw new Error("President workspace tool cannot escape the mission worktree");
  return {
    absolute,
    relative: path.relative(cwd, absolute).replace(/\\/g, "/"),
  };
}

function assertWritable(relative: string) {
  if (!relative || relative === ".")
    throw new Error("President workspace tool requires a file path");
  if (relative === ".git" || relative.startsWith(".git/"))
    throw new Error("President workspace tool cannot modify git metadata");
  if (isPresidentProtectedPath(relative))
    throw new Error("President workspace tool cannot modify protected path " + relative);
}

function assertReadable(relative: string) {
  if (relative === ".git" || relative.startsWith(".git/"))
    throw new Error("President workspace tool cannot read git metadata");
  if (/^server\/mitch(?:\/|$)/i.test(relative) || /^shared\/mitch/i.test(relative))
    throw new Error("President workspace tool cannot read Mitch-owned source");
}

async function handleTool(
  cwd: string,
  name: string,
  rawInput: Record<string, unknown>
): Promise<string> {
  if (name === "list_directory") {
    const requested = String(rawInput.path ?? ".");
    const { absolute, relative } = resolveWorkspacePath(cwd, requested);
    assertReadable(relative);
    const entries = await readdir(absolute, { withFileTypes: true });
    return JSON.stringify(
      entries
        .filter(entry => {
          const child = path
            .join(relative === "." ? "" : relative, entry.name)
            .replace(/\\/g, "/");
          return !/^server\/mitch(?:\/|$)/i.test(child) && !/^shared\/mitch/i.test(child);
        })
        .slice(0, 300)
        .map(entry => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
        }))
    );
  }

  if (name === "read_file") {
    const { absolute, relative } = resolveWorkspacePath(
      cwd,
      String(rawInput.path ?? "")
    );
    assertReadable(relative);
    const content = await readFile(absolute, "utf8");
    const startLine = Math.max(1, Number(rawInput.start_line ?? 1));
    const requestedEnd = Number(rawInput.end_line ?? startLine + 400);
    const endLine = Math.min(startLine + 800, Math.max(startLine, requestedEnd));
    const sliced = content
      .split("\n")
      .slice(startLine - 1, endLine)
      .join("\n");
    return sliced.slice(0, MAX_READ_BYTES);
  }

  if (name === "search_text") {
    const query = String(rawInput.query ?? "").trim();
    if (!query) throw new Error("search_text requires a query");
    const requestedPath = String(rawInput.path ?? ".");
    const { relative } = resolveWorkspacePath(cwd, requestedPath);
    assertReadable(relative);
    const args = ["grep", "-n", "-I", "-F", "-e", query, "--"];
    if (relative && relative !== ".") args.push(relative);
    const result = await runPresidentCommand({
      command: "git",
      args,
      cwd,
      timeoutMs: 20_000,
    });
    if (result.exitCode !== 0 && result.exitCode !== 1)
      throw new Error("search_text failed");
    return result.stdout
      .split("\n")
      .filter(line => {
        const file = line.split(":", 1)[0] ?? "";
        return !/^server\/mitch(?:\/|$)/i.test(file) && !/^shared\/mitch/i.test(file);
      })
      .slice(0, 300)
      .join("\n");
  }

  if (name === "write_file") {
    const { absolute, relative } = resolveWorkspacePath(
      cwd,
      String(rawInput.path ?? "")
    );
    assertWritable(relative);
    const content = String(rawInput.content ?? "");
    if (content.length > 800_000)
      throw new Error("write_file content exceeds bounded size");
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
    return "wrote " + relative;
  }

  if (name === "replace_text") {
    const { absolute, relative } = resolveWorkspacePath(
      cwd,
      String(rawInput.path ?? "")
    );
    assertWritable(relative);
    const oldText = String(rawInput.old_text ?? "");
    const newText = String(rawInput.new_text ?? "");
    if (!oldText) throw new Error("replace_text requires old_text");
    const source = await readFile(absolute, "utf8");
    const first = source.indexOf(oldText);
    if (first < 0) throw new Error("replace_text old_text not found");
    if (source.indexOf(oldText, first + oldText.length) >= 0)
      throw new Error("replace_text old_text is not unique");
    await writeFile(
      absolute,
      source.slice(0, first) + newText + source.slice(first + oldText.length),
      "utf8"
    );
    return "replaced text in " + relative;
  }

  throw new Error("Unknown President workspace tool: " + name);
}

const tools: any[] = [
  {
    name: "list_directory",
    description: "List files/directories inside the isolated mission worktree.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description: "Read a bounded line range from a file inside the mission worktree.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "integer", minimum: 1 },
        end_line: { type: "integer", minimum: 1 },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "search_text",
    description: "Search tracked worktree text for a literal string. This is read-only.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description: "Create or fully replace one allowed file in the mission worktree.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "replace_text",
    description: "Replace one unique exact text span in an allowed worktree file.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_text: { type: "string" },
        new_text: { type: "string" },
      },
      required: ["path", "old_text", "new_text"],
      additionalProperties: false,
    },
  },
];

export async function runAnthropicWorkspaceAgent(input: {
  cwd: string;
  mission: PresidentCycleMission;
  system: string;
  repairContext?: string;
}): Promise<string> {
  if (!ENV.anthropicApiKey?.trim())
    throw new Error("ANTHROPIC_API_KEY is required for President API execution");
  const model =
    process.env.PRESIDENT_ENGINEERING_MODEL?.trim() ||
    process.env.PRESIDENT_MODEL?.trim() ||
    ENV.anthropicModel;
  const client = new Anthropic({ apiKey: ENV.anthropicApiKey });
  const messages: any[] = [
    {
      role: "user",
      content: JSON.stringify({
        missionId: input.mission.id,
        cycleId: input.mission.cycleId,
        title: input.mission.title,
        objective: input.mission.objective,
        acceptanceCriteria: input.mission.acceptanceCriteria,
        evidenceIds: input.mission.evidenceIds,
        attemptCount: input.mission.attemptCount,
        repairContext: input.repairContext ?? null,
      }),
    },
  ];
  const summaries: string[] = [];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response: any = await client.messages.create({
      model,
      max_tokens: 8192,
      temperature: 0,
      system: input.system,
      messages,
      tools,
    } as any);
    const content = Array.isArray(response.content) ? response.content : [];
    const text = content
      .filter((block: any) => block.type === "text")
      .map((block: any) => String(block.text ?? ""))
      .join("\n")
      .trim();
    if (text) summaries.push(text.slice(0, 20_000));
    const uses = content.filter((block: any) => block.type === "tool_use");
    if (!uses.length) {
      if (!text)
        throw new Error("President Anthropic workspace agent returned no final result");
      return summaries.join("\n\n").slice(-40_000);
    }

    messages.push({ role: "assistant", content });
    const results = [];
    for (const use of uses) {
      try {
        const result = await handleTool(
          input.cwd,
          String(use.name),
          (use.input ?? {}) as Record<string, unknown>
        );
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: result,
        });
      } catch (error) {
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          is_error: true,
          content: error instanceof Error ? error.message : String(error),
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  throw new Error("President Anthropic workspace agent exceeded bounded tool turns");
}
