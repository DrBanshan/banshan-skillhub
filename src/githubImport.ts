import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { discoverSkills, type DiscoveryResult } from "./skillDiscovery";

const GITHUB_CONTENTS_LISTING_LIMIT = 1000;
const DEFAULT_GITHUB_REF_PROBE_LIMIT = 20;
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
  rootPath?: string;
  skillsPath: string;
}

export interface GitHubSkillCandidate {
  kind: "folder" | "root";
  name: string;
  label: string;
}

export interface ParseGitHubSkillUrlOptions {
  knownRefs?: string[];
}

export interface ResolveGitHubSkillUrlOptions {
  maxProbes?: number;
  requestBudget?: GitHubRequestBudget;
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
  downloadFile(url: string, destination: string, maxBytes: number): Promise<number>;
}

export interface GitHubDownloadResponse {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
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
  constructor(path: string) {
    super(`GitHub skills folder or root SKILL.md not found: ${path || "/"}`);
    this.name = "MissingSkillsFolderError";
  }
}

export class GitHubImportLimitError extends Error {
  constructor(path: string) {
    super(`GitHub listing is incomplete or too large: ${path}`);
    this.name = "GitHubImportLimitError";
  }
}

export async function writeBoundedGitHubResponse(
  response: GitHubDownloadResponse,
  destination: string,
  maxBytes: number,
  write: (path: string, data: Buffer) => Promise<void> = (path, data) => writeFile(path, data)
): Promise<number> {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`GitHub download request failed with status ${response.status}`);
  }

  const contentLengthHeader = Object.entries(response.headers).find(([name]) => name.toLowerCase() === "content-length")?.[1];
  const contentLength = contentLengthHeader === undefined ? undefined : Number(contentLengthHeader);
  if (contentLength !== undefined && Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new GitHubImportLimitError(destination);
  }

  const buffer = Buffer.from(response.arrayBuffer);
  if (buffer.byteLength > maxBytes) throw new GitHubImportLimitError(destination);
  await write(destination, buffer);
  return buffer.byteLength;
}

export class GitHubRequestBudget {
  private requests = 0;

  constructor(readonly maxRequests = DEFAULT_DOWNLOAD_LIMITS.maxRequests) {}

  get remainingRequests(): number {
    return Math.max(0, this.maxRequests - this.requests);
  }

