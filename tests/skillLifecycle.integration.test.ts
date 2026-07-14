import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillExportService } from "../src/exportService";
import { SkillImportService } from "../src/importService";
import { createEmptySkillHubData, SkillRegistry } from "../src/registry";
import { DEFAULT_SETTINGS } from "../src/settingsDefaults";
import { discoverSkills } from "../src/skillDiscovery";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("skill lifecycle integration", () => {
  it("discovers, imports, and exports a skill while recording import and install events", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "skillhub-lifecycle-source-"));
    const vaultPath = await mkdtemp(join(tmpdir(), "skillhub-lifecycle-vault-"));
    const targetPath = await mkdtemp(join(tmpdir(), "skillhub-lifecycle-target-"));
    temporaryDirectories.push(sourcePath, vaultPath, targetPath);
    await mkdir(join(sourcePath, "skills", "writer"), { recursive: true });
    await writeFile(
      join(sourcePath, "skills", "writer", "SKILL.md"),
      "---\nname: Writer\ndescription: Drafts prose\n---\n",
      "utf8"
    );

    const discovered = await discoverSkills(sourcePath);
    const registry = new SkillRegistry(createEmptySkillHubData());
    const imported = await new SkillImportService(registry, DEFAULT_SETTINGS).importDiscoveredSkills(discovered.skills, {
      vaultPath,
      source: { type: "local", path: sourcePath },
      importMethod: "local"
    });

    await new SkillExportService(registry).installSkills(imported.imported, targetPath, {
      vaultPath,
      method: "copy",
      conflictBehavior: "skip"
    });

    await expect(readFile(join(vaultPath, "Skill", "writer", "SKILL.md"), "utf8")).resolves.toContain("name: Writer");
    await expect(readFile(join(targetPath, ".agents", "skills", "writer", "SKILL.md"), "utf8")).resolves.toContain("name: Writer");
    expect(registry.data.events.map((event) => event.type)).toEqual(["skill_imported", "skill_installed"]);
  });
});
