import { describe, expect, it } from "vitest";

import { deriveGitHubBundles, parseGitHubRepository } from "../src/skillBundles";
import type { SkillRecord } from "../src/types";

function createSkill(id: string, url?: string): SkillRecord {
  return {
    id,
    folderName: id,
    vaultPath: `Skill/${id}`,
    originalName: id,
    nickname: id,
    description: "",
    tags: [],
    collectionIds: [],
    source: url ? { type: "github", url } : { type: "local", path: "/tmp" },
    importMethod: url ? "github" : "local",
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

describe("deriveGitHubBundles", () => {
  it("groups two or more skills from the same repository", () => {
    const skills = [
      createSkill("writing", "https://github.com/acme/agent-skills/tree/main/skills"),
      createSkill("reviewing", "https://github.com/acme/agent-skills/tree/main/skills"),
      createSkill("solo", "https://github.com/acme/solo/tree/main/skills"),
      createSkill("local")
    ];

    expect(deriveGitHubBundles(skills, {})).toMatchObject([{
      id: "github:acme/agent-skills",
      name: "agent-skills",
      owner: "acme",
      repo: "agent-skills",
      skills: [{ id: "writing" }, { id: "reviewing" }]
    }]);
  });

  it("uses a persisted display-name override", () => {
    const skills = [
      createSkill("one", "https://github.com/acme/skills"),
      createSkill("two", "https://github.com/acme/skills")
    ];

    expect(deriveGitHubBundles(skills, { "github:acme/skills": "Research suite" })[0]?.name).toBe("Research suite");
  });
});
