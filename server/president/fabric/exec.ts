import { spawn } from "node:child_process";
import { redactSecrets } from "../cycle/models";

export type CommandResult = {
  command: string;
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
};

/** Bounded process execution: timeout, output cap, exit code, redacted output. */
export function runCommand(
  command: string,
  cwd: string,
  opts: { timeoutMs?: number; maxBytes?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<CommandResult> {
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const cap = opts.maxBytes ?? 200_000;
  const started = Date.now();
  return new Promise(resolve => {
    const child = spawn("sh", ["-c", command], {
      cwd,
      env: { ...process.env, ...opts.env, CI: "1" },
      detached: true,
    });
    let stdout = "",
      stderr = "",
      timedOut = false;
    const add = (cur: string, d: Buffer) =>
      cur.length >= cap ? cur : (cur + d.toString()).slice(0, cap);
    child.stdout.on("data", d => (stdout = add(stdout, d)));
    child.stderr.on("data", d => (stderr = add(stderr, d)));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        /* gone */
      }
    }, timeoutMs);
    child.on("close", code => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: timedOut ? 124 : (code ?? 1),
        timedOut,
        stdout: redactSecrets(stdout),
        stderr: redactSecrets(stderr),
        durationMs: Date.now() - started,
      });
    });
    child.on("error", e => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: 127,
        timedOut: false,
        stdout,
        stderr: String(e),
        durationMs: Date.now() - started,
      });
    });
  });
}

const SAFE_VALIDATION =
  /^(npx (vitest|tsc|eslint|prettier|tsx)|npm (test|run [\w:-]+)|pnpm (test|run [\w:-]+|check|vitest)|node [\w./-]+|vitest|tsc)\b[^;&|`$<>]*$/;

/** Validation commands originate from model output. Allowlist them; no shell metacharacters. */
export function assertSafeValidationCommand(cmd: string) {
  if (!SAFE_VALIDATION.test(cmd.trim()))
    throw new Error(`Validation command not allowed: ${cmd.slice(0, 120)}`);
}


const SAFE_APP_START =
  /^(pnpm (dev|run [\w:-]+)|npm run [\w:-]+|npx (vite|tsx)\b[^;&|\`$<>]*|node [\w./-]+)\s*$/;

/** Browser start commands also originate from model output; keep them non-composable. */
export function assertSafeAppStartCommand(cmd: string) {
  if (!SAFE_APP_START.test(cmd.trim()))
    throw new Error(`Browser start command not allowed: ${cmd.slice(0, 120)}`);
}
