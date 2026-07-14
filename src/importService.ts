import { access, cp, mkdir, rm } from "fs/promises";
import { join } from "path";
import { createSkillEvent } from "./events";
import { SkillRegistry } from "./registry";
import type { DiscoveredSkill } from "./skillDiscovery";
import type { SkillHubSettings, SkillRecord, SkillSource } from "./types";

export interface ImportOptions {
  vaultPath: string;
  source: SkillSource;
  importMethod: SkillRecord["importMethod"];
  stagingPath?: string;
}

export interface ImportResult {
  imported: SkillRecord[];
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
    const destinationRoot = join(options.vaultPath, this.settings.skillFolder);
    const imported: SkillRecord[] = [];

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
        const destination = join(destinationRoot, folderName);
        await cp(skill.path, destination, { recursive: true });

        const timestamp = new Date().toISOString();
        const record: SkillRecord = {
          id: `${folderName}-${Math.random().toString(36).slice(2, 10)}`,
          folderName,
          vaultPath: join(this.settings.skillFolder, folderName),
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
        this.registry.upsertSkill(record);
        this.registry.recordEvent(createSkillEvent("skill_imported", record.id, { method: options.importMethod }, timestamp));
        imported.push(record);
      }

      return { imported };
    } finally {
      if (options.stagingPath) await rm(options.stagingPath, { force: true, recursive: true }).catch(() => undefined);
    }
  }
}
