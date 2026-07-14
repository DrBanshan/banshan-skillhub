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

export interface DiscoveryDependencies {
  readFile(path: string): Promise<string>;
}

const defaultDiscoveryDependencies: DiscoveryDependencies = {
  readFile: (path) => readFile(path, "utf8")
};

export function resolveSkillsRoot(scanRoot: string): string {
  return basename(scanRoot) === "skills" ? scanRoot : join(scanRoot, "skills");
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
  const skillsRoot = resolveSkillsRoot(scanRoot);
  try {
    await access(skillsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { skills: [], missingSkillsFolder: true, warnings: [] };
    }
    throw error;
  }

  const entries = (await readdir(skillsRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const skills: DiscoveredSkill[] = [];
  const warnings: DiscoveryWarning[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillPath = join(skillsRoot, entry.name);
    const markdownPath = join(skillPath, "SKILL.md");
    try {
      const markdown = await dependencies.readFile(markdownPath);
      const metadata = parseSkillMarkdown(markdown, entry.name);
      skills.push({ folderName: entry.name, path: skillPath, metadata, warnings: metadata.warnings });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        warnings.push({ path: markdownPath, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return { skills, missingSkillsFolder: false, warnings };
}
