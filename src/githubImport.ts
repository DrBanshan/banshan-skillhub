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
  repoInfo?: GitHubRepoInfo | undefined;
}

/**
 * The slice of repository metadata the resolver needs. default_branch is the answer to the question the
 * ref probes ask one at a time, and one GET /repos/{owner}/{repo} serves every tree URL of the
 * repository, so the caller caches it per instance.
 */
export interface GitHubRepoInfo {
  defaultBranch: string;
}

export interface GitHubContentEntry {
  type: "dir" | "file";
  name: string;
  path: string;
  download_url?: string | null;
  size?: number;
}

export interface GitHubRateLimitInfo {
  remaining?: number;
  limit?: number;
  resetEpochSeconds?: number;
  message?: string;
}

export interface GitHubApiResponse {
  status: number;
  data: GitHubContentEntry[];
  truncated?: boolean;
  rateLimit?: GitHubRateLimitInfo;
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
    throw githubRequestFailure("file", response.status);
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
  // a tree URL whose leading segments are exactly the default branch is settled by the metadata request
  // alone, which is the common case and keeps the whole import away from the ref endpoint
  if (options.repoInfo && treeSegments.join("/") === options.repoInfo.defaultBranch) {
    return parseGitHubSkillUrl(input, { knownRefs: [options.repoInfo.defaultBranch] });
  }
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

/**
 * A request refused because the network has spent the anonymous quota it shares. Typed so the caller can
 * take a different route rather than reading a sentence back out of an error message, and carrying the
 * refill time so a second import can stay away from that route until the window turns over.
 */
export class GitHubRateLimitedError extends Error {
  constructor(message: string, readonly resetEpochSeconds?: number) {
    super(message);
    this.name = "GitHubRateLimitedError";
  }
}

/**
 * Runs the cheap route and falls back to the quota immune one only when the refusal really was the quota.
 * Kept out of the plugin class so the switch itself can be tested: a repository with no skills folder must
 * not be answered with a whole repository download, and a network with no quota must not be told its URL
 * is broken.
 */
export async function retryWhenRateLimited<T>(attempt: () => Promise<T>, fallback: () => Promise<T>, onRateLimited?: (resetEpochSeconds?: number) => void): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof GitHubRateLimitedError)) throw error;
    onRateLimited?.(error.resetEpochSeconds);
    return fallback();
  }
}

export interface GitHubTreeEntry {
  type: "dir" | "file";
  name: string;
  path: string;
  size?: number;
}

/**
 * The two ways of reaching a repository answer to this shape. The contents API answers a listing and the
 * raw host answers a file request, while a downloaded archive answers both out of memory. Everything that
 * decides what counts as a skill sits behind this interface, so the two routes cannot drift apart and
 * offer different skills depending on how much quota the network happens to have.
 */
export interface GitHubTreeSource {
  /** Entries directly below path, where "" is the repository root. Throws MissingSkillsFolderError when there is no such folder. */
  list(path: string): Promise<GitHubTreeEntry[]>;
  /** Write one file to destination without exceeding maxBytes, returning the bytes written. */
  readFile(path: string, destination: string, maxBytes: number): Promise<number>;
}

export interface GitHubTransferCounts {
  files: number;
  bytes: number;
}

/**
 * Reads a repository through a GitHubTreeSource to answer which folders are skills, which are groupings of
 * skills, and what a chosen skill looks like once it is copied into staging.
 */
export class SkillTreeImporter {
  private readonly counts: GitHubTransferCounts;

  constructor(
    private readonly source: GitHubTreeSource,
    private readonly location: GitHubSkillLocation,
    private readonly limits: GitHubDownloadLimits,
    counts?: GitHubTransferCounts
  ) {
    this.counts = counts ?? { files: 0, bytes: 0 };
  }

  async listSkillFolders(): Promise<string[]> {
    const entries = await this.source.list(this.location.skillsPath);
    return entries.filter((entry) => entry.type === "dir").map((entry) => entry.name);
  }

