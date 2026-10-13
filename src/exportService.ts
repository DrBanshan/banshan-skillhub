import { cp, lstat, mkdir, symlink, unlink } from "fs/promises";
import { join } from "path";
import { createSkillEvent } from "./events";
import { SkillRegistry } from "./registry";
import type { InstallMethod, SkillRecord } from "./types";
import { resolveVaultRelativePath } from "./vaultPaths";

export type SymlinkConflictBehavior = "skip" | "replace-symlinks";
export type DestinationState = "missing" | "symlink" | "real" | "other";
export type InstallLinkMechanism = "symlink" | "junction";
export type InstallMechanism = InstallLinkMechanism | "copy";

export interface LinkOutcome {
  result: InstallResult;
  mechanism: InstallLinkMechanism;
}

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
  /** Which mechanism actually created each entry, so reports can be truthful about reparse types. */
  mechanisms?: Record<string, InstallMechanism>;
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

const JUNCTION_FALLBACK_CODES = ["EPERM", "EACCES", "EINVAL", "EOPNOTSUP", "ENOTSUPP", "ENOTSUP"];

function isJunctionFallbackCandidate(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" && JUNCTION_FALLBACK_CODES.includes(code);
}

async function createLink(source: string, destination: string, mechanism: InstallLinkMechanism): Promise<void> {
  await symlink(source, destination, mechanism === "junction" ? "junction" : "dir");
}

/**
 * Creates or replaces a directory link.
 * A refused symlink is retried as a Windows junction so a normal shell does not need Developer Mode or an
 * elevated process, which is what makes the command line install path usable out of the box.
 */
export async function installByLink(
  source: string,
  destination: string,
  conflictBehavior: SymlinkConflictBehavior,
  requested: InstallLinkMechanism = "symlink"
): Promise<LinkOutcome> {
  const state = await inspectDestination(destination);
  const reportMechanism: InstallLinkMechanism = requested === "junction" ? "junction" : "symlink";
  if (state === "symlink" && conflictBehavior !== "replace-symlinks") return { result: "skipped", mechanism: reportMechanism };
  if (state !== "missing" && state !== "symlink") return { result: "skipped", mechanism: reportMechanism };

  const replacing = state === "symlink";
  if (replacing) await unlink(destination);
  try {
    await createLink(source, destination, requested);
    return { result: replacing ? "replaced" : "installed", mechanism: requested };
  } catch (error) {
    if (requested !== "symlink" || !isJunctionFallbackCandidate(error)) throw error;
    await createLink(source, destination, "junction");
    return { result: replacing ? "replaced" : "installed", mechanism: "junction" };
  }
}

export async function installBySymlink(
  source: string,
  destination: string,
  conflictBehavior: SymlinkConflictBehavior
): Promise<InstallResult> {
  return (await installByLink(source, destination, conflictBehavior, "symlink")).result;
}

export async function installByCopy(source: string, destination: string): Promise<InstallResult> {
  if ((await inspectDestination(destination)) !== "missing") return "skipped";

  try {
    await mkdir(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "skipped";
    throw error;
  }
  await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
  return "installed";
}

function formatInstallError(error: unknown, method: InstallMethod): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (method === "junction" && (code === "EPERM" || code === "EACCES")) {
    return "Could not create a junction at the requested location. Choose a target directory you can write to.";
  }
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
      const destination = join(agentsSkillsDir, record.folderName);

      try {
        const source = await resolveVaultRelativePath(options.vaultPath, record.vaultPath, { verifyFilesystem: true });
        const outcome: LinkOutcome | { result: InstallResult; mechanism: InstallMechanism } = options.method === "copy"
          ? { result: await installByCopy(source, destination), mechanism: "copy" }
          : await installByLink(source, destination, options.conflictBehavior, options.method);
        summary[outcome.result].push(record.id);

        if (outcome.result !== "skipped") {
          if (!summary.mechanisms) summary.mechanisms = {};
          summary.mechanisms[record.id] = outcome.mechanism;
          const timestamp = new Date().toISOString();
          this.registry.incrementInstall(record.id, timestamp);
          this.registry.recordEvent(createSkillEvent("skill_installed", record.id, {
            method: options.method,
            targetDir,
            ...(outcome.mechanism === "junction" ? { linkMechanism: outcome.mechanism } : {})
          }, timestamp));
        }
      } catch (error) {
        summary.failed.push({ skillId: record.id, reason: formatInstallError(error, options.method) });
      }
    }

    return summary;
  }
}
