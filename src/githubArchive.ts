import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import type { DiscoveryResult } from "./skillDiscovery";
import {
  GitHubImportLimitError,
  InvalidGitHubUrlError,
  MissingSkillsFolderError,
  SkillTreeImporter,
  type GitHubDownloadLimits,
  type GitHubSkillCandidate,
  type GitHubSkillLocation,
  type GitHubTreeEntry,
  type GitHubTreeSource
} from "./githubImport";

const BLOCK = 512;

export interface GitHubArchiveLimits extends GitHubDownloadLimits {
  /** the gzip body as delivered, which is what sits in memory before anything is unpacked */
  maxCompressedBytes: number;
  /** the sum of the file sizes declared in the tar headers, checked as they are read */
  maxUnpackedBytes: number;
  maxEntries: number;
}

export const DEFAULT_ARCHIVE_LIMITS: GitHubArchiveLimits = {
  maxRequests: 20,
  maxFiles: 500,
  maxBytes: 50 * 1024 * 1024,
  maxDepth: 20,
  maxCompressedBytes: 64 * 1024 * 1024,
  maxUnpackedBytes: 256 * 1024 * 1024,
  maxEntries: 20000
};

/**
 * A repository too big to pull down. Said plainly, with the number that caused it, because the alternative
 * is a plugin that appears to hang while it tries.
 */
export class GitHubArchiveTooLargeError extends Error {
  constructor(unpackedBytes: number, capBytes: number, stage: "compressed" | "unpacked" = "unpacked") {
    super(
      `GitHub repository is ${formatBytes(unpackedBytes)} ${stage}, over the ${formatBytes(capBytes)} this plugin will download.\n` +
        "Use the npx command for this repository instead."
    );
    this.name = "GitHubArchiveTooLargeError";
  }
}

export class GitHubArchiveNotFoundError extends Error {
  constructor(owner: string, repo: string, candidates: string[]) {
    super(`GitHub has no downloadable archive for ${owner}/${repo}${candidates.length > 0 ? `: none of ${candidates.join(", ")} could be fetched` : ""}.`);
    this.name = "GitHubArchiveNotFoundError";
  }
}

export interface ArchiveEntry {
  path: string;
  type: "file" | "dir";
  size: number;
  bytes?: Buffer;
}

/**
 * A tar reader, kept to the handful of typeflags a git archive produces: regular files, directories, and
 * the two ways a path longer than a hundred characters is spelled. Anything else, links included, is
 * passed over: a skill folder needs bytes, and following a link out of the archive is exactly what a
 * downloaded archive must not do.
 */
export function parseTar(buffer: Buffer, limits: GitHubArchiveLimits = DEFAULT_ARCHIVE_LIMITS): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  let unpackedBytes = 0;
  let pendingName: string | undefined;

  while (offset + BLOCK <= buffer.byteLength) {
    const header = buffer.subarray(offset, offset + BLOCK);
    if (isZeroBlock(header)) break;

    const size = readOctal(header, 124, 12);
    const payloadStart = offset + BLOCK;
    const nextOffset = payloadStart + Math.ceil(size / BLOCK) * BLOCK;
    const typeFlag = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const payload = buffer.subarray(payloadStart, payloadStart + size);

    // a long name arrives as its own entry ahead of the one it names
    if (typeFlag === "L") {
      pendingName = payload.toString("utf8").replace(/\0+$/, "");
      offset = nextOffset;
      continue;
    }
    if (typeFlag === "x" || typeFlag === "g") {
      const extended = readPaxPath(payload.toString("utf8"));
      if (extended !== undefined) pendingName = extended;
      offset = nextOffset;
      continue;
    }

    const prefix = readString(header, 345, 155);
    const rawName = prefix ? `${prefix}/${readString(header, 0, 100)}` : readString(header, 0, 100);
    const name = pendingName ?? normalizeArchivePath(rawName);
    pendingName = undefined;

    if (name === undefined) {
      // a path that tries to climb out of the archive is dropped rather than clamped, so nothing
      // downstream has to remember whether this entry was rescued or refused
      offset = nextOffset;
      continue;
    }

    if (typeFlag === "5") {
      entries.push({ path: name, type: "dir", size: 0 });
    } else if (typeFlag === "0" || typeFlag === "7") {
      unpackedBytes += size;
      if (unpackedBytes > limits.maxUnpackedBytes) throw new GitHubArchiveTooLargeError(unpackedBytes, limits.maxUnpackedBytes);
      if (entries.length >= limits.maxEntries) throw new GitHubArchiveTooLargeError(unpackedBytes, limits.maxUnpackedBytes);
      entries.push({ path: name, type: "file", size, bytes: Buffer.from(payload) });
    }

    offset = nextOffset;
  }

  return entries;
}

