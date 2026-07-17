import { access, cp, mkdir, rm } from "fs/promises";
import { join, relative, sep } from "path";
import { combineErrors } from "./errors";
import { createSkillEvent } from "./events";
import { SkillRegistry } from "./registry";
import type { DiscoveredSkill } from "./skillDiscovery";
import type { SkillHubSettings, SkillRecord, SkillSource } from "./types";
import { resolveVaultRelativePath } from "./vaultPaths";

export interface ImportOptions {
  vaultPath: string;
  source: SkillSource;
  importMethod: SkillRecord["importMethod"];
  stagingPath?: string;
  persist?: () => Promise<void>;
}

export interface ImportResult {
  imported: SkillRecord[];
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function createCollisionSafeFolderName(
  baseName: string,
  exists: (folderName: string) => Promise<boolean>
): Promise<string> {
  if (!(await exists(baseName))) return baseName;

  let suffix = 2;
  while (await exists(`${baseName}-${suffix}`)) suffix += 1;
  return `${baseName}-${suffix}`;
}

export class SkillImportService {
  constructor(
    private readonly registry: SkillRegistry,
    private readonly settings: SkillHubSettings
  ) {}

  async importDiscoveredSkills(discovered: DiscoveredSkill[], options: ImportOptions): Promise<ImportResult> {
    const destinationRoot = await resolveVaultRelativePath(options.vaultPath, this.settings.skillFolder, { verifyFilesystem: true });
    const imported: SkillRecord[] = [];
    const copyAttempts: Array<{ destination: string; record: SkillRecord }> = [];
    const eventsStart = this.registry.data.events.length;
    let operationError: unknown;

    try {
      await mkdir(destinationRoot, { recursive: true });
      for (const skill of discovered) {
        const folderName = await createCollisionSafeFolderName(skill.folderName, async (candidate) => {
          try {
            await access(join(destinationRoot, candidate));
            return true;
          } catch {
            return false;
          }
        });
        const vaultRelativePath = join(this.settings.skillFolder, folderName);
        const destination = await resolveVaultRelativePath(options.vaultPath, vaultRelativePath, { verifyFilesystem: true });
        const timestamp = new Date().toISOString();
        const record: SkillRecord = {
          id: `${folderName}-${Math.random().toString(36).slice(2, 10)}`,
          folderName,
          vaultPath: relative(options.vaultPath, destination).split(sep).join("/"),
          originalName: skill.metadata.name,
          nickname: skill.metadata.name,
          description: skill.metadata.description,
          tags: [],
          collectionIds: [],
          source: options.source,
          importMethod: options.importMethod,
          warnings: skill.warnings,
          importedAt: timestamp,
          updatedAt: timestamp,
          installCount: 0
        };
        copyAttempts.push({ destination, record });
        await cp(skill.path, destination, { recursive: true, force: false, errorOnExist: true });
        imported.push(record);
      }

      for (const record of imported) {
        this.registry.upsertSkill(record);
        this.registry.recordEvent(createSkillEvent("skill_imported", record.id, { method: options.importMethod }, record.importedAt));
      }
      await options.persist?.();

      return { imported };
    } catch (error) {
      const cleanupFailures: Array<{ record: SkillRecord; error: unknown }> = [];
      for (const attempt of copyAttempts) {
        try {
          await rm(attempt.destination, { force: true, recursive: true });
        } catch (cleanupError) {
          cleanupFailures.push({ record: attempt.record, error: cleanupError });
        }
      }

      for (const record of imported) this.registry.deleteSkill(record.id);
      this.registry.data.events.splice(eventsStart);
      operationError = error;

      if (cleanupFailures.length > 0) {
        for (const failure of cleanupFailures) {
          this.registry.upsertSkill(failure.record);
          this.registry.recordEvent(createSkillEvent(
            "skill_imported",
            failure.record.id,
            { method: options.importMethod, rollbackCleanupFailed: true },
            failure.record.importedAt
          ));
        }
        operationError = combineErrors(
          operationError,
          cleanupFailures.map((failure) => failure.error instanceof Error ? failure.error.message : String(failure.error)).join("; "),
          "rollback cleanup failed"
        );
        if (options.persist) {
          try {
            await options.persist();
          } catch (persistError) {
            operationError = combineErrors(operationError, persistError, "retained metadata persistence failed");
          }
        }
      }

      const importError = toError(operationError);
      throw importError;
    } finally {
      if (options.stagingPath) {
        try {
          await rm(options.stagingPath, { force: true, recursive: true });
        } catch (cleanupError) {
          const cleanupCombinedError = operationError
            ? combineErrors(operationError, cleanupError, "staging cleanup failed")
            : combineErrors("Import completed", cleanupError, "staging cleanup failed");
          await Promise.reject(cleanupCombinedError);
        }
      }
    }
  }
}
