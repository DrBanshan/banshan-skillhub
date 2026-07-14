import { cp, lstat, mkdir, rm, symlink } from "fs/promises";
import { join } from "path";
import { createSkillEvent } from "./events";
import { SkillRegistry } from "./registry";
import type { InstallMethod, SkillRecord } from "./types";

export type SymlinkConflictBehavior = "skip" | "replace-symlinks";
export type DestinationState = "missing" | "symlink" | "real" | "other";

export interface InstallOptions {
  vaultPath: string;
  method: InstallMethod;
  conflictBehavior: SymlinkConflictBehavior;
}

export interface InstallFailure {
  skillId: string;
  reason: string;
}

export interface InstallSummary {
  installed: string[];
  skipped: string[];
  replaced: string[];
  failed: InstallFailure[];
}

type InstallResult = "installed" | "skipped" | "replaced";

export async function ensureAgentsSkillsDir(targetDir: string): Promise<string> {
  const agentsSkillsDir = join(targetDir, ".agents", "skills");
  await mkdir(agentsSkillsDir, { recursive: true });
  return agentsSkillsDir;
}

export async function inspectDestination(destination: string): Promise<DestinationState> {
  try {
    const stats = await lstat(destination);
    if (stats.isSymbolicLink()) return "symlink";
    if (stats.isDirectory() || stats.isFile()) return "real";
    return "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

export async function installBySymlink(
  source: string,
  destination: string,
  conflictBehavior: SymlinkConflictBehavior
): Promise<InstallResult> {
  const state = await inspectDestination(destination);
  if (state === "symlink" && conflictBehavior === "replace-symlinks") {
    await rm(destination, { force: true, recursive: true });
    await symlink(source, destination, "dir");
    return "replaced";
  }
  if (state !== "missing") return "skipped";

  await symlink(source, destination, "dir");
  return "installed";
}

export async function installByCopy(source: string, destination: string): Promise<InstallResult> {
  if ((await inspectDestination(destination)) !== "missing") return "skipped";

  await cp(source, destination, { recursive: true });
  return "installed";
}

function formatInstallError(error: unknown, method: InstallMethod): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (method === "symlink" && process.platform === "win32" && (code === "EPERM" || code === "EACCES")) {
    return "Windows blocked symlink creation. Enable Developer Mode or run Obsidian with elevated permissions.";
  }
  return error instanceof Error ? error.message : String(error);
}

export class SkillExportService {
  constructor(private readonly registry: SkillRegistry) {}

  async installSkills(records: SkillRecord[], targetDir: string, options: InstallOptions): Promise<InstallSummary> {
    const summary: InstallSummary = { installed: [], skipped: [], replaced: [], failed: [] };
    let agentsSkillsDir: string;

    try {
      agentsSkillsDir = await ensureAgentsSkillsDir(targetDir);
    } catch (error) {
      const reason = formatInstallError(error, options.method);
      summary.failed.push(...records.map((record) => ({ skillId: record.id, reason })));
      return summary;
    }

    for (const record of records) {
      const source = join(options.vaultPath, record.vaultPath);
      const destination = join(agentsSkillsDir, record.folderName);

      try {
        const result = options.method === "symlink"
          ? await installBySymlink(source, destination, options.conflictBehavior)
          : await installByCopy(source, destination);
        summary[result].push(record.id);

        if (result !== "skipped") {
          const timestamp = new Date().toISOString();
          this.registry.incrementInstall(record.id, timestamp);
          this.registry.recordEvent(createSkillEvent("skill_installed", record.id, { method: options.method }, timestamp));
        }
      } catch (error) {
        summary.failed.push({ skillId: record.id, reason: formatInstallError(error, options.method) });
      }
    }

    return summary;
  }
}