/**
 * git prefixes every archive with a folder named after the repository and ref, which would otherwise
 * become the only entry anybody sees at the root and hide every skill from the listing.
 */
export function stripArchiveRoot(entries: ArchiveEntry[]): ArchiveEntry[] {
  const first = entries[0]?.path.split("/")[0];
  if (!first) return entries;
  const inside = `${first}/`;
  // git names the folder it wrapped the repository in, and then lists that folder as an entry of its own,
  // so the root matches itself as well as containing everything else. Requiring one entry to sit inside
  // it as well stops a lone file at the root from being mistaken for a wrapper and deleted.
  const covered = entries.every((entry) => entry.path === first || entry.path.startsWith(inside));
  if (!covered || !entries.some((entry) => entry.path.startsWith(inside))) return entries;
  return entries
    .map((entry) => (entry.path === first ? { ...entry, path: "" } : entry.path.startsWith(inside) ? { ...entry, path: entry.path.slice(inside.length) } : entry))
    .filter((entry) => entry.path.length > 0);
}

/**
 * gunzip without a dependency: the renderer already has the platform decoder, and Node has had it since
 * nineteen, so nothing needs to be pulled in for one format.
 */
export async function gunzip(buffer: Buffer): Promise<Buffer> {
  if (typeof globalThis.DecompressionStream !== "function") {
    throw new Error("This build cannot unpack gzip data.");
  }
  const decompressed = new Blob([new Uint8Array(buffer)]).stream().pipeThrough(new globalThis.DecompressionStream("gzip"));
  const bytes = await new Response(decompressed).arrayBuffer();
  return Buffer.from(bytes);
}

export class GitHubArchiveTreeSource implements GitHubTreeSource {
  private readonly children = new Map<string, GitHubTreeEntry[]>();
  private readonly files = new Map<string, Buffer>();