  consume(path: string): void {
    if (this.requests >= this.maxRequests) throw new GitHubImportLimitError(path);
    this.requests += 1;
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

  if (remainder.length === 0) return { owner, repo, rootPath: "", skillsPath: "skills" };
  if (remainder[0] !== "tree" || remainder.length < 2) throw new InvalidGitHubUrlError(input);

  const treeSegments = remainder.slice(1);
  const ref = resolveRef(treeSegments, options.knownRefs);
  const pathSegments = treeSegments.slice(ref.split("/").length);
  const rootPath = pathSegments.join("/");
  const skillsPath = pathSegments.at(-1) === "skills" ? rootPath : [...pathSegments, "skills"].join("/");

  return { owner, repo, ref, rootPath, skillsPath };
}

export async function resolveGitHubSkillUrl(
  input: string,
  refExists: GitHubRefExists,
  options: ResolveGitHubSkillUrlOptions = {}
): Promise<GitHubSkillLocation> {
  const fallback = parseGitHubSkillUrl(input);
  if (!fallback.ref) return fallback;
  if (/^[0-9a-f]{40}$/i.test(fallback.ref)) return fallback;

  const treeSegments = new URL(input).pathname.split("/").filter(Boolean).slice(3);
  const configuredProbeLimit = Math.max(0, Math.floor(options.maxProbes ?? DEFAULT_GITHUB_REF_PROBE_LIMIT));
  const maxProbes = Math.min(configuredProbeLimit, options.requestBudget?.remainingRequests ?? configuredProbeLimit);
  let probes = 0;
  for (let segmentCount = treeSegments.length; segmentCount > 0 && probes < maxProbes; segmentCount -= 1) {
    const candidate = treeSegments.slice(0, segmentCount).join("/");
    probes += 1;
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
  private readonly requestBudget: GitHubRequestBudget;
  private files = 0;
  private bytes = 0;

  constructor(
    private readonly dependencies: GitHubSkillDownloaderDependencies,
    limits: Partial<GitHubDownloadLimits> = {},
    requestBudget?: GitHubRequestBudget
  ) {
    this.limits = { ...DEFAULT_DOWNLOAD_LIMITS, ...limits };
    this.requestBudget = requestBudget ?? new GitHubRequestBudget(this.limits.maxRequests);
  }

  async listSkillFolders(location: GitHubSkillLocation): Promise<string[]> {
    const entries = await this.listContents(location, location.skillsPath);
    return entries.filter((entry) => entry.type === "dir").map((entry) => entry.name);
  }

  async listSkillCandidates(location: GitHubSkillLocation): Promise<GitHubSkillCandidate[]> {
    const rootPath = resolveRootPath(location);
    const rootEntries = await this.listContents(location, rootPath);
    const rootSkillPath = appendGitHubPath(rootPath, "SKILL.md");
    const hasRootSkill = rootEntries.some((entry) => entry.type === "file" && entry.name === "SKILL.md" && entry.path === rootSkillPath);
    const candidates: GitHubSkillCandidate[] = [];

    if (hasRootSkill) {
      const name = rootPath.split("/").filter(Boolean).at(-1) ?? location.repo;
      candidates.push({ kind: "root", name, label: `${name} (root SKILL.md)` });
    }

    if (rootPath === location.skillsPath) {
      candidates.push(...rootEntries
        .filter((entry) => entry.type === "dir")
        .map((entry) => ({ kind: "folder" as const, name: entry.name, label: entry.name })));
    } else if (rootEntries.some((entry) => entry.type === "dir" && entry.path === location.skillsPath)) {
      const folders = await this.listSkillFolders(location);
      candidates.push(...folders.map((name) => ({ kind: "folder" as const, name, label: name })));
    }

    if (candidates.length === 0) throw new MissingSkillsFolderError(rootPath);
    return candidates;
  }

  async downloadSkillCandidate(
    location: GitHubSkillLocation,
    candidate: GitHubSkillCandidate,
    destination: string
  ): Promise<DiscoveryResult> {
    if (candidate.kind === "folder") return this.downloadSkillFolder(location, candidate.name, destination);
    return this.downloadRootSkill(location, destination);
  }

  async downloadSkillFolder(location: GitHubSkillLocation, folderName: string, destination: string): Promise<DiscoveryResult> {
    if (!folderName || folderName.includes("/") || folderName.includes("\\")) throw new InvalidGitHubUrlError(folderName);

    const selectedPath = `${location.skillsPath}/${folderName}`;
    await this.downloadContents(location, selectedPath, destination, selectedPath, 0);
    return discoverSkills(destination);
  }

  private async downloadRootSkill(location: GitHubSkillLocation, destination: string): Promise<DiscoveryResult> {
    const rootPath = resolveRootPath(location);
    const rootSkillPath = appendGitHubPath(rootPath, "SKILL.md");
    const entries = await this.listContents(location, rootPath);
    const entry = entries.find((item) => item.type === "file" && item.name === "SKILL.md" && item.path === rootSkillPath);
    if (!entry) throw new MissingSkillsFolderError(rootPath);

    const folderName = rootPath.split("/").filter(Boolean).at(-1) ?? location.repo;
    if (!folderName || folderName.includes("/") || folderName.includes("\\")) throw new InvalidGitHubUrlError(folderName);
    await this.downloadFileEntry(entry, join(destination, "skills", folderName, "SKILL.md"));
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

      const stagedPath = join(destination, "skills", entry.path.slice(`${location.skillsPath}/`.length));
      await this.downloadFileEntry(entry, stagedPath);
    }
  }

  private async downloadFileEntry(entry: GitHubContentEntry, stagedPath: string): Promise<void> {
    if (!entry.download_url) throw new GitHubImportLimitError(entry.path);
    if (this.files >= this.limits.maxFiles) throw new GitHubImportLimitError(entry.path);
    if (typeof entry.size === "number" && this.bytes + entry.size > this.limits.maxBytes) {
      throw new GitHubImportLimitError(entry.path);
    }
    this.consumeRequest(entry.path);
    this.files += 1;
    await mkdir(dirname(stagedPath), { recursive: true });
    const downloadedBytes = await this.dependencies.downloadFile(entry.download_url, stagedPath, this.limits.maxBytes - this.bytes);
    this.bytes += downloadedBytes;
    if (!Number.isFinite(downloadedBytes) || downloadedBytes < 0 || this.bytes > this.limits.maxBytes) {
      throw new GitHubImportLimitError(entry.path);
    }
  }

  private async listContents(location: GitHubSkillLocation, path: string): Promise<GitHubContentEntry[]> {
    this.consumeRequest(path);
    const query = location.ref ? `?ref=${encodeURIComponent(location.ref)}` : "";
    const contentsPath = path ? `/contents/${path}` : "/contents";
    const response = await this.dependencies.fetchJson(`/repos/${location.owner}/${location.repo}${contentsPath}${query}`);
    if (response.status === 404) throw new MissingSkillsFolderError(path);
    if (response.status !== 200) throw new Error(`GitHub contents request failed with status ${response.status}`);
    if (response.truncated || response.data.length >= GITHUB_CONTENTS_LISTING_LIMIT) throw new GitHubImportLimitError(path);
    return response.data;
  }

  private consumeRequest(path: string): void {
    this.requestBudget.consume(path);
  }
}

function resolveRootPath(location: GitHubSkillLocation): string {
  if (location.rootPath !== undefined) return location.rootPath;
  return location.skillsPath === "skills" ? "" : location.skillsPath.replace(/\/skills$/, "");
}

function appendGitHubPath(path: string, name: string): string {
  return path ? `${path}/${name}` : name;
}

function isWithinPath(path: string, root: string): boolean {
  const pathSegments = path.split("/");
  const rootSegments = root.split("/");
  if (pathSegments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))) return false;

  return pathSegments.length > rootSegments.length && rootSegments.every((segment, index) => pathSegments[index] === segment);
}
