import type { Dirent } from "fs";
import { access, readFile, readdir } from "fs/promises";
import { join, basename } from "path";

export interface ParsedSkillMetadata {
  name: string;
  description: string;
  warnings: string[];
}

export interface DiscoveredSkill {
  folderName: string;
  path: string;
  metadata: ParsedSkillMetadata;
  warnings: string[];
}

export interface DiscoveryResult {
  skills: DiscoveredSkill[];
  missingSkillsFolder: boolean;
  warnings: DiscoveryWarning[];
}

export interface DiscoveryWarning {
  path: string;
  message: string;
}

type SkillReadOutcome = "skill" | "unreadable" | "none";

export interface DiscoveryDependencies {
  readFile(path: string): Promise<string>;
}

const defaultDiscoveryDependencies: DiscoveryDependencies = {
  readFile: (path) => readFile(path, "utf8")
};

export function resolveSkillsRoot(scanRoot: string): string {
  return basename(scanRoot) === "skills" ? scanRoot : join(scanRoot, "skills");
}

export function resolveSkillsRootCandidates(scanRoot: string): string[] {
  if (basename(scanRoot) === "skills") return [scanRoot];
  return [join(scanRoot, "skills"), join(scanRoot, ".agents", "skills")];
}

export function formatMissingSkillsFolderMessage(): string {
  return "No skills or .agents/skills folder was found in the selected directory.";
}

export function parseSkillMarkdown(markdown: string, folderName: string): ParsedSkillMetadata {
  const lines = markdown.split(/\r?\n/);
  const warnings: string[] = [];
  let frontmatter: string[] = [];
  let malformed = false;

  if (lines[0]?.trim() !== "---") {
    malformed = true;
  } else {
    const closingIndex = lines.slice(1).findIndex((line) => line.trim() === "---");
    if (closingIndex === -1) {
      malformed = true;
    } else {
      frontmatter = lines.slice(1, closingIndex + 1);
    }
  }

  if (malformed) {
    warnings.push("Malformed frontmatter");
  }

  let name = "";
  let description = "";
  for (const line of frontmatter) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      warnings.push("Malformed frontmatter");
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "name") name = value;
    if (key === "description") description = value;
  }

  if (!name) {
    name = folderName;
    warnings.push("Missing name");
  }
  if (!description) {
    warnings.push("Missing description");
  }

  return { name, description, warnings: [...new Set(warnings)] };
}

export async function discoverSkills(
  scanRoot: string,
  dependencies: DiscoveryDependencies = defaultDiscoveryDependencies
): Promise<DiscoveryResult> {
  let skillsRoot: string | undefined;
  for (const candidate of resolveSkillsRootCandidates(scanRoot)) {
    try {
      await access(candidate);
      skillsRoot = candidate;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (!skillsRoot) return { skills: [], missingSkillsFolder: true, warnings: [] };

  const entries = (await readdir(skillsRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const skills: DiscoveredSkill[] = [];
  const warnings: DiscoveryWarning[] = [];

const readSkill = async (skillPath: string, folderName: string): Promise<SkillReadOutcome> => {
    const markdownPath = join(skillPath, "SKILL.md");
    try {
      const markdown = await dependencies.readFile(markdownPath);
      const metadata = parseSkillMarkdown(markdown, folderName);
      skills.push({ folderName, path: skillPath, metadata, warnings: metadata.warnings });
      return "skill";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        warnings.push({ path: markdownPath, message: error instanceof Error ? error.message : String(error) });
        // an unreadable frontmatter file still marks this folder as a skill, so it is not treated as a
        // grouping and reported twice over
        return "unreadable";
      }
      return "none";
    }
  };

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillPath = join(skillsRoot, entry.name);
    if ((await readSkill(skillPath, entry.name)) !== "none") continue;

    // no SKILL.md of its own, so this folder may be a grouping: repositories that organise skills by
    // discipline keep them at skills/<category>/<skill>/SKILL.md. Exactly one level deeper is examined,
    // because a deeper walk would reach into whatever else a folder happens to hold
let grouped: Dirent[];
    try {
      grouped = await readdir(skillPath, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        warnings.push({ path: skillPath, message: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }
for (const child of grouped.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!child.isDirectory()) continue;
      await readSkill(join(skillPath, child.name), child.name);
    }
  }

  skills.sort((a, b) => a.folderName.localeCompare(b.folderName) || a.path.localeCompare(b.path));
  return { skills, missingSkillsFolder: false, warnings };
}
