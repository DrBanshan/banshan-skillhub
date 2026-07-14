import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillExportService } from "../src/exportService";
import { createEmptySkillHubData, SkillRegistry } from "../src/registry";
import type { SkillRecord } from "../src/types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function createVaultSkill(folderName: string, content = "skill contents"): Promise<{ vaultPath: string; record: SkillRecord }> {
  const vaultPath = await mkdtemp(join(tmpdir(), "skillhub-export-vault-"));
  temporaryDirectories.push(vaultPath);
  const skillPath = join(vaultPath, "Skill", folderName);
  await mkdir(skillPath, { recursive: true });
  await writeFile(join(skillPath, "SKILL.md"), content, "utf8");

  return {
    vaultPath,
    record: {
      id: `${folderName}-id`,
      folderName,
      vaultPath: join("Skill", folderName),
      originalName: folderName,
      nickname: folderName,
      description: "Test skill",
      tags: [],
      collectionIds: [],
      source: { type: "local", path: vaultPath },
      importMethod: "local",
      warnings: [],
      importedAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      installCount: 0
    }
  };
}

async function createTargetDirectory(): Promise<string> {
  const targetPath = await mkdtemp(join(tmpdir(), "skillhub-export-target-"));
  temporaryDirectories.push(targetPath);
  return targetPath;
}

function createService(record: SkillRecord): { service: SkillExportService; registry: SkillRegistry } {
  const registry = new SkillRegistry(createEmptySkillHubData());
  registry.upsertSkill(record);
  return { service: new SkillExportService(registry), registry };
}

describe("SkillExportService", () => {
  it("creates .agents/skills and symlinks selected vault skills", async () => {
    const { vaultPath, record } = await createVaultSkill("writer");
    const targetPath = await createTargetDirectory();
    const { service, registry } = createService(record);

    const summary = await service.installSkills([record], targetPath, {
      vaultPath,
      method: "symlink",
      conflictBehavior: "skip"
    });

    const destination = join(targetPath, ".agents", "skills", "writer");
    expect(summary).toMatchObject({ installed: [record.id], skipped: [], replaced: [], failed: [] });
    expect((await lstat(destination)).isSymbolicLink()).toBe(true);
    expect(await readlink(destination)).toBe(join(vaultPath, record.vaultPath));
    expect(registry.data.skills[record.id]).toMatchObject({ installCount: 1, lastInstalledAt: expect.any(String) });
  });

  it("copies selected vault skills in copy mode", async () => {
    const { vaultPath, record } = await createVaultSkill("writer", "copied contents");
    const targetPath = await createTargetDirectory();
    const { service, registry } = createService(record);

    const summary = await service.installSkills([record], targetPath, {
      vaultPath,
      method: "copy",
      conflictBehavior: "replace-symlinks"
    });

    const destination = join(targetPath, ".agents", "skills", "writer");
    expect(summary).toMatchObject({ installed: [record.id], skipped: [], replaced: [], failed: [] });
    expect((await lstat(destination)).isDirectory()).toBe(true);
    expect((await lstat(destination)).isSymbolicLink()).toBe(false);
    await expect(readFile(join(destination, "SKILL.md"), "utf8")).resolves.toBe("copied contents");
    expect(registry.data.skills[record.id]?.installCount).toBe(1);
  });

  it("skips existing real folders and files without overwriting them", async () => {
    const { vaultPath, record } = await createVaultSkill("writer");
    const targetPath = await createTargetDirectory();
    const destinationRoot = join(targetPath, ".agents", "skills");
    await mkdir(join(destinationRoot, record.folderName), { recursive: true });
    await writeFile(join(destinationRoot, record.folderName, "preserve.txt"), "folder", "utf8");
    const { service, registry } = createService(record);

    const folderSummary = await service.installSkills([record], targetPath, {
      vaultPath,
      method: "symlink",
      conflictBehavior: "replace-symlinks"
    });

    await rm(join(destinationRoot, record.folderName), { force: true, recursive: true });
    await writeFile(join(destinationRoot, record.folderName), "file", "utf8");
    const fileSummary = await service.installSkills([record], targetPath, {
      vaultPath,
      method: "copy",
      conflictBehavior: "replace-symlinks"
    });

    expect(folderSummary).toMatchObject({ installed: [], skipped: [record.id], replaced: [], failed: [] });
    expect(fileSummary).toMatchObject({ installed: [], skipped: [record.id], replaced: [], failed: [] });
    await expect(readFile(join(destinationRoot, record.folderName), "utf8")).resolves.toBe("file");
    expect(registry.data.skills[record.id]?.installCount).toBe(0);
  });

  it("replaces existing symlinks only for symlink installs using replace-symlinks", async () => {
    const { vaultPath, record } = await createVaultSkill("writer");
    const targetPath = await createTargetDirectory();
    const stalePath = await mkdtemp(join(tmpdir(), "skillhub-export-stale-"));
    temporaryDirectories.push(stalePath);
    const destination = join(targetPath, ".agents", "skills", record.folderName);
    await mkdir(join(targetPath, ".agents", "skills"), { recursive: true });
    await symlink(stalePath, destination, "dir");
    const { service, registry } = createService(record);

    const skipped = await service.installSkills([record], targetPath, {
      vaultPath,
      method: "symlink",
      conflictBehavior: "skip"
    });
    const replaced = await service.installSkills([record], targetPath, {
      vaultPath,
      method: "symlink",
      conflictBehavior: "replace-symlinks"
    });
    const copySkipped = await service.installSkills([record], targetPath, {
      vaultPath,
      method: "copy",
      conflictBehavior: "replace-symlinks"
    });

    expect(skipped).toMatchObject({ installed: [], skipped: [record.id], replaced: [], failed: [] });
    expect(replaced).toMatchObject({ installed: [], skipped: [], replaced: [record.id], failed: [] });
    expect(copySkipped).toMatchObject({ installed: [], skipped: [record.id], replaced: [], failed: [] });
    expect(await readlink(destination)).toBe(join(vaultPath, record.vaultPath));
    expect(registry.data.skills[record.id]?.installCount).toBe(1);
  });
});