  async listSkillCandidates(): Promise<GitHubSkillCandidate[]> {
    const rootPath = resolveRootPath(this.location);
    const rootEntries = await this.source.list(rootPath);
    const rootSkillPath = appendGitHubPath(rootPath, "SKILL.md");
    const hasRootSkill = rootEntries.some((entry) => entry.type === "file" && entry.name === "SKILL.md" && entry.path === rootSkillPath);
    const candidates: GitHubSkillCandidate[] = [];

    if (hasRootSkill) {
      const name = rootPath.split("/").filter(Boolean).at(-1) ?? this.location.repo;
      candidates.push({ kind: "root", name, label: `${name} (root SKILL.md)` });
    }

    if (rootPath === this.location.skillsPath) {
      for (const entry of rootEntries.filter((item) => item.type === "dir")) {
        candidates.push(...(await this.expandSkillFolder(entry.path)));
      }
    } else if (rootEntries.some((entry) => entry.type === "dir" && entry.path === this.location.skillsPath)) {
      for (const folder of await this.listSkillFolders()) {
        candidates.push(...(await this.expandSkillFolder(`${this.location.skillsPath}/${folder}`)));
      }
    }

    if (candidates.length === 0) throw new MissingSkillsFolderError(rootPath);
    return candidates;
  }

  /**
   * Decides whether a folder below the skills root is a skill, and reaches one level further when it is
   * not. Repositories that group skills by discipline put them at skills/<category>/<skill>/SKILL.md, so
   * the categories themselves are not skills and offering them would install a whole grouping as one.
   */
  private async expandSkillFolder(path: string): Promise<GitHubSkillCandidate[]> {
    const entries = await this.source.list(path);
    const selfSkillPath = appendGitHubPath(path, "SKILL.md");
    if (entries.some((entry) => entry.type === "file" && entry.name === "SKILL.md" && entry.path === selfSkillPath)) {
      const name = relativeToSkillsPath(this.location.skillsPath, path);
      return [{ kind: "folder", name, label: name }];
    }
    return entries
      .filter((entry) => entry.type === "dir")
      .map((entry) => {
        const name = relativeToSkillsPath(this.location.skillsPath, entry.path);
        return { kind: "folder" as const, name, label: name };
      });
  }

  async downloadCandidate(candidate: GitHubSkillCandidate, destination: string): Promise<DiscoveryResult> {
    if (candidate.kind === "folder") return this.downloadFolder(candidate.name, destination);
    return this.downloadRootSkill(destination);
  }

  async downloadFolder(folderName: string, destination: string): Promise<DiscoveryResult> {
    if (!isSafeSkillPath(folderName)) throw new InvalidGitHubUrlError(folderName);

    const selectedPath = `${this.location.skillsPath}/${folderName}`;
    await this.downloadContents(selectedPath, destination, selectedPath, 0);
    return discoverSkills(destination);
  }

  private async downloadRootSkill(destination: string): Promise<DiscoveryResult> {
    const rootPath = resolveRootPath(this.location);
    const rootSkillPath = appendGitHubPath(rootPath, "SKILL.md");
    const entries = await this.source.list(rootPath);
    const entry = entries.find((item) => item.type === "file" && item.name === "SKILL.md" && item.path === rootSkillPath);
    if (!entry) throw new MissingSkillsFolderError(rootPath);

    const folderName = rootPath.split("/").filter(Boolean).at(-1) ?? this.location.repo;
    if (!isSafeSkillPath(folderName)) throw new InvalidGitHubUrlError(folderName);
    await this.writeFile(entry.path, join(destination, "skills", folderName, "SKILL.md"), entry.size);
    return discoverSkills(destination);
  }

  private async downloadContents(path: string, destination: string, selectedPath: string, depth: number): Promise<void> {
    if (depth > this.limits.maxDepth) throw new GitHubImportLimitError(path);
    const entries = await this.source.list(path);
    for (const entry of entries) {
      if (!isWithinPath(entry.path, selectedPath)) continue;

      if (entry.type === "dir") {
        await this.downloadContents(entry.path, destination, selectedPath, depth + 1);
        continue;
      }

      const stagedPath = join(destination, "skills", entry.path.slice(`${this.location.skillsPath}/`.length));
      await this.writeFile(entry.path, stagedPath, entry.size);
    }
  }

