import { mkdir } from "fs/promises";
import { dirname, join } from "path";
import { discoverSkills, type DiscoveryResult } from "./skillDiscovery";

const GITHUB_CONTENTS_LISTING_LIMIT = 1000;
const DEFAULT_DOWNLOAD_LIMITS: GitHubDownloadLimits = {
  maxRequests: 200,
  maxFiles: 500,
  maxBytes: 50 * 1024 * 1024,
  maxDepth: 20
};

export interface GitHubSkillLocation {
  owner: string;
  repo: string;
  ref?: string;
  skillsPath: string;
}

export interface ParseGitHubSkillUrlOptions {
  knownRefs?: string[];
}

export interface GitHubContentEntry {
  type: "dir" | "file";
  name: string;
  path: string;
  download_url?: string | null;
  size?: number;
}

export interface GitHubApiResponse {
  status: number;
  data: GitHubContentEntry[];
  truncated?: boolean;
}

export interface GitHubSkillDownloaderDependencies {
  fetchJson(path: string): Promise<GitHubApiResponse>;
  downloadFile(url: string, destination: string): Promise<number>;
}

export interface GitHubDownloadLimits {
  maxRequests: number;
  maxFiles: number;
  maxBytes: number;
  maxDepth: number;
}

export type GitHubRefExists = (owner: string, repo: string, ref: string) => Promise<boolean>;

export class InvalidGitHubUrlError extends Error {
  constructor(input: string) {
    super(`Invalid GitHub URL: ${input}`);
    this.name = "InvalidGitHubUrlError";
  }
}

export class MissingSkillsFolderError extends Error {
  constructor(skillsPath: string) {
    super(`GitHub skills folder not found: ${skillsPath}`);
    this.name = "MissingSkillsFolderError";
  }
}

export class GitHubImportLimitError extends Error {
  constructor(path: string) {
    super(`GitHub listing is incomplete or too large: ${path}`);
    this.name = "GitHubImportLimitError";
  }
}

export function parseGitHubSkillUrl(input: string, options: ParseGitHubSkillUrlOptions = {}): GitHubSkillLocation {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InvalidGitHubUrlError(input);
  }

  if (url.hostname !== "github.com") throw new InvalidGitHubUrlError(input);

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) throw new InvalidGitHubUrlError(input);

  const [owner, rawRepo, ...remainder] = segments;
  const repo = rawRepo.endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo;
  if (!owner || !repo) throw new InvalidGitHubUrlError(input);

  if (remainder.length === 0) return { owner, repo, skillsPath: "skills" };
  if (remainder[0] !== "tree" || remainder.length < 2) throw new InvalidGitHubUrlError(input);

  const treeSegments = remainder.slice(1);
  const ref = resolveRef(treeSegments, options.knownRefs);
  const pathSegments = treeSegments.slice(ref.split("/").length);
  const skillsPath = pathSegments.at(-1) === "skills" ? pathSegments.join("/") : [...pathSegments, "skills"].join("/");

  return { owner, repo, ref, skillsPath };
}

export async function resolveGitHubSkillUrl(input: string, refExists: GitHubRefExists): Promise<GitHubSkillLocation> {
  const fallback = parseGitHubSkillUrl(input);
  if (!fallback.ref) return fallback;
  if (/^[0-9a-f]{40}$/i.test(fallback.ref)) return fallback;

  const treeSegments = new URL(input).pathname.split("/").filter(Boolean).slice(3);
  for (let segmentCount = treeSegments.length; segmentCount > 0; segmentCount -= 1) {
    const candidate = treeSegments.slice(0, segmentCount).join("/");
    if (await refExists(fallback.owner, fallback.repo, candidate)) {
      return parseGitHubSkillUrl(input, { knownRefs: [candidate] });
    }
  }

  throw new InvalidGitHubUrlError(input);
}

