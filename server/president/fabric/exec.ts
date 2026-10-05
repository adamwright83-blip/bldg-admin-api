import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PresidentCommandResult = {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function runPresidentCommand(input: {
  command: string;
  args?: string[];
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<PresidentCommandResult> {
  const args = input.args ?? [];
  try {
    const result = await execFileAsync(input.command, args, {
      cwd: input.cwd,
      timeout: input.timeoutMs ?? 120_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, CI: "true", ...input.env },
    });
    return {
      command: input.command,
      args,
      exitCode: 0,
      stdout: result.stdout.slice(0, 200_000),
      stderr: result.stderr.slice(0, 100_000),
    };
  } catch (error) {
    const value = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      command: input.command,
      args,
      exitCode: typeof value.code === "number" ? value.code : 1,
      stdout: String(value.stdout ?? "").slice(0, 200_000),
      stderr: String(value.stderr ?? value.message ?? error).slice(0, 100_000),
    };
  }
}

export function commandLabel(result: Pick<PresidentCommandResult, "command" | "args">) {
  return [result.command, ...result.args].join(" ");
}
