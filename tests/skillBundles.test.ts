import { describe, expect, it } from "vitest";

import { deriveSkillBundles, parseGitHubRepository } from "../src/skillBundles";
import type { SkillRecord, SkillSource } from "../src/types";

function createSkill(id: string, source: SkillSource = { type: "local", path: `/tmp/${id}` }): SkillRecord {
  return {
    id,
    folderName: id,
    vaultPath: `Skill/${id}`,
    originalName: id,
    nickname: id,
    description: "",
    tags: [],
    collectionIds: [],
    source,
    importMethod: source.type,
    warnings: [],
    importedAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    installCount: 0
  };
}

describe("parseGitHubRepository", () => {
  it("parses repository identity from branch and skills URLs", () => {
    expect(parseGitHubRepository("https://github.com/Vercel-Labs/skills/tree/canary/skills")).toEqual({
      id: "github:vercel-labs/skills",
      owner: "Vercel-Labs",
      repo: "skills",
      repoUrl: "https://github.com/Vercel-Labs/skills"
    });
  });

  it("accepts .git URLs and rejects non-GitHub sources", () => {
    expect(parseGitHubRepository("https://github.com/owner/toolkit.git")?.repo).toBe("toolkit");
    expect(parseGitHubRepository("https://gitlab.com/owner/toolkit")).toBeUndefined();
    expect(parseGitHubRepository("not a URL")).toBeUndefined();
  });
});

describe("deriveSkillBundles", () => {
  it("groups two or more skills from the same repository", () => {
    const skills = [
      createSkill("writing", { type: "github", url: "https://github.com/acme/agent-skills/tree/main/skills" }),
      createSkill("reviewing", { type: "github", url: "https://github.com/acme/agent-skills/tree/main/skills" }),
      createSkill("solo", { type: "github", url: "https://github.com/acme/solo/tree/main/skills" }),
      createSkill("local")
    ];

    expect(deriveSkillBundles(skills, {})).toMatchObject([{
      id: "github:acme/agent-skills",
      name: "agent-skills",
      sourceType: "github",
      sourceLabel: "acme/agent-skills",
      skills: [{ id: "writing" }, { id: "reviewing" }]
    }]);
  });

  it("groups skills imported from the same local scan", () => {
    const source: SkillSource = { type: "local", path: "/Users/me/agent-library" };
    const bundle = deriveSkillBundles([createSkill("one", source), createSkill("two", source)], {})[0];

    expect(bundle).toMatchObject({
      id: "local:/Users/me/agent-library",
      name: "agent-library",
      sourceType: "local",
      sourceValue: "/Users/me/agent-library"
    });
  });

  it("groups skills installed by the same npx command", () => {
    const source: SkillSource = { type: "npx", command: "npx skills add https://github.com/vercel-labs/skills --all" };
    const bundle = deriveSkillBundles([createSkill("one", source), createSkill("two", source)], {})[0];

    expect(bundle).toMatchObject({
      name: "skills",
      sourceType: "npx",
      sourceLabel: "https://github.com/vercel-labs/skills"
    });
  });

  it("uses a persisted display-name override", () => {
    const skills = [
      createSkill("one", { type: "github", url: "https://github.com/acme/skills" }),
      createSkill("two", { type: "github", url: "https://github.com/acme/skills" })
    ];

    expect(deriveSkillBundles(skills, { "github:acme/skills": "Research suite" })[0]?.name).toBe("Research suite");
  });
});