  private async writeFile(entryPath: string, stagedPath: string, size?: number): Promise<void> {
    if (this.counts.files >= this.limits.maxFiles) throw new GitHubImportLimitError(entryPath);
    if (typeof size === "number" && this.counts.bytes + size > this.limits.maxBytes) {
      throw new GitHubImportLimitError(entryPath);
    }

    await mkdir(dirname(stagedPath), { recursive: true });
    const written = await this.source.readFile(entryPath, stagedPath, this.limits.maxBytes - this.counts.bytes);
    this.counts.files += 1;
    this.counts.bytes += written;
    if (!Number.isFinite(written) || written < 0 || this.counts.bytes > this.limits.maxBytes) {
      throw new GitHubImportLimitError(entryPath);
    }
  }
}

export class GitHubSkillDownloader {
  private readonly limits: GitHubDownloadLimits;
  private readonly requestBudget: GitHubRequestBudget;
  /**
   * Kept on the downloader rather than the importer so every candidate chosen in one import shares one
   * allowance, which is what the limits mean.
   */
  private readonly counts: GitHubTransferCounts = { files: 0, bytes: 0 };

  constructor(
    private readonly dependencies: GitHubSkillDownloaderDependencies,
    limits: Partial<GitHubDownloadLimits> = {},
    requestBudget?: GitHubRequestBudget
  ) {
    this.limits = { ...DEFAULT_DOWNLOAD_LIMITS, ...limits };
    this.requestBudget = requestBudget ?? new GitHubRequestBudget(this.limits.maxRequests);
  }

  listSkillFolders(location: GitHubSkillLocation): Promise<string[]> {
    return this.importer(location).listSkillFolders();
  }

  listSkillCandidates(location: GitHubSkillLocation): Promise<GitHubSkillCandidate[]> {
    return this.importer(location).listSkillCandidates();
  }

  downloadSkillCandidate(location: GitHubSkillLocation, candidate: GitHubSkillCandidate, destination: string): Promise<DiscoveryResult> {
    return this.importer(location).downloadCandidate(candidate, destination);
  }

  downloadSkillFolder(location: GitHubSkillLocation, folderName: string, destination: string): Promise<DiscoveryResult> {
    return this.importer(location).downloadFolder(folderName, destination);
  }

  private importer(location: GitHubSkillLocation): SkillTreeImporter {
    const source: GitHubTreeSource = {
      list: (path) => this.listContents(location, path),
      readFile: (path, destination, maxBytes) => this.fetchFile(location, path, destination, maxBytes)
    };
    return new SkillTreeImporter(source, location, this.limits, this.counts);
  }

  private async listContents(location: GitHubSkillLocation, path: string): Promise<GitHubContentEntry[]> {
    this.consumeRequest(path);
    const query = location.ref ? `?ref=${encodeURIComponent(location.ref)}` : "";
    const contentsPath = path ? `/contents/${path}` : "/contents";
    const response = await this.dependencies.fetchJson(`/repos/${location.owner}/${location.repo}${contentsPath}${query}`);
    if (response.status === 404) throw new MissingSkillsFolderError(path);
    if (response.status !== 200) throw githubRequestFailure("contents", response.status, response.rateLimit);
    if (response.truncated || response.data.length >= GITHUB_CONTENTS_LISTING_LIMIT) throw new GitHubImportLimitError(path);
    return response.data;
  }

  /**
   * The file bytes come from the raw host rather than the listing's download_url: api.github.com answers
   * sixty anonymous requests an hour for the whole network, and the listing alone can spend them, while
   * the raw host carries the payload without touching that quota.
   */
  private async fetchFile(location: GitHubSkillLocation, entryPath: string, destination: string, maxBytes: number): Promise<number> {
    this.consumeRequest(entryPath);
    return this.dependencies.downloadFile(buildRawFileUrl(location, entryPath), destination, maxBytes);
  }

