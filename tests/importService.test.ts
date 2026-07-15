import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillImportService } from "../src/importService";
import { isNpxAvailable, normalizeNpxSkillsCommand, runNpxSkillsAdd, validateNpxSkillsCommand } from "../src/localImport";
import { createEmptySkillHubData, SkillRegistry } from "../src/registry";
import { DEFAULT_SETTINGS } from "../src/settingsDefaults";
import { discoverSkills } from "../src/skillDiscovery";

const temporaryDirectories: string[] = [];
const cleanupFailure = vi.hoisted(() => ({ pathIncludes: "", remaining: 0 }));

vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  return {
    ...actual,
    rm: async (path: Parameters<typeof actual.rm>[0], options: Parameters<typeof actual.rm>[1]) => {
      if (cleanupFailure.remaining > 0 && String(path).includes(cleanupFailure.pathIncludes)) {
        cleanupFailure.remaining -= 1;
        throw new Error("cleanup failed");
      }
      return actual.rm(path, options);
    }
  };
});

afterEach(async () => {
  cleanupFailure.pathIncludes = "";
  cleanupFailure.remaining = 0;
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
  it.each(["../outside", "/tmp/outside", "C:\\outside"])("rejects unsafe configured skill folder %j", async (skillFolder) => {
    const stagingPath = await createStagedSkill("writer", "---\nname: Writer\ndescription: Drafts prose\n---\n");
    const vaultPath = await mkdtemp(join(tmpdir(), "skillhub-vault-"));
    temporaryDirectories.push(vaultPath);
    const discovered = await discoverSkills(stagingPath);
    const service = new SkillImportService(new SkillRegistry(createEmptySkillHubData()), { ...DEFAULT_SETTINGS, skillFolder });

    await expect(service.importDiscoveredSkills(discovered.skills, {
      vaultPath,
      source: { type: "local", path: stagingPath },
      importMethod: "local"
    })).rejects.toThrow(/vault-relative/i);
  });

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

  it("rolls back copied folders and metadata when a later copy fails", async () => {
    const stagingPath = await createStagedSkill("writer", "---\nname: Writer\ndescription: Drafts prose\n---\n");
    const vaultPath = await mkdtemp(join(tmpdir(), "skillhub-vault-"));
    temporaryDirectories.push(vaultPath);
    const discovered = await discoverSkills(stagingPath);
    const registry = new SkillRegistry(createEmptySkillHubData());
    const service = new SkillImportService(registry, DEFAULT_SETTINGS);

    await expect(service.importDiscoveredSkills([
      discovered.skills[0],
      { ...discovered.skills[0], folderName: "missing", path: join(stagingPath, "skills", "missing") }
    ], {
      vaultPath,
      source: { type: "local", path: stagingPath },
      importMethod: "local"
    })).rejects.toThrow();

    await expect(access(join(vaultPath, "Skill", "writer"))).rejects.toThrow();
    expect(registry.data.skills).toEqual({});
    expect(registry.data.events).toEqual([]);
  });

  it("rolls back copied folders and metadata when persistence fails", async () => {
    const stagingPath = await createStagedSkill("writer", "---\nname: Writer\ndescription: Drafts prose\n---\n");
    const vaultPath = await mkdtemp(join(tmpdir(), "skillhub-vault-"));
    temporaryDirectories.push(vaultPath);
    const discovered = await discoverSkills(stagingPath);
    const registry = new SkillRegistry(createEmptySkillHubData());
    const service = new SkillImportService(registry, DEFAULT_SETTINGS);

    await expect(service.importDiscoveredSkills(discovered.skills, {
      vaultPath,
      source: { type: "local", path: stagingPath },
      importMethod: "local",
      persist: async () => { throw new Error("save failed"); }
    })).rejects.toThrow("save failed");

    await expect(access(join(vaultPath, "Skill", "writer"))).rejects.toThrow();
    expect(registry.data.skills).toEqual({});
    expect(registry.data.events).toEqual([]);
  });

  it("retains metadata and reports rollback cleanup failures", async () => {
    const stagingPath = await createStagedSkill("writer", "---\nname: Writer\ndescription: Drafts prose\n---\n");
    const vaultPath = await mkdtemp(join(tmpdir(), "skillhub-vault-"));
    temporaryDirectories.push(vaultPath);
    const discovered = await discoverSkills(stagingPath);
    const registry = new SkillRegistry(createEmptySkillHubData());
    const service = new SkillImportService(registry, DEFAULT_SETTINGS);
    cleanupFailure.pathIncludes = join("Skill", "writer");
    cleanupFailure.remaining = 1;

    await expect(service.importDiscoveredSkills(discovered.skills, {
      vaultPath,
      source: { type: "local", path: stagingPath },
      importMethod: "local",
      persist: async () => { throw new Error("save failed"); }
    })).rejects.toThrow(/save failed.*rollback cleanup failed/i);

    expect(Object.values(registry.data.skills).map((record) => record.folderName)).toEqual(["writer"]);
    expect(Object.values(registry.data.skills)[0]).toMatchObject({ vaultPath: "Skill/writer" });
    expect(registry.data.events).toHaveLength(1);
    await expect(access(join(vaultPath, "Skill", "writer"))).resolves.toBeUndefined();
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

  it.each([
    "npx skills add owner/repo --global",
    "npx skills add owner/repo -g"
  ])("rejects global installation command %j", (command) => {
    expect(validateNpxSkillsCommand(command)).toBe(false);
    expect(() => normalizeNpxSkillsCommand(command)).toThrow(/global/i);
  });

  it("appends deterministic project-scoped import flags", () => {
    expect(normalizeNpxSkillsCommand("npx skills add owner/repo")).toEqual([
      "skills", "add", "owner/repo", "--agent", "codex", "--skill", "*", "--yes", "--copy"
    ]);
  });

  it("preserves requested skills and parses quoted names", () => {
    expect(normalizeNpxSkillsCommand('npx skills add owner/repo --skill "Convex Best Practices" --agent codex -y --copy')).toEqual([
      "skills", "add", "owner/repo", "--skill", "Convex Best Practices", "--agent", "codex", "-y", "--copy"
    ]);
  });

  it("adds codex when another agent target does not guarantee .agents/skills output", () => {
    expect(normalizeNpxSkillsCommand("npx skills add owner/repo --agent claude-code --all --yes --copy")).toEqual([
      "skills", "add", "owner/repo", "--agent", "claude-code", "--all", "--yes", "--copy", "--agent", "codex"
    ]);
  });
});

describe("runNpxSkillsAdd", () => {
  it("finds npx through the user shell when direct lookup is unavailable", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];

    await expect(isNpxAvailable(async (file, args) => {
      calls.push({ file, args });
      if (file === "npx") throw Object.assign(new Error("not found"), { code: "ENOENT" });
      return { stdout: "/Users/me/.nvm/versions/node/v22/bin/npx\n" };
    })).resolves.toBe(true);

    expect(calls).toEqual([
      { file: "npx", args: ["--version"] },
      { file: process.env.SHELL ?? "/bin/sh", args: ["-lc", "command -v npx"] },
      { file: "/Users/me/.nvm/versions/node/v22/bin/npx", args: ["--version"] }
    ]);
  });

  it("runs npx imports through the shell-resolved executable when direct lookup is unavailable", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "skillhub-npx-root-"));
    temporaryDirectories.push(cwd);
    const calls: Array<{ file: string; args: string[]; cwd?: string }> = [];

    await runNpxSkillsAdd("npx skills add owner/repo", cwd, async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd });
      if (file === "npx") throw Object.assign(new Error("not found"), { code: "ENOENT" });
      if (file === (process.env.SHELL ?? "/bin/sh")) return { stdout: "/Users/me/.nvm/versions/node/v22/bin/npx\n" };
      return undefined;
    });

    expect(calls.at(-1)).toMatchObject({
      file: "/Users/me/.nvm/versions/node/v22/bin/npx",
      args: ["skills", "add", "owner/repo", "--agent", "codex", "--skill", "*", "--yes", "--copy"]
    });
  });

  it("runs a validated command inside a staging directory below cwd", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "skillhub-npx-root-"));
    temporaryDirectories.push(cwd);
    const calls: Array<{ file: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv }> = [];

    const stagingPath = await runNpxSkillsAdd("npx skills add owner/repo", cwd, async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd, env: options.env });
    });

    expect(stagingPath.startsWith(cwd)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ file: "npx", args: ["--version"] });
    expect(calls[1]).toMatchObject({
      file: "npx",
      args: ["skills", "add", "owner/repo", "--agent", "codex", "--skill", "*", "--yes", "--copy"],
      cwd: stagingPath,
      env: { DO_NOT_TRACK: "1", DISABLE_TELEMETRY: "1", CI: "1", PATH: process.env.PATH }
    });
  });

  it("removes the staging directory when npx rejects", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "skillhub-npx-root-"));
    temporaryDirectories.push(cwd);
    let stagingPath: string | undefined;
    const error = new Error("npx failed");

    await expect(
      runNpxSkillsAdd("npx skills add owner/repo", cwd, async (_file, _args, options) => {
        stagingPath = options.cwd;
        if (!options.cwd) return undefined;
        throw error;
      })
    ).rejects.toBe(error);

    expect(stagingPath).toBeDefined();
    await expect(access(stagingPath as string)).rejects.toThrow();
  });

  it("reports both the npx error and staging cleanup failure", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "skillhub-npx-root-"));
    temporaryDirectories.push(cwd);
    const error = new Error("npx failed");
    cleanupFailure.pathIncludes = ".skillhub-npx-import-";
    cleanupFailure.remaining = 1;

    await expect(
      runNpxSkillsAdd("npx skills add owner/repo", cwd, async (_file, _args, options) => {
        if (!options.cwd) return undefined;
        throw error;
      })
    ).rejects.toThrow(/npx failed.*staging cleanup failed/i);
  });
});
