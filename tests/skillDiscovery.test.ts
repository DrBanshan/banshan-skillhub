import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { discoverSkills, formatMissingSkillsFolderMessage, parseSkillMarkdown } from "../src/skillDiscovery";

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

  it("discovers a skill one level below a grouping folder", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "skillhub-discovery-"));
    const nested = join(sourcePath, "skills", "productivity", "grill-me");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, "SKILL.md"), "---\nname: Grill me\ndescription: Interrogates a plan\n---\n", "utf8");

    try {
      const result = await discoverSkills(sourcePath);

      expect(result.missingSkillsFolder).toBe(false);
      expect(result.skills.map((skill) => skill.folderName)).toEqual(["grill-me"]);
      expect(result.skills[0].path).toBe(nested);
      expect(result.skills[0].metadata.name).toBe("Grill me");
    } finally {
      await rm(sourcePath, { force: true, recursive: true });
    }
  });

  it("does not treat a skill folder as a grouping, nor look two levels past the skills root", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "skillhub-discovery-"));
    const skill = join(sourcePath, "skills", "writer");
    const nestedInsideSkill = join(skill, "examples", "sample");
    const deepGrouping = join(sourcePath, "skills", "engineering", "archive", "old-skill");
    await mkdir(nestedInsideSkill, { recursive: true });
    await mkdir(deepGrouping, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: Writer\ndescription: Writes\n---\n", "utf8");
    await writeFile(join(nestedInsideSkill, "SKILL.md"), "---\nname: Sample\ndescription: Example\n---\n", "utf8");
    await writeFile(join(deepGrouping, "SKILL.md"), "---\nname: Old\ndescription: Aged\n---\n", "utf8");

    try {
      const result = await discoverSkills(sourcePath);

      // writer counts once even though it holds folders, and archive is a grouping of groupings, which
      // is where the extra level stops
      expect(result.skills.map((entry) => entry.folderName)).toEqual(["writer"]);
    } finally {
      await rm(sourcePath, { force: true, recursive: true });
    }
  });

  it("reports every skill when a grouping holds several", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "skillhub-discovery-"));
    const engineering = join(sourcePath, "skills", "engineering");
    await mkdir(join(engineering, "code-review"), { recursive: true });
    await mkdir(join(engineering, "grill-with-docs"), { recursive: true });
    await writeFile(join(engineering, "README.md"), "grouping notes", "utf8");
    await writeFile(join(engineering, "code-review", "SKILL.md"), "---\nname: Review\ndescription: Reviews\n---\n", "utf8");
    await writeFile(join(engineering, "grill-with-docs", "SKILL.md"), "---\nname: Docs\ndescription: Interrogates\n---\n", "utf8");

    try {
      const result = await discoverSkills(sourcePath);

      expect(result.skills.map((skill) => skill.folderName)).toEqual(["code-review", "grill-with-docs"]);
      expect(result.warnings).toEqual([]);
    } finally {
      await rm(sourcePath, { force: true, recursive: true });
    }
  });

  it("prefers top-level skills over an empty .agents/skills folder", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "skillhub-discovery-"));
    const skillPath = join(sourcePath, "skills", "writer");
    await mkdir(join(sourcePath, ".agents", "skills"), { recursive: true });
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, "SKILL.md"), "---\nname: Writer\ndescription: Writes\n---\n", "utf8");

    try {
      const result = await discoverSkills(sourcePath);

      expect(result.missingSkillsFolder).toBe(false);
      expect(result.skills.map((skill) => skill.folderName)).toEqual(["writer"]);
    } finally {
      await rm(sourcePath, { force: true, recursive: true });
    }
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

  it("describes both supported local scan roots when neither exists", () => {
    expect(formatMissingSkillsFolderMessage()).toBe("No skills or .agents/skills folder was found in the selected directory.");
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
