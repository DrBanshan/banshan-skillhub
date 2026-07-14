import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
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

  it("discovers npx output below .agents/skills", async () => {
    const stagingPath = await mkdtemp(join(tmpdir(), "skillhub-discovery-"));
    const skillPath = join(stagingPath, ".agents", "skills", "writer");
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, "SKILL.md"), "---\nname: Writer\ndescription: Writes\n---\n", "utf8");

    try {
      const result = await discoverSkills(stagingPath);

      expect(result.missingSkillsFolder).toBe(false);
      expect(result.skills.map((skill) => skill.folderName)).toEqual(["writer"]);
    } finally {
      await rm(stagingPath, { force: true, recursive: true });
    }
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

  it("returns a warning when SKILL.md exists but cannot be read", async () => {
    const result = await discoverSkills(`${fixturesRoot}skills`, {
      readFile: async (path) => {
        if (String(path).endsWith("good-skill/SKILL.md")) {
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        }
        return "---\nname: Other\ndescription: Other\n---\n";
      }
    });

    expect(result.skills.some((skill) => skill.folderName === "good-skill")).toBe(false);
    expect(result.warnings).toEqual([{ path: expect.stringContaining("good-skill/SKILL.md"), message: "permission denied" }]);
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
