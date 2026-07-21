import type { SkillRecord } from "./types";

export interface GitHubRepositoryIdentity {
  id: string;
  owner: string;
  repo: string;
  repoUrl: string;
}

export interface GitHubSkillBundle extends GitHubRepositoryIdentity {
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

export function deriveGitHubBundles(skills: SkillRecord[], bundleNames: Record<string, string>): GitHubSkillBundle[] {
  const grouped = new Map<string, GitHubSkillBundle>();
  for (const skill of skills) {
    if (skill.source.type !== "github" || !skill.source.url) continue;
    const repository = parseGitHubRepository(skill.source.url);
    if (!repository) continue;
    const existing = grouped.get(repository.id);
    if (existing) {
      existing.skills.push(skill);
    } else {
      grouped.set(repository.id, {
        ...repository,
        name: bundleNames[repository.id]?.trim() || repository.repo,
        skills: [skill]
      });
    }
  }
  return [...grouped.values()]
    .filter((bundle) => bundle.skills.length >= 2)
    .sort((left, right) => left.name.localeCompare(right.name));
}