  constructor(entries: ArchiveEntry[]) {
    const knownDirectories = new Set<string>();
    const register = (dirPath: string, type: "dir", size: number) => {
      if (dirPath === "") return;
      const parent = dirPath.includes("/") ? dirPath.slice(0, dirPath.lastIndexOf("/")) : "";
      const name = parent ? dirPath.slice(parent.length + 1) : dirPath;
      if (!this.children.has(parent)) this.children.set(parent, []);
      const siblings = this.children.get(parent)!;
      if (!siblings.some((sibling) => sibling.name === name)) siblings.push({ type, name, path: dirPath, size });
    };

    for (const entry of entries) {
      const parent = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
      // every ancestor of a file is a folder whether or not the archive spells it out: git includes the
      // entries, other packers do not, and a listing that missed them would hide the skills underneath
      for (let cursor = parent; cursor; cursor = cursor.includes("/") ? cursor.slice(0, cursor.lastIndexOf("/")) : "") {
        if (knownDirectories.has(cursor)) break;
        knownDirectories.add(cursor);
        register(cursor, "dir", 0);
      }
      if (entry.type === "dir") {
        register(entry.path, "dir", 0);
        knownDirectories.add(entry.path);
        if (!this.children.has(entry.path)) this.children.set(entry.path, []);
        continue;
      }

      if (!this.children.has(parent)) this.children.set(parent, []);
      const name = parent ? entry.path.slice(parent.length + 1) : entry.path;
      const siblings = this.children.get(parent)!;
      if (!siblings.some((sibling) => sibling.name === name)) siblings.push({ type: "file", name, path: entry.path, size: entry.size });
      if (entry.bytes !== undefined) this.files.set(entry.path, entry.bytes);
    }

    // a repository with anything at all has a root to list, even one whose entries are all nested
    if (entries.length > 0 && !this.children.has("")) this.children.set("", []);
    for (const siblings of this.children.values()) siblings.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async list(path: string): Promise<GitHubTreeEntry[]> {
    const key = path.replace(/^\.?\/+|\/+$/g, "");
    const siblings = this.children.get(key);
    // the contents API answers 404 for a folder that is not there, and the archive path has to say the
    // same thing or the two routes disagree about what a missing skills folder means
    if (siblings === undefined) throw new MissingSkillsFolderError(key);
    return [...siblings];
  }

  async readFile(path: string, destination: string, maxBytes: number): Promise<number> {
    const key = path.replace(/^\.?\/+|\/+$/g, "");
    const bytes = this.files.get(key);
    if (bytes === undefined) throw new MissingSkillsFolderError(key);
    if (bytes.byteLength > maxBytes) throw new GitHubImportLimitError(key);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    return bytes.byteLength;
  }
}

export interface GitHubArchiveDependencies {
  /** GET the archive. The body is buffered by the caller, so maxBytes bounds what that costs. */
  fetchArchive(url: string, maxBytes: number): Promise<{ status: number; body: ArrayBuffer }>;
  /** HEAD the archive, which is how a ref is checked without paying for the bytes of a wrong guess. */
  probeArchive(url: string): Promise<boolean>;
}

/** The slice of an http response the archive route reads, shaped so Obsidian's requestUrl satisfies it. */
export interface GitHubArchiveResponse {
  status: number;
  arrayBuffer: ArrayBuffer;
  text?: string;
}

export interface GitHubArchiveRequest {
  (url: string, method?: string): Promise<GitHubArchiveResponse>;
}

/**
 * The two requests the archive route makes, expressed once so the plugin hands this to its http client and
 * the wiring is testable without one. The size guard sits here rather than in the caller because a client
 * that has already buffered the body cannot be told to stop; it can be told to throw.
 */
export function createArchiveDependencies(request: GitHubArchiveRequest): GitHubArchiveDependencies {
  return {
    fetchArchive: async (url, maxBytes) => {
      const response = await request(url);
      const bytes = response.arrayBuffer.byteLength;
      if (bytes > maxBytes) throw new GitHubArchiveTooLargeError(bytes, maxBytes, "compressed");
      return { status: response.status, body: response.arrayBuffer };
    },
    probeArchive: async (url) => (await request(url, "HEAD")).status === 200
  };
}

/**
 * The repository page carries the default branch in the description of itself, which is how the archive
 * route answers the one question codeload cannot. Only reached when the cheaper probes miss.
 */
export function defaultBranchFromPage(html: string | undefined): string | undefined {
  const match = html ? /"defaultBranch":"([^"]{1,200})"/.exec(html) : null;
  return match ? match[1] : undefined;
}

/**
 * Reaches a repository through codeload instead of the api. The api answers sixty anonymous requests an
 * hour for every machine behind one address, which an office spends before lunch; the archive host carries
 * the whole repository in a single request and does not count them. One download yields the tree and every
 * file, so listing and fetching both happen out of memory.
 */
export class GitHubArchiveDownloader {
  private readonly limits: GitHubArchiveLimits;
  /**
   * The archive answers both the listing and every file, so downloading it twice for one import would be
   * the whole cost of the import paid twice. A failed load is dropped rather than kept, so a retry can try
   * again rather than replaying the same rejection.
   */
  private readonly loaded = new Map<string, Promise<{ ref: string; source: GitHubArchiveTreeSource }>>();

  constructor(private readonly dependencies: GitHubArchiveDependencies, limits: Partial<GitHubArchiveLimits> = {}) {
    this.limits = { ...DEFAULT_ARCHIVE_LIMITS, ...limits };
  }

