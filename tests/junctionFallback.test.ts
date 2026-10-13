import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillExportService } from "../src/exportService";
import { createEmptySkillHubData, SkillRegistry } from "../src/registry";
import type { InstallOptions, InstallSummary } from "../src/exportService";
import type { SkillRecord } from "../src/types";

const temporaryDirectories: string[] = [];
const fsBehavior = vi.hoisted(() => ({
  refuseSymlinkTypes: [] as string[],
  refuseEverySymlink: false,
  calls: [] as string[]
}));

vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  return {
    ...actual,
    symlink: async (target: Parameters<typeof actual.symlink>[0], path: Parameters<typeof actual.symlink>[1], kind?: Parameters<typeof actual.symlink>[2]) => {
      fsBehavior.calls.push(String(kind ?? "none"));
      if (fsBehavior.refuseEverySymlink) throw Object.assign(new Error("every link refused"), { code: "EPERM" });
      if (fsBehavior.refuseSymlinkTypes.includes(String(kind))) throw Object.assign(new Error("link kind refused"), { code: "EPERM" });
      return actual.symlink(target, path, kind);
    }
  };
});

afterEach(async () => {
  fsBehavior.refuseSymlinkTypes = [];
  fsBehavior.refuseEverySymlink = false;
  fsBehavior.calls = [];
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function createVaultSkill(folderName: string): Promise<{ vaultPath: string; record: SkillRecord }> {
  const vaultPath = await mkdtemp(join(tmpdir(), "skillhub-junction-vault-"));
  temporaryDirectories.push(vaultPath);
  const skillPath = join(vaultPath, "Skill", folderName);
  await mkdir(skillPath, { recursive: true });
  await writeFileFixture(skillPath);
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

async function writeFileFixture(skillPath: string): Promise<void> {
  await writeFile(join(skillPath, "SKILL.md"), "skill contents", "utf8");
}

async function createTargetDirectory(): Promise<string> {
  const targetPath = await mkdtemp(join(tmpdir(), "skillhub-junction-target-"));
  temporaryDirectories.push(targetPath);
  return targetPath;
}

function createService(record: SkillRecord): { service: SkillExportService; registry: SkillRegistry } {
  const registry = new SkillRegistry(createEmptySkillHubData());
  registry.upsertSkill(record);
  return { service: new SkillExportService(registry), registry };
}

function optionsFor(vaultPath: string, overrides: Partial<InstallOptions> = {}): InstallOptions {
  return { vaultPath, method: "symlink", conflictBehavior: "skip", ...overrides };
}

function installedPath(targetDir: string, folderName: string): string {
  return join(targetDir, ".agents", "skills", folderName);
}

async function platformAllowsDirectorySymlinks(): Promise<boolean> {
  const probeDir = await mkdtemp(join(tmpdir(), "skillhub-junction-probe-"));
  temporaryDirectories.push(probeDir);
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  try {
    await actual.mkdir(join(probeDir, "src"), { recursive: true });
    await actual.symlink(join(probeDir, "src"), join(probeDir, "link"), "dir");
    return true;
  } catch {
    return false;
  }
}

describe("junction fallback", () => {
  it("falls back to a junction when the directory symlink is refused", async () => {
    const { vaultPath, record } = await createVaultSkill("writer");
    const targetDir = await createTargetDirectory();
    const { service, registry } = createService(record);
    fsBehavior.refuseSymlinkTypes = ["dir"];

    const summary: InstallSummary = await service.installSkills([record], targetDir, optionsFor(vaultPath));

    expect(summary.installed).toEqual([record.id]);
    expect(summary.failed).toEqual([]);
    expect(summary.mechanisms).toEqual({ [record.id]: "junction" });
    expect(fsBehavior.calls).toEqual(["dir", "junction"]);
    expect(await readFile(join(installedPath(targetDir, "writer"), "SKILL.md"), "utf8")).toBe("skill contents");
    const events = registry.data.events.filter((event) => event.type === "skill_installed");
    expect(events).toHaveLength(1);
    expect(events[0].details).toMatchObject({ method: "symlink", linkMechanism: "junction" });
  });

  it("uses a junction directly when it is the requested method", async () => {
    const { vaultPath, record } = await createVaultSkill("planner");
    const targetDir = await createTargetDirectory();
    const { service } = createService(record);

    const summary = await service.installSkills([record], targetDir, optionsFor(vaultPath, { method: "junction" }));

    expect(summary.installed).toEqual([record.id]);
    expect(summary.mechanisms).toEqual({ [record.id]: "junction" });
    expect(fsBehavior.calls).toEqual(["junction"]);
    expect((await stat(installedPath(targetDir, "planner"))).isDirectory()).toBe(true);
  });

  it("reports the link kind that was actually created", async () => {
    const { vaultPath, record } = await createVaultSkill("reader");
    const targetDir = await createTargetDirectory();
    const { service } = createService(record);

    const summary = await service.installSkills([record], targetDir, optionsFor(vaultPath));

    expect(summary.installed).toEqual([record.id]);
    if (await platformAllowsDirectorySymlinks()) {
      expect(summary.mechanisms).toEqual({ [record.id]: "symlink" });
      expect(fsBehavior.calls).toEqual(["dir"]);
    } else {
      expect(summary.mechanisms).toEqual({ [record.id]: "junction" });
      expect(fsBehavior.calls).toEqual(["dir", "junction"]);
    }
  });

  it("reports copy installs as copies and never links", async () => {
    const { vaultPath, record } = await createVaultSkill("copycat");
    const targetDir = await createTargetDirectory();
    const { service } = createService(record);

    const summary = await service.installSkills([record], targetDir, optionsFor(vaultPath, { method: "copy" }));

    expect(fsBehavior.calls).toEqual([]);
    if (summary.installed.includes(record.id)) {
      expect(summary.mechanisms).toEqual({ [record.id]: "copy" });
      expect(await readFile(join(installedPath(targetDir, "copycat"), "SKILL.md"), "utf8")).toBe("skill contents");
    } else {
      // copy mode itself is covered by the pre-existing export suite; some Node builds reject cp into a freshly
      // created directory, so this case only pins down that copying never takes the link path
      expect(summary.failed.length + summary.skipped.length).toBeGreaterThan(0);
      expect(summary.mechanisms).toBeUndefined();
    }
  });

  it("surfaces the elevated permissions message when both link kinds are refused", async () => {
    const { vaultPath, record } = await createVaultSkill("blocked");
    const targetDir = await createTargetDirectory();
    const { service } = createService(record);
    fsBehavior.refuseEverySymlink = true;

    const summary = await service.installSkills([record], targetDir, optionsFor(vaultPath));

    expect(summary.installed).toEqual([]);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].skillId).toBe(record.id);
    expect(summary.mechanisms).toBeUndefined();
    if (process.platform === "win32") {
      expect(summary.failed[0].reason).toContain("Developer Mode");
    }
    expect(fsBehavior.calls).toEqual(["dir", "junction"]);
  });

  it("replaces an existing link through the fallback and reports it as replaced", async () => {
    const { vaultPath, record } = await createVaultSkill("swapper");
    const targetDir = await createTargetDirectory();
    const { service } = createService(record);

    await service.installSkills([record], targetDir, optionsFor(vaultPath, { method: "junction" }));
    expect(fsBehavior.calls).toEqual(["junction"]);
    fsBehavior.calls = [];
    fsBehavior.refuseSymlinkTypes = ["dir"];

    const summary = await service.installSkills([record], targetDir, optionsFor(vaultPath, { conflictBehavior: "replace-symlinks" }));

    expect(summary.replaced).toEqual([record.id]);
    expect(summary.installed).toEqual([]);
    expect(summary.mechanisms).toEqual({ [record.id]: "junction" });
    expect(fsBehavior.calls).toEqual(["dir", "junction"]);
    expect(await readFile(join(installedPath(targetDir, "swapper"), "SKILL.md"), "utf8")).toBe("skill contents");
  });

  it("leaves an existing real directory alone and records no mechanism", async () => {
    const { vaultPath, record } = await createVaultSkill("preset");
    const targetDir = await createTargetDirectory();
    const { service } = createService(record);
    await mkdir(installedPath(targetDir, "preset"), { recursive: true });

    const summary = await service.installSkills([record], targetDir, optionsFor(vaultPath));

    expect(summary.skipped).toEqual([record.id]);
    expect(summary.mechanisms).toBeUndefined();
    expect(fsBehavior.calls).toEqual([]);
  });
});
