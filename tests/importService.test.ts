import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillImportService } from "../src/importService";
import { runNpxSkillsAdd, validateNpxSkillsCommand } from "../src/localImport";
import { createEmptySkillHubData, SkillRegistry } from "../src/registry";
import { DEFAULT_SETTINGS } from "../src/settings";
import { discoverSkills } from "../src/skillDiscovery";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function createStagedSkill(folderName: string, content: string): Promise<string> {
  const stagingPath = await mkdtemp(join(tmpdir(), "skillhub-import-staging-"));
  temporaryDirectories.push(stagingPath);
  const skillPath = join(stagingPath, "skills", folderName);
  await mkdir(skillPath, { recursive: true });
  await writeFile(join(skillPath, "SKILL.md"), content, { encoding: "utf8", flush: true });
  return stagingPath;
}

describe("SkillImportService", () => {
  it("copies a selected skill into Skill and preserves its source files", async () => {
    const stagingPath = await createStagedSkill("writer", "---\nname: Writer\ndescription: Drafts prose\n---\n");
    const vaultPath = await mkdtemp(join(tmpdir(), "skillhub-vault-"));
    temporaryDirectories.push(vaultPath);
    const discovered = await discoverSkills(stagingPath);
    const registry = new SkillRegistry(createEmptySkillHubData());
    const service = new SkillImportService(registry, DEFAULT_SETTINGS);

    const result = await service.importDiscoveredSkills(discovered.skills, {
      vaultPath,
      source: { type: "local", path: stagingPath },
      importMethod: "local"
    });

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]).toMatchObject({
      folderName: "writer",
      vaultPath: "Skill/writer",
      originalName: "Writer",
      nickname: "Writer",
      description: "Drafts prose",
      source: { type: "local", path: stagingPath },
      importMethod: "local"
    });
    await expect(readFile(join(vaultPath, "Skill", "writer", "SKILL.md"), "utf8")).resolves.toBe(
      "---\nname: Writer\ndescription: Drafts prose\n---\n"
    );
  });

  it("uses a collision-safe folder name and records skill_imported", async () => {
    const stagingPath = await createStagedSkill("writer", "---\nname: Writer\ndescription: Drafts prose\n---\n");
    const vaultPath = await mkdtemp(join(tmpdir(), "skillhub-vault-"));
    temporaryDirectories.push(vaultPath);
    await mkdir(join(vaultPath, "Skill", "writer"), { recursive: true });
    await writeFile(join(vaultPath, "Skill", "writer", "existing.txt"), "existing", { encoding: "utf8", flush: true });
    const discovered = await discoverSkills(stagingPath);
    const registry = new SkillRegistry(createEmptySkillHubData());
    const service = new SkillImportService(registry, DEFAULT_SETTINGS);

    const result = await service.importDiscoveredSkills(discovered.skills, {
      vaultPath,
      source: { type: "local", path: stagingPath },
      importMethod: "local"
    });

    expect(result.imported[0]?.folderName).toBe("writer-2");
    expect(registry.data.events).toHaveLength(1);
    expect(registry.data.events[0]).toMatchObject({ type: "skill_imported", skillId: result.imported[0]?.id });
  });

  it("cleans a temporary staging folder after import", async () => {
    const stagingPath = await createStagedSkill("writer", "---\nname: Writer\ndescription: Drafts prose\n---\n");
    const vaultPath = await mkdtemp(join(tmpdir(), "skillhub-vault-"));
    temporaryDirectories.push(vaultPath);
    const discovered = await discoverSkills(stagingPath);
    const service = new SkillImportService(new SkillRegistry(createEmptySkillHubData()), DEFAULT_SETTINGS);

    await service.importDiscoveredSkills(discovered.skills, {
      vaultPath,
      source: { type: "local", path: stagingPath },
      importMethod: "local",
      stagingPath
    });

    await expect(access(stagingPath)).rejects.toThrow();
    temporaryDirectories.splice(temporaryDirectories.indexOf(stagingPath), 1);
  });
});

describe("validateNpxSkillsCommand", () => {
  it("accepts npx skills add owner/repo", () => {
    expect(validateNpxSkillsCommand("npx skills add owner/repo")).toBe(true);
  });

  it("rejects non-npx and non-skills commands", () => {
    expect(validateNpxSkillsCommand("npm skills add owner/repo")).toBe(false);
    expect(validateNpxSkillsCommand("npx other add owner/repo")).toBe(false);
  });
});

describe("runNpxSkillsAdd", () => {
  it("runs a validated command inside a staging directory below cwd", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "skillhub-npx-root-"));
    temporaryDirectories.push(cwd);
    const calls: Array<{ file: string; args: string[]; cwd?: string }> = [];

    const stagingPath = await runNpxSkillsAdd("npx skills add owner/repo", cwd, async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd });
    });

    expect(stagingPath.startsWith(cwd)).toBe(true);
    expect(calls).toEqual([{ file: "npx", args: ["skills", "add", "owner/repo"], cwd: stagingPath }]);
  });
});
