import { execFile as execFileCallback } from "child_process";
import { mkdtemp } from "fs/promises";
import { join } from "path";
import { promisify } from "util";

export type ExecFile = (file: string, args: string[], options: { cwd?: string }) => Promise<unknown>;

const defaultExecFile: ExecFile = async (file, args, options) => {
  await promisify(execFileCallback)(file, args, options);
};

function parseCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

export function validateNpxSkillsCommand(command: string): boolean {
  const tokens = parseCommand(command);
  return tokens[0] === "npx" && tokens[1] === "skills" && tokens[2] === "add";
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
  if (!validateNpxSkillsCommand(command)) throw new Error("Invalid npx skills command");

  const stagingPath = await mkdtemp(join(cwd, ".skillhub-npx-import-"));
  await execFile("npx", parseCommand(command).slice(1), { cwd: stagingPath });
  return stagingPath;
}
