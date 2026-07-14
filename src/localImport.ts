import { execFile as execFileCallback } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import { combineErrors } from "./errors";

export interface ExecFileOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export type ExecFile = (file: string, args: string[], options: ExecFileOptions) => Promise<unknown>;

const defaultExecFile: ExecFile = async (file, args, options) => {
  await promisify(execFileCallback)(file, args, options);
};

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
  return args;
}

export async function isNpxAvailable(execFile: ExecFile = defaultExecFile): Promise<boolean> {
  try {
    await execFile("npx", ["--version"], {});
    return true;
  } catch {
    return false;
  }
}

export async function runNpxSkillsAdd(command: string, cwd: string, execFile: ExecFile = defaultExecFile): Promise<string> {
  const args = normalizeNpxSkillsCommand(command);

  const stagingPath = await mkdtemp(join(cwd, ".skillhub-npx-import-"));
  try {
    await execFile("npx", args, {
      cwd: stagingPath,
      env: {
        ...process.env,
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