function resolveRef(treeSegments: string[], knownRefs?: string[]): string {
  if (knownRefs) {
    const matchingRefs = knownRefs.filter((candidate) => treeSegments.join("/").startsWith(`${candidate}/`) || treeSegments.join("/") === candidate);
    if (matchingRefs.length > 0) return matchingRefs.sort((a, b) => b.length - a.length)[0];
  }

  return treeSegments[0];
}

export class GitHubSkillDownloader {
  private readonly limits: GitHubDownloadLimits;
  private requests = 0;
  private files = 0;
  private bytes = 0;

  constructor(
    private readonly dependencies: GitHubSkillDownloaderDependencies,
    limits: Partial<GitHubDownloadLimits> = {}
  ) {
    this.limits = { ...DEFAULT_DOWNLOAD_LIMITS, ...limits };
  }

  async listSkillFolders(location: GitHubSkillLocation): Promise<string[]> {
    const entries = await this.listContents(location, location.skillsPath);
    return entries.filter((entry) => entry.type === "dir").map((entry) => entry.name);
  }

  async downloadSkillFolder(location: GitHubSkillLocation, folderName: string, destination: string): Promise<DiscoveryResult> {
    if (!folderName || folderName.includes("/") || folderName.includes("\\")) throw new InvalidGitHubUrlError(folderName);

    const selectedPath = `${location.skillsPath}/${folderName}`;
    await this.downloadContents(location, selectedPath, destination, selectedPath, 0);
    return discoverSkills(destination);
  }

  private async downloadContents(
    location: GitHubSkillLocation,
    path: string,
    destination: string,
    selectedPath: string,
    depth: number
  ): Promise<void> {
    if (depth > this.limits.maxDepth) throw new GitHubImportLimitError(path);
    const entries = await this.listContents(location, path);
    for (const entry of entries) {
      if (!isWithinPath(entry.path, selectedPath)) continue;

      if (entry.type === "dir") {
        await this.downloadContents(location, entry.path, destination, selectedPath, depth + 1);
        continue;
      }

      if (!entry.download_url) throw new GitHubImportLimitError(entry.path);
      if (this.files >= this.limits.maxFiles) throw new GitHubImportLimitError(entry.path);
      if (typeof entry.size === "number" && this.bytes + entry.size > this.limits.maxBytes) {
        throw new GitHubImportLimitError(entry.path);
      }
      this.consumeRequest(entry.path);
      this.files += 1;
      const stagedPath = join(destination, "skills", entry.path.slice(`${location.skillsPath}/`.length));
      await mkdir(dirname(stagedPath), { recursive: true });
      const downloadedBytes = await this.dependencies.downloadFile(entry.download_url, stagedPath);
      this.bytes += downloadedBytes;
      if (!Number.isFinite(downloadedBytes) || downloadedBytes < 0 || this.bytes > this.limits.maxBytes) {
        throw new GitHubImportLimitError(entry.path);
      }
    }
  }

  private async listContents(location: GitHubSkillLocation, path: string): Promise<GitHubContentEntry[]> {
    this.consumeRequest(path);
    const query = location.ref ? `?ref=${encodeURIComponent(location.ref)}` : "";
    const response = await this.dependencies.fetchJson(`/repos/${location.owner}/${location.repo}/contents/${path}${query}`);
    if (response.status === 404) throw new MissingSkillsFolderError(path);
    if (response.status !== 200) throw new Error(`GitHub contents request failed with status ${response.status}`);
    if (response.truncated || response.data.length >= GITHUB_CONTENTS_LISTING_LIMIT) throw new GitHubImportLimitError(path);
    return response.data;
  }

  private consumeRequest(path: string): void {
    if (this.requests >= this.limits.maxRequests) throw new GitHubImportLimitError(path);
    this.requests += 1;
  }
}

function isWithinPath(path: string, root: string): boolean {
  const pathSegments = path.split("/");
  const rootSegments = root.split("/");
  if (pathSegments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))) return false;

  return pathSegments.length > rootSegments.length && rootSegments.every((segment, index) => pathSegments[index] === segment);
}