  static archiveUrl(location: Pick<GitHubSkillLocation, "owner" | "repo">, ref: string): string {
    return `https://codeload.github.com/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}/tar.gz/${ref
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  }

  /**
   * The ref is the one question the archive host cannot answer for a bare repository URL. A ref spelled in
   * the URL is honoured and nothing else: replacing a branch that has gone away with the default one would
   * import different work than the person pointed at. With no ref to go on, the branch the repository page
   * names is tried, then the two names nearly every repository has used, each settled by a HEAD that costs
   * nothing on a wrong guess.
   */
  async resolveRef(location: Pick<GitHubSkillLocation, "owner" | "repo">, options: { ref?: string; defaultBranch?: string } = {}): Promise<string> {
    if (options.ref) {
      if (await this.dependencies.probeArchive(GitHubArchiveDownloader.archiveUrl(location, options.ref))) return options.ref;
      throw new GitHubArchiveNotFoundError(location.owner, location.repo, [options.ref]);
    }

    const candidates: string[] = [];
    for (const candidate of [options.defaultBranch, "main", "master"]) {
      if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
    }

    for (const candidate of candidates) {
      if (await this.dependencies.probeArchive(GitHubArchiveDownloader.archiveUrl(location, candidate))) return candidate;
    }

    throw new GitHubArchiveNotFoundError(location.owner, location.repo, candidates);
  }

  load(location: GitHubSkillLocation, defaultBranch?: string): Promise<{ ref: string; source: GitHubArchiveTreeSource }> {
    const key = `${location.owner}/${location.repo}/${location.ref ?? defaultBranch ?? ""}`;
    const existing = this.loaded.get(key);
    if (existing) return existing;

    const pending = this.fetchArchive(location, defaultBranch).catch((error: unknown) => {
      this.loaded.delete(key);
      throw error;
    });
    this.loaded.set(key, pending);
    return pending;
  }

  private async fetchArchive(location: GitHubSkillLocation, defaultBranch?: string): Promise<{ ref: string; source: GitHubArchiveTreeSource }> {
    const ref = await this.resolveRef(location, { ref: location.ref, defaultBranch });
    const response = await this.dependencies.fetchArchive(GitHubArchiveDownloader.archiveUrl(location, ref), this.limits.maxCompressedBytes);
    if (response.status !== 200) {
      throw new Error(`GitHub archive request failed with status ${response.status}`);
    }

    const compressed = Buffer.from(response.body);
    if (compressed.byteLength > this.limits.maxCompressedBytes) {
      throw new GitHubArchiveTooLargeError(compressed.byteLength, this.limits.maxCompressedBytes, "compressed");
    }

    const entries = stripArchiveRoot(parseTar(await gunzip(compressed), this.limits));
    return { ref, source: new GitHubArchiveTreeSource(entries) };
  }

  async listSkillCandidates(location: GitHubSkillLocation, defaultBranch?: string): Promise<GitHubSkillCandidate[]> {
    return (await this.importer(location, defaultBranch)).listSkillCandidates();
  }

  async downloadSkillCandidate(
    location: GitHubSkillLocation,
    candidate: GitHubSkillCandidate,
    destination: string,
    defaultBranch?: string
  ): Promise<DiscoveryResult> {
    return (await this.importer(location, defaultBranch)).downloadCandidate(candidate, destination);
  }

  private async importer(location: GitHubSkillLocation, defaultBranch?: string): Promise<SkillTreeImporter> {
    if (!location.ref && defaultBranch === undefined) throw new InvalidGitHubUrlError(`${location.owner}/${location.repo}`);
    const { source } = await this.load(location, defaultBranch);
    return new SkillTreeImporter(source, location, this.limits);
  }
}

function isZeroBlock(header: Buffer): boolean {
  for (let index = 0; index < BLOCK; index += 1) if (header[index] !== 0) return false;
  return true;
}

function readString(header: Buffer, start: number, length: number): string {
  const end = header.indexOf(0, start);
  const stop = end === -1 || end > start + length ? start + length : end;
  return header.toString("utf8", start, stop).trim();
}

function readOctal(header: Buffer, start: number, length: number): number {
  const digits = readString(header, start, length);
  if (!digits) return 0;
  const value = parseInt(digits, 8);
  return Number.isFinite(value) ? value : 0;
}

/** pax headers carry `length keyword=value` records, and path= is the one that outranks the tar header. */
function readPaxPath(payload: string): string | undefined {
  let path: string | undefined;
  for (const record of payload.split("\n")) {
    const separator = record.indexOf(" ");
    if (separator <= 0) continue;
    const length = Number(record.slice(0, separator));
    if (!Number.isFinite(length) || length <= 0 || length !== record.length + 1) continue;
    const [keyword, ...rest] = record.slice(separator + 1).split("=");
    if (keyword === "path") path = rest.join("=");
  }
  return path;
}

/**
 * Paths inside an archive are relative and slash separated. Anything absolute, empty, or climbing with ..
 * is refused rather than repaired, because these paths are later joined onto a staging directory.
 */
function normalizeArchivePath(raw: string): string | undefined {
  const cleaned = raw.replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+$/, "");
  if (!cleaned) return undefined;
  const segments = cleaned.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return undefined;
  return cleaned;
}

function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(1)} GB`;
  if (megabytes >= 10) return `${Math.round(megabytes)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