  private consumeRequest(path: string): void {
    this.requestBudget.consume(path);
  }
}


// A shared egress address runs through one unauthenticated quota between everyone behind it, so the
// usual failure is 403 rather than anything about the URL. The status alone sent people hunting for a
// broken link, so the quota and its window are named when the response says so.
export function githubRequestFailure(context: string, status: number, rateLimit?: GitHubRateLimitInfo, now = Date.now()): Error {
  const base = `GitHub ${context} request failed with status ${status}`;
  const quotaExhausted =
    (status === 403 || status === 429) &&
    rateLimit !== undefined &&
    (rateLimit.remaining === 0 || /rate limit/i.test(rateLimit.message ?? ""));
  if (quotaExhausted && rateLimit) {
    return new GitHubRateLimitedError(
      `${base}: this network has used up the GitHub quota it shares${resetPhrase(rateLimit, now)}.`,
      rateLimit.resetEpochSeconds
    );
  }
  const message = rateLimit?.message?.trim();
  return new Error(message ? `${base}: ${message}` : base);
}

// The quota lives in headers and the explanation lives in the body, and neither survives a bare status
// code, so both are lifted here while the response is still in hand. Header names are matched without
// regard to case because the proxy chain in between has been known to change them.
export function githubRateLimitFromResponse(headers: Record<string, string> | undefined, body: unknown): GitHubRateLimitInfo | undefined {
  const read = (name: string): string | undefined =>
    Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
  const count = (name: string): number | undefined => {
    const raw = read(name);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  const message = typeof (body as { message?: unknown } | null)?.message === "string" ? (body as { message: string }).message : undefined;
  const remaining = count("x-ratelimit-remaining");
  const limit = count("x-ratelimit-limit");
  const resetEpochSeconds = count("x-ratelimit-reset");
  if (remaining === undefined && limit === undefined && resetEpochSeconds === undefined && message === undefined) return undefined;
  return { remaining, limit, resetEpochSeconds, message };
}

function resetPhrase(rateLimit: GitHubRateLimitInfo, now: number): string {
  if (rateLimit.resetEpochSeconds === undefined) return "";
  const seconds = rateLimit.resetEpochSeconds - Math.floor(now / 1000);
  if (seconds <= 0) return ", and its window is turning over now";
  const minutes = Math.ceil(seconds / 60);
  return `, and it refills in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function resolveRootPath(location: GitHubSkillLocation): string {
  if (location.rootPath !== undefined) return location.rootPath;
  return location.skillsPath === "skills" ? "" : location.skillsPath.replace(/\/skills$/, "");
}

function appendGitHubPath(path: string, name: string): string {
  return path ? `${path}/${name}` : name;
}

function relativeToSkillsPath(skillsPath: string, path: string): string {
  const prefix = `${skillsPath}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Candidate names may now describe a nested skill, category/skill, so the guard walks the segments
 * instead of rejecting slashes: an empty segment, a dot or a parent reference could escape the skills
 * folder once the name is joined back onto it.
 */
function isSafeSkillPath(name: string): boolean {
  const segments = name.split("/");
  return segments.length > 0 && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("\\"));
}

function buildRawFileUrl(location: GitHubSkillLocation, entryPath: string): string {
  const encodedPath = entryPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  // HEAD asks the raw host for the repository default branch, which is what a refless location means
  const ref = location.ref ? encodeURIComponent(location.ref) : "HEAD";
  return `https://raw.githubusercontent.com/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}/${ref}/${encodedPath}`;
}

function isWithinPath(path: string, root: string): boolean {
  const pathSegments = path.split("/");
  const rootSegments = root.split("/");
  if (pathSegments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))) return false;

  return pathSegments.length > rootSegments.length && rootSegments.every((segment, index) => pathSegments[index] === segment);
}
