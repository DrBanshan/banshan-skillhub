import { execFile as execFileCallback } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { delimiter, dirname, join } from "path";
import { promisify } from "util";
import { combineErrors } from "./errors";

export interface ExecFileOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean | string;
}

export type ExecFile = (file: string, args: string[], options: ExecFileOptions) => Promise<unknown>;
interface ResolvedExecutable {
  file: string;
  env?: NodeJS.ProcessEnv;
}

const defaultExecFile: ExecFile = async (file, args, options) => {
  return promisify(execFileCallback)(file, args, options);
};

function userShell(): string {
  if (process.platform === "win32") return process.env.ComSpec ?? "cmd.exe";
  return process.env.SHELL ?? "/bin/sh";
}

function npxLookupArgs(): string[][] {
  if (process.platform === "win32") return [["/d", "/s", "/c", "where npx"]];
  return [["-lc", "command -v npx"], ["-lic", "command -v npx"]];
}

function stdoutFromExecResult(result: unknown): string {
  if (!result || typeof result !== "object" || !("stdout" in result)) return "";
  const stdout = (result as { stdout?: unknown }).stdout;
  return typeof stdout === "string" || Buffer.isBuffer(stdout) ? stdout.toString() : "";
}

function parseCommand(command: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;

  for (const character of command.trim()) {
    if (escaping) {
      token += character;
      escaping = false;
    } else if (character === "\\" && quote !== "'") {
      escaping = true;
    } else if (quote) {
      if (character === quote) quote = undefined;
      else token += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
    } else {
      token += character;
    }
  }

  if (escaping || quote) throw new Error("Invalid npx skills command: unmatched quote or escape");
  if (token) tokens.push(token);
  return tokens;
}

export function validateNpxSkillsCommand(command: string): boolean {
  try {
    normalizeNpxSkillsCommand(command);
    return true;
  } catch {
    return false;
  }
}

export function normalizeNpxSkillsCommand(command: string): string[] {
  const tokens = parseCommand(command);
  if (tokens[0] !== "npx" || tokens[1] !== "skills" || tokens[2] !== "add" || !tokens[3]) {
    throw new Error("Invalid npx skills command");
  }
  if (tokens.some((token) => token === "--global" || token.startsWith("--global=") || /^-[^-]*g/.test(token))) {
    throw new Error("Global npx skill installation is not allowed");
  }
  if (tokens.some((token) => token === "--list" || token === "-l")) {
    throw new Error("List-only npx skills commands cannot be imported");
  }

  const args = tokens.slice(1);
  const hasCodexAgent = args.some((token, index) =>
    token === "--agent=codex" || (token === "codex" && (args[index - 1] === "--agent" || args[index - 1] === "-a"))
  );
  const hasSkill = args.some((token) => token === "--skill" || token === "-s" || token === "--all" || token.startsWith("--skill="));
  const hasYes = args.some((token) => token === "--yes" || token === "-y");
  const hasCopy = args.includes("--copy");

  if (!hasCodexAgent) args.push("--agent", "codex");
  if (!hasSkill) args.push("--skill", "*");
  if (!hasYes) args.push("--yes");
  if (!hasCopy) args.push("--copy");
  return ["--yes", ...args];
}

export async function isNpxAvailable(execFile: ExecFile = defaultExecFile): Promise<boolean> {
  return (await resolveNpxExecutable(execFile)) !== undefined;
}

export async function resolveNpxExecutable(execFile: ExecFile = defaultExecFile): Promise<ResolvedExecutable | undefined> {
  try {
    await execFile("npx", ["--version"], {});
    return { file: "npx" };
  } catch {
    // Obsidian can start with a PATH that misses shell-managed Node installs.
  }

  for (const lookupArgs of npxLookupArgs()) {
    try {
      const lookupResult = await execFile(userShell(), lookupArgs, {});
      const executable = stdoutFromExecResult(lookupResult).split(/\r?\n/).find((line) => line.trim())?.trim();
      if (!executable) continue;
      const env = envWithExecutablePath(executable);
      await execFile(executable, ["--version"], { env });
      return { file: executable, env };
    } catch {
      // Try the next lookup mode.
    }
  }
  return undefined;
}

export async function runNpxSkillsAdd(command: string, cwd: string, execFile: ExecFile = defaultExecFile): Promise<string> {
  const args = normalizeNpxSkillsCommand(command);
  const npxExecutable = await resolveNpxExecutable(execFile);
  if (!npxExecutable) throw new Error("npx is not available.");

  const stagingPath = await mkdtemp(join(cwd, ".skillhub-npx-import-"));
  try {
    await execFile(npxExecutable.file, args, {
      cwd: stagingPath,
      env: {
        ...process.env,
        ...npxExecutable.env,
        DO_NOT_TRACK: "1",
        DISABLE_TELEMETRY: "1",
        CI: "1"
      }
    });
  } catch (error) {
    try {
      await rm(stagingPath, { force: true, recursive: true });
    } catch (cleanupError) {
      throw combineErrors(error, cleanupError, "staging cleanup failed");
    }
    throw error;
  }
  return stagingPath;
}

function envWithExecutablePath(executable: string): NodeJS.ProcessEnv {
  const executableDir = dirname(executable);
  return {
    ...process.env,
    PATH: [executableDir, process.env.PATH].filter(Boolean).join(delimiter)
  };
}
