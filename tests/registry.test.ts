import { describe, expect, it, vi } from "vitest";
import { createSkillEvent } from "../src/events";

vi.mock("../src/settings", () => ({
  DEFAULT_SETTINGS: {
    skillFolder: "Skill",
    installMethod: "copy",
    npxExecutionEnabled: false,
    defaultSymlinkConflictBehavior: "skip",
    defaultSort: "nickname"
  }
}));

import { createEmptySkillHubData, SkillRegistry } from "../src/registry";

describe("SkillRegistry", () => {
  it("stores skill metadata without modifying source fields", () => {
    const registry = new SkillRegistry(createEmptySkillHubData());
    registry.upsertSkill({
      id: "skill-1",
      folderName: "writer",
      vaultPath: "Skill/writer",
      originalName: "writer",
      nickname: "Writer",
      description: "Drafts prose",
      tags: ["writing"],
      collectionIds: [],
      source: { type: "local", path: "/tmp/source" },
      importMethod: "local",
      warnings: [],
      importedAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      installCount: 0
    });

    expect(registry.data.skills["skill-1"]?.nickname).toBe("Writer");
    expect(registry.data.skills["skill-1"]?.vaultPath).toBe("Skill/writer");
  });

  it("records local events", () => {
    const registry = new SkillRegistry(createEmptySkillHubData());
    registry.recordEvent(createSkillEvent("skill_imported", "skill-1", { method: "local" }, "2026-07-15T00:00:00.000Z"));
    expect(registry.data.events).toHaveLength(1);
    expect(registry.data.events[0].type).toBe("skill_imported");
  });

  it("increments install counters", () => {
    const registry = new SkillRegistry(createEmptySkillHubData());
    registry.upsertSkill({
      id: "skill-1",
      folderName: "writer",
      vaultPath: "Skill/writer",
      originalName: "writer",
      nickname: "Writer",
      description: "",
      tags: [],
      collectionIds: [],
      source: { type: "local", path: "/tmp/source" },
      importMethod: "local",
      warnings: [],
      importedAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      installCount: 0
    });

    registry.incrementInstall("skill-1", "2026-07-15T01:00:00.000Z");
    expect(registry.data.skills["skill-1"]?.installCount).toBe(1);
    expect(registry.data.skills["skill-1"]?.lastInstalledAt).toBe("2026-07-15T01:00:00.000Z");
  });

  it("keeps collection skill IDs consistent when skill memberships change", () => {
    const registry = new SkillRegistry(createEmptySkillHubData());
    registry.upsertSkill({
      id: "skill-1",
      folderName: "writer",
      vaultPath: "Skill/writer",
      originalName: "writer",
      nickname: "Writer",
      description: "",
      tags: [],
      collectionIds: ["collection-1"],
      source: { type: "local", path: "/tmp/source" },
      importMethod: "local",
      warnings: [],
      importedAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      installCount: 0
    });
    registry.saveCollection({ id: "collection-1", name: "Writing", description: "", skillIds: ["skill-1"] });
    registry.saveCollection({ id: "collection-2", name: "Review", description: "", skillIds: [] });

    registry.updateSkillCollections("skill-1", ["collection-2"]);

    expect(registry.data.skills["skill-1"]?.collectionIds).toEqual(["collection-2"]);
    expect(registry.data.collections["collection-1"]?.skillIds).toEqual([]);
    expect(registry.data.collections["collection-2"]?.skillIds).toEqual(["skill-1"]);
  });
});
