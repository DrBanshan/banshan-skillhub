// Exercises the uninstall plan the command line runs, against a real filesystem: real installs through
// SkillExportService, real inspection, real removal. This is where the promise that uninstalling can never
// harm the vault side source gets pinned down, so it drives the same applyUninstallPlan the plugin calls
// instead of a reimplementation of it.

import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectDestination, SkillExportService } from "../src/exportService";
import { createEmptySkillHubData, SkillRegistry } from "../src/registry";
import { applyUninstallPlan, type UninstallCandidate } from "../src/cli";
import type { SkillRecord } from "../src/types";

interface Fixture {
  vaultPath: string;
  target: string;
  exportService: SkillExportService;
  destination: string;
  record: SkillRecord;
}

function writerRecord(): SkillRecord {
  return {
    id: "writer",
    folderName: "writer",
    vaultPath: ".skills/writer",
    originalName: "writer",
    nickname: "writer",
    description: "writes",
    tags: [],
    collectionIds: ["bundle"],
    source: { type: "local", path: "fixture" },
    importMethod: "local",
    warnings: [],
    importedAt: "1",
    updatedAt: "2",
    installCount: 0
  };
}

async function makeFixture(): Promise<Fixture> {
  const vaultPath = await mkdtemp(join(tmpdir(), "cli-uninstall-vault-XXXXXX"));
  const target = await mkdtemp(join(tmpdir(), "cli-uninstall-target-XXXXXX"));
  await mkdir(join(vaultPath, ".skills", "writer"), { recursive: true });
  await writeFile(join(vaultPath, ".skills", "writer", "SKILL.md"), "---\nname: writer\n---\n\nbody\n", "utf8");
  const record = writerRecord();
  const data = createEmptySkillHubData();
  data.skills.writer = record;
  const registry = new SkillRegistry(data);
  return {
    vaultPath,
    target,
    exportService: new SkillExportService(registry),
    destination: join(target, ".agents", "skills", "writer"),
    record
  };
}

// <target>/.agents/skills/<name> back to <target>
function targetOf(destination: string): string {
  return join(destination, "..", "..", "..");
}

async function installInto(fixture: Fixture, method: "symlink" | "copy"): Promise<Fixture> {
  await fixture.exportService.installSkills([fixture.record], targetOf(fixture.destination), {
    vaultPath: fixture.vaultPath,
    method,
    conflictBehavior: "replace-symlinks"
  });
  return fixture;
}

function candidate(destination: string, method: string, proven: boolean): UninstallCandidate {
  return { key: "writer", label: "writer", destination, method, proven };
}

async function removeEntry(removal: UninstallCandidate): Promise<void> {
  if (removal.method === "copy") await rm(removal.destination, { recursive: true, force: true });
  else await unlink(removal.destination);
}

async function pathPresent(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    try {
      await readFile(path, "utf8");
      return true;
    } catch {
      return false;
    }
  }
}

describe("uninstall plan against a real filesystem", () => {
  it("removes a link install while the vault side skill source keeps its contents", async () => {
    const fixture = await installInto(await makeFixture(), "symlink");
    expect(await pathPresent(fixture.destination)).toBe(true);

    const plan = await applyUninstallPlan(
      [candidate(fixture.destination, "symlink", true)],
      async (path) => await inspectDestination(path),
      removeEntry
    );

    expect(plan.removed).toBe(1);
    expect(await pathPresent(fixture.destination)).toBe(false);
    // the whole point: the vault skill the link pointed at must survive untouched
    const source = await readFile(join(fixture.vaultPath, ".skills", "writer", "SKILL.md"), "utf8");
    expect(source).toContain("body");
  }, 30000);

  it("removes a copied skill only when the install record proves Skill Hub created it", async () => {
    const fixture = await installInto(await makeFixture(), "copy");

    const unproven = await applyUninstallPlan(
      [candidate(fixture.destination, "copy", false)],
      async (path) => await inspectDestination(path),
      removeEntry
    );
    expect(unproven.removed).toBe(0);
    expect(unproven.blocked).toBe(1);
    expect(await pathPresent(fixture.destination)).toBe(true);

    const proven = await applyUninstallPlan(
      [candidate(fixture.destination, "copy", true)],
      async (path) => await inspectDestination(path),
      removeEntry
    );
    expect(proven.removed).toBe(1);
    expect(await pathPresent(fixture.destination)).toBe(false);
  }, 30000);

  it("reports an absent destination as missing without calling the remover", async () => {
    const fixture = await makeFixture();
    let calls = 0;

    const plan = await applyUninstallPlan(
      [candidate(fixture.destination, "symlink", true)],
      async (path) => await inspectDestination(path),
      async (removal) => {
        calls += 1;
        await removeEntry(removal);
      }
    );

    expect(plan.missing).toBe(1);
    expect(plan.removed).toBe(0);
    expect(calls).toBe(0);
  }, 30000);

  it("computes a dryrun plan without deleting anything", async () => {
    const fixture = await installInto(await makeFixture(), "copy");

    const plan = await applyUninstallPlan(
      [candidate(fixture.destination, "copy", true)],
      async (path) => await inspectDestination(path),
      removeEntry,
      false
    );

    expect(plan.removable).toBe(1);
    expect(plan.removed).toBe(0);
    expect(await pathPresent(fixture.destination)).toBe(true);
  }, 30000);

  it("marks a removal that throws as failed and keeps counting the rest", async () => {
    const fixture = await installInto(await makeFixture(), "copy");
    const other = join(fixture.destination, "..", "second");
    await mkdir(other, { recursive: true });

    const plan = await applyUninstallPlan(
      [candidate(fixture.destination, "copy", true), candidate(other, "copy", false)],
      async (path) => await inspectDestination(path),
      async () => {
        throw new Error("disk refused the removal");
      }
    );

    expect(plan.failed).toBe(1);
    expect(plan.blocked).toBe(1);
    expect(plan.removed).toBe(0);
    expect(plan.rows[0]?.decision).toBe("failed");
    expect(plan.rows[0]?.reason).toContain("disk refused the removal");
    expect(plan.rows[1]?.decision).toBe("blocked");
  }, 30000);
});
