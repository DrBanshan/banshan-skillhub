import { describe, expect, it } from "vitest";
import { discoverSkills, parseSkillMarkdown } from "../src/skillDiscovery";

const fixturesRoot = new URL("./fixtures/", import.meta.url).pathname;

describe("discoverSkills", () => {
  it("discovers a valid skill below a skills folder", async () => {
    const result = await discoverSkills(fixturesRoot);

    expect(result.missingSkillsFolder).toBe(false);
    expect(result.skills).toHaveLength(2);
    expect(result.skills.find((skill) => skill.folderName === "good-skill")).toMatchObject({
      folderName: "good-skill",
      metadata: { name: "Good Skill", description: "A useful skill" },
      warnings: []
    });
  });

  it("scans directly when the root is itself named skills", async () => {
    const result = await discoverSkills(`${fixturesRoot}skills`);

    expect(result.skills.map((skill) => skill.folderName)).toEqual(["good-skill", "missing-description"]);
  });

  it("includes a skill with a missing description and warning", async () => {
    const result = await discoverSkills(`${fixturesRoot}skills`);
    const skill = result.skills.find((entry) => entry.folderName === "missing-description");

    expect(skill?.metadata.description).toBe("");
    expect(skill?.warnings).toContain("Missing description");
  });

  it("ignores folders without SKILL.md", async () => {
    const result = await discoverSkills(fixturesRoot);

    expect(result.skills.some((skill) => skill.folderName === "not-skills")).toBe(false);
  });

  it("reports a missing skills folder", async () => {
    const result = await discoverSkills(`${fixturesRoot}not-skills`);

    expect(result).toMatchObject({ skills: [], missingSkillsFolder: true });
  });
});

describe("parseSkillMarkdown", () => {
  it("uses the folder name when name is missing", () => {
    expect(parseSkillMarkdown("---\ndescription: A skill\n---", "fallback-name")).toEqual({
      name: "fallback-name",
      description: "A skill",
      warnings: ["Missing name"]
    });
  });

  it("warns when frontmatter is malformed", () => {
    const parsed = parseSkillMarkdown("---\nname: Broken\n\n# body", "broken");

    expect(parsed.warnings).toContain("Malformed frontmatter");
  });
});
