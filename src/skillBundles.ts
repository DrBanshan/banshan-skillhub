import type { SkillRecord, SkillSource } from "./types";

export interface GitHubRepositoryIdentity {
  id: string;
  owner: string;
  repo: string;
  repoUrl: string;
}

interface SkillSourceIdentity {
  id: string;
  defaultName: string;
  sourceLabel: string;
  sourceValue: string;
}

export interface SkillBundle extends SkillSourceIdentity {
  sourceType: SkillSource["type"];
  name: string;
  skills: SkillRecord[];
}

export function parseGitHubRepository(sourceUrl: string): GitHubRepositoryIdentity | undefined {
  try {
    const url = new URL(sourceUrl);
    if (url.hostname.toLocaleLowerCase() !== "github.com" && url.hostname.toLocaleLowerCase() !== "www.github.com") return undefined;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return undefined;
    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/i, "");
    if (!owner || !repo) return undefined;
    return {
      id: `github:${owner.toLocaleLowerCase()}/${repo.toLocaleLowerCase()}`,
      owner,
      repo,
      repoUrl: `https://github.com/${owner}/${repo}`
    };
  } catch {
    return undefined;
  }
}

export function deriveSkillBundles(skills: SkillRecord[], bundleNames: Record<string, string>): SkillBundle[] {
  const grouped = new Map<string, SkillBundle>();
  for (const skill of skills) {
    const source = getSkillSourceIdentity(skill.source);
    if (!source) continue;
    const existing = grouped.get(source.id);
    if (existing) {
      existing.skills.push(skill);
    } else {
      grouped.set(source.id, {
        ...source,
        sourceType: skill.source.type,
        name: bundleNames[source.id]?.trim() || source.defaultName,
        skills: [skill]
      });
    }
  }
  return [...grouped.values()]
    .filter((bundle) => bundle.skills.length >= 2)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getSkillSourceIdentity(source: SkillSource): SkillSourceIdentity | undefined {
  if (source.type === "github" && source.url) {
    const repository = parseGitHubRepository(source.url);
    if (!repository) return undefined;
    return {
      id: repository.id,
      defaultName: repository.repo,
      sourceLabel: `${repository.owner}/${repository.repo}`,
      sourceValue: repository.repoUrl
    };
  }

  if (source.type === "local" && source.path) {
    const normalizedPath = normalizeLocalPath(source.path);
    return {
      id: `local:${normalizedPath}`,
      defaultName: getLastPathSegment(normalizedPath) || "Local skills",
      sourceLabel: normalizedPath,
      sourceValue: normalizedPath
    };
  }

  if (source.type === "npx" && source.command) {
    const normalizedCommand = source.command.trim().replace(/\s+/g, " ");
    const target = parseNpxTarget(normalizedCommand);
    return {
      id: `npx:${normalizedCommand}`,
      defaultName: target ? getSourceName(target) : "npx import",
      sourceLabel: target ?? "npx import",
      sourceValue: normalizedCommand
    };
  }

  return undefined;
}

function normalizeLocalPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

function getLastPathSegment(value: string): string {
  return value.split("/").filter(Boolean).at(-1) ?? "";
}

function parseNpxTarget(command: string): string | undefined {
  const match = command.match(/^npx\s+skills\s+add\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function getSourceName(target: string): string {
  const repository = parseGitHubRepository(target);
  if (repository) return repository.repo;
  return getLastPathSegment(target.replace(/\.git$/i, "")) || "npx import";
}
