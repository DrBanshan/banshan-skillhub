"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SkillHubPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");
var import_promises7 = require("fs/promises");
var import_path8 = require("path");

// src/errors.ts
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function combineErrors(primary, secondary, context) {
  const combined = new Error(`${errorMessage(primary)}; ${context}: ${errorMessage(secondary)}`);
  combined.cause = primary;
  return combined;
}

// src/exportService.ts
var import_promises2 = require("fs/promises");
var import_path2 = require("path");

// src/events.ts
function createSkillEvent(type, skillId, details, at = (/* @__PURE__ */ new Date()).toISOString()) {
  return {
    id: `${at}-${Math.random().toString(36).slice(2, 10)}`,
    skillId,
    type,
    at,
    details
  };
}

// src/vaultPaths.ts
var import_promises = require("fs/promises");
var import_path = require("path");
var UnsafeVaultPathError = class extends Error {
  constructor(relativePath) {
    super(`Path must be a non-empty vault-relative path: ${relativePath}`);
    this.name = "UnsafeVaultPathError";
  }
};
function resolveVaultRelativePath(vaultPath, relativePath, options) {
  const trimmed = relativePath.trim();
  if (!trimmed || trimmed === "." || (0, import_path.isAbsolute)(trimmed) || import_path.win32.isAbsolute(trimmed)) {
    throw new UnsafeVaultPathError(relativePath);
  }
  const normalized = trimmed.replace(/[\\/]+/g, import_path.sep);
  const resolvedVault = (0, import_path.resolve)(vaultPath);
  const resolvedPath = (0, import_path.resolve)(resolvedVault, normalized);
  const pathFromVault = (0, import_path.relative)(resolvedVault, resolvedPath);
  if (!pathFromVault || pathFromVault === ".." || pathFromVault.startsWith(`..${import_path.sep}`) || (0, import_path.isAbsolute)(pathFromVault)) {
    throw new UnsafeVaultPathError(relativePath);
  }
  return (options == null ? void 0 : options.verifyFilesystem) ? verifyExistingAncestor(resolvedVault, resolvedPath, relativePath) : resolvedPath;
}
async function removeVaultRelativePath(vaultPath, relativePath) {
  const resolvedPath = await resolveVaultRelativePath(vaultPath, relativePath, { verifyFilesystem: true });
  await (0, import_promises.rm)(resolvedPath, { force: true, recursive: true });
}
async function verifyExistingAncestor(vaultPath, targetPath, relativePath) {
  const realVaultPath = await (0, import_promises.realpath)(vaultPath);
  let candidate = targetPath;
  while (true) {
    try {
      const realCandidate = await (0, import_promises.realpath)(candidate);
      const pathFromVault = (0, import_path.relative)(realVaultPath, realCandidate);
      if (pathFromVault === ".." || pathFromVault.startsWith(`..${import_path.sep}`) || (0, import_path.isAbsolute)(pathFromVault)) {
        throw new Error(`Resolved path is outside the vault: ${relativePath}`);
      }
      return targetPath;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = (0, import_path.dirname)(candidate);
      if (parent === candidate) throw new UnsafeVaultPathError(relativePath);
      candidate = parent;
    }
  }
}

// src/exportService.ts
async function ensureAgentsSkillsDir(targetDir) {
  const agentsSkillsDir = (0, import_path2.join)(targetDir, ".agents", "skills");
  await (0, import_promises2.mkdir)(agentsSkillsDir, { recursive: true });
  return agentsSkillsDir;
}
async function inspectDestination(destination) {
  try {
    const stats = await (0, import_promises2.lstat)(destination);
    if (stats.isSymbolicLink()) return "symlink";
    if (stats.isDirectory() || stats.isFile()) return "real";
    return "other";
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
}
async function installBySymlink(source, destination, conflictBehavior) {
  const state = await inspectDestination(destination);
  if (state === "symlink" && conflictBehavior === "replace-symlinks") {
    await (0, import_promises2.unlink)(destination);
    await (0, import_promises2.symlink)(source, destination, "dir");
    return "replaced";
  }
  if (state !== "missing") return "skipped";
  await (0, import_promises2.symlink)(source, destination, "dir");
  return "installed";
}
async function installByCopy(source, destination) {
  if (await inspectDestination(destination) !== "missing") return "skipped";
  try {
    await (0, import_promises2.mkdir)(destination);
  } catch (error) {
    if (error.code === "EEXIST") return "skipped";
    throw error;
  }
  await (0, import_promises2.cp)(source, destination, { recursive: true, force: false, errorOnExist: true });
  return "installed";
}
function formatInstallError(error, method) {
  const code = error.code;
  if (method === "symlink" && process.platform === "win32" && (code === "EPERM" || code === "EACCES")) {
    return "Windows blocked symlink creation. Enable Developer Mode or run Obsidian with elevated permissions.";
  }
  return error instanceof Error ? error.message : String(error);
}
var SkillExportService = class {
  constructor(registry) {
    this.registry = registry;
  }
  async installSkills(records, targetDir, options) {
    const summary = { installed: [], skipped: [], replaced: [], failed: [] };
    let agentsSkillsDir;
    try {
      agentsSkillsDir = await ensureAgentsSkillsDir(targetDir);
    } catch (error) {
      const reason = formatInstallError(error, options.method);
      summary.failed.push(...records.map((record) => ({ skillId: record.id, reason })));
      return summary;
    }
    for (const record of records) {
      const destination = (0, import_path2.join)(agentsSkillsDir, record.folderName);
      try {
        const source = await resolveVaultRelativePath(options.vaultPath, record.vaultPath, { verifyFilesystem: true });
        const result = options.method === "symlink" ? await installBySymlink(source, destination, options.conflictBehavior) : await installByCopy(source, destination);
        summary[result].push(record.id);
        if (result !== "skipped") {
          const timestamp = (/* @__PURE__ */ new Date()).toISOString();
          this.registry.incrementInstall(record.id, timestamp);
          this.registry.recordEvent(createSkillEvent("skill_installed", record.id, { method: options.method }, timestamp));
        }
      } catch (error) {
        summary.failed.push({ skillId: record.id, reason: formatInstallError(error, options.method) });
      }
    }
    return summary;
  }
};

// src/folderPicker.ts
var import_electron = require("electron");

// src/folderDialog.ts
var import_path3 = require("path");
async function selectNativeFolder(dialog) {
  if (!dialog) {
    throw new Error("Native folder selection is unavailable because the Electron native folder dialog is unavailable.");
  }
  const result = await dialog.showOpenDialog({
    title: "Choose a folder",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled) return void 0;
  const selectedPath = result.filePaths[0];
  if (!selectedPath || !(0, import_path3.isAbsolute)(selectedPath)) {
    throw new Error("Native folder selection did not return an absolute folder path.");
  }
  return selectedPath;
}

// src/folderPicker.ts
async function pickNativeFolder() {
  var _a;
  return selectNativeFolder((_a = import_electron.remote) == null ? void 0 : _a.dialog);
}

// src/githubImport.ts
var import_promises4 = require("fs/promises");
var import_path5 = require("path");

// src/skillDiscovery.ts
var import_promises3 = require("fs/promises");
var import_path4 = require("path");
var defaultDiscoveryDependencies = {
  readFile: (path) => (0, import_promises3.readFile)(path, "utf8")
};
function resolveSkillsRootCandidates(scanRoot) {
  if ((0, import_path4.basename)(scanRoot) === "skills") return [scanRoot];
  return [(0, import_path4.join)(scanRoot, "skills"), (0, import_path4.join)(scanRoot, ".agents", "skills")];
}
function formatMissingSkillsFolderMessage() {
  return "No skills or .agents/skills folder was found in the selected directory.";
}
function parseSkillMarkdown(markdown, folderName) {
  var _a;
  const lines = markdown.split(/\r?\n/);
  const warnings = [];
  let frontmatter = [];
  let malformed = false;
  if (((_a = lines[0]) == null ? void 0 : _a.trim()) !== "---") {
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
async function discoverSkills(scanRoot, dependencies = defaultDiscoveryDependencies) {
  let skillsRoot;
  for (const candidate of resolveSkillsRootCandidates(scanRoot)) {
    try {
      await (0, import_promises3.access)(candidate);
      skillsRoot = candidate;
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!skillsRoot) return { skills: [], missingSkillsFolder: true, warnings: [] };
  const entries = (await (0, import_promises3.readdir)(skillsRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const skills = [];
  const warnings = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = (0, import_path4.join)(skillsRoot, entry.name);
    const markdownPath = (0, import_path4.join)(skillPath, "SKILL.md");
    try {
      const markdown = await dependencies.readFile(markdownPath);
      const metadata = parseSkillMarkdown(markdown, entry.name);
      skills.push({ folderName: entry.name, path: skillPath, metadata, warnings: metadata.warnings });
    } catch (error) {
      if (error.code !== "ENOENT") {
        warnings.push({ path: markdownPath, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { skills, missingSkillsFolder: false, warnings };
}

// src/githubImport.ts
var GITHUB_CONTENTS_LISTING_LIMIT = 1e3;
var DEFAULT_GITHUB_REF_PROBE_LIMIT = 20;
var DEFAULT_DOWNLOAD_LIMITS = {
  maxRequests: 200,
  maxFiles: 500,
  maxBytes: 50 * 1024 * 1024,
  maxDepth: 20
};
var InvalidGitHubUrlError = class extends Error {
  constructor(input) {
    super(`Invalid GitHub URL: ${input}`);
    this.name = "InvalidGitHubUrlError";
  }
};
var MissingSkillsFolderError = class extends Error {
  constructor(path) {
    super(`GitHub skills folder or root SKILL.md not found: ${path || "/"}`);
    this.name = "MissingSkillsFolderError";
  }
};
var GitHubImportLimitError = class extends Error {
  constructor(path) {
    super(`GitHub listing is incomplete or too large: ${path}`);
    this.name = "GitHubImportLimitError";
  }
};
async function writeBoundedGitHubResponse(response, destination, maxBytes, write = (path, data) => (0, import_promises4.writeFile)(path, data)) {
  var _a;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`GitHub download request failed with status ${response.status}`);
  }
  const contentLengthHeader = (_a = Object.entries(response.headers).find(([name]) => name.toLowerCase() === "content-length")) == null ? void 0 : _a[1];
  const contentLength = contentLengthHeader === void 0 ? void 0 : Number(contentLengthHeader);
  if (contentLength !== void 0 && Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new GitHubImportLimitError(destination);
  }
  const buffer = Buffer.from(response.arrayBuffer);
  if (buffer.byteLength > maxBytes) throw new GitHubImportLimitError(destination);
  await write(destination, buffer);
  return buffer.byteLength;
}
var GitHubRequestBudget = class {
  constructor(maxRequests = DEFAULT_DOWNLOAD_LIMITS.maxRequests) {
    this.maxRequests = maxRequests;
    this.requests = 0;
  }
  get remainingRequests() {
    return Math.max(0, this.maxRequests - this.requests);
  }
  consume(path) {
    if (this.requests >= this.maxRequests) throw new GitHubImportLimitError(path);
    this.requests += 1;
  }
};
function parseGitHubSkillUrl(input, options = {}) {
  let url;
  try {
    url = new URL(input);
  } catch (e) {
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
async function resolveGitHubSkillUrl(input, refExists, options = {}) {
  var _a, _b, _c;
  const fallback = parseGitHubSkillUrl(input);
  if (!fallback.ref) return fallback;
  if (/^[0-9a-f]{40}$/i.test(fallback.ref)) return fallback;
  const treeSegments = new URL(input).pathname.split("/").filter(Boolean).slice(3);
  const configuredProbeLimit = Math.max(0, Math.floor((_a = options.maxProbes) != null ? _a : DEFAULT_GITHUB_REF_PROBE_LIMIT));
  const maxProbes = Math.min(configuredProbeLimit, (_c = (_b = options.requestBudget) == null ? void 0 : _b.remainingRequests) != null ? _c : configuredProbeLimit);
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
function resolveRef(treeSegments, knownRefs) {
  if (knownRefs) {
    const matchingRefs = knownRefs.filter((candidate) => treeSegments.join("/").startsWith(`${candidate}/`) || treeSegments.join("/") === candidate);
    if (matchingRefs.length > 0) return matchingRefs.sort((a, b) => b.length - a.length)[0];
  }
  return treeSegments[0];
}
var GitHubSkillDownloader = class {
  constructor(dependencies, limits = {}, requestBudget) {
    this.dependencies = dependencies;
    this.files = 0;
    this.bytes = 0;
    this.limits = { ...DEFAULT_DOWNLOAD_LIMITS, ...limits };
    this.requestBudget = requestBudget != null ? requestBudget : new GitHubRequestBudget(this.limits.maxRequests);
  }
  async listSkillFolders(location) {
    const entries = await this.listContents(location, location.skillsPath);
    return entries.filter((entry) => entry.type === "dir").map((entry) => entry.name);
  }
  async listSkillCandidates(location) {
    var _a;
    const rootPath = resolveRootPath(location);
    const rootEntries = await this.listContents(location, rootPath);
    const rootSkillPath = appendGitHubPath(rootPath, "SKILL.md");
    const hasRootSkill = rootEntries.some((entry) => entry.type === "file" && entry.name === "SKILL.md" && entry.path === rootSkillPath);
    const candidates = [];
    if (hasRootSkill) {
      const name = (_a = rootPath.split("/").filter(Boolean).at(-1)) != null ? _a : location.repo;
      candidates.push({ kind: "root", name, label: `${name} (root SKILL.md)` });
    }
    if (rootPath === location.skillsPath) {
      candidates.push(...rootEntries.filter((entry) => entry.type === "dir").map((entry) => ({ kind: "folder", name: entry.name, label: entry.name })));
    } else if (rootEntries.some((entry) => entry.type === "dir" && entry.path === location.skillsPath)) {
      const folders = await this.listSkillFolders(location);
      candidates.push(...folders.map((name) => ({ kind: "folder", name, label: name })));
    }
    if (candidates.length === 0) throw new MissingSkillsFolderError(rootPath);
    return candidates;
  }
  async downloadSkillCandidate(location, candidate, destination) {
    if (candidate.kind === "folder") return this.downloadSkillFolder(location, candidate.name, destination);
    return this.downloadRootSkill(location, destination);
  }
  async downloadSkillFolder(location, folderName, destination) {
    if (!folderName || folderName.includes("/") || folderName.includes("\\")) throw new InvalidGitHubUrlError(folderName);
    const selectedPath = `${location.skillsPath}/${folderName}`;
    await this.downloadContents(location, selectedPath, destination, selectedPath, 0);
    return discoverSkills(destination);
  }
  async downloadRootSkill(location, destination) {
    var _a;
    const rootPath = resolveRootPath(location);
    const rootSkillPath = appendGitHubPath(rootPath, "SKILL.md");
    const entries = await this.listContents(location, rootPath);
    const entry = entries.find((item) => item.type === "file" && item.name === "SKILL.md" && item.path === rootSkillPath);
    if (!entry) throw new MissingSkillsFolderError(rootPath);
    const folderName = (_a = rootPath.split("/").filter(Boolean).at(-1)) != null ? _a : location.repo;
    if (!folderName || folderName.includes("/") || folderName.includes("\\")) throw new InvalidGitHubUrlError(folderName);
    await this.downloadFileEntry(entry, (0, import_path5.join)(destination, "skills", folderName, "SKILL.md"));
    return discoverSkills(destination);
  }
  async downloadContents(location, path, destination, selectedPath, depth) {
    if (depth > this.limits.maxDepth) throw new GitHubImportLimitError(path);
    const entries = await this.listContents(location, path);
    for (const entry of entries) {
      if (!isWithinPath(entry.path, selectedPath)) continue;
      if (entry.type === "dir") {
        await this.downloadContents(location, entry.path, destination, selectedPath, depth + 1);
        continue;
      }
      const stagedPath = (0, import_path5.join)(destination, "skills", entry.path.slice(`${location.skillsPath}/`.length));
      await this.downloadFileEntry(entry, stagedPath);
    }
  }
  async downloadFileEntry(entry, stagedPath) {
    if (!entry.download_url) throw new GitHubImportLimitError(entry.path);
    if (this.files >= this.limits.maxFiles) throw new GitHubImportLimitError(entry.path);
    if (typeof entry.size === "number" && this.bytes + entry.size > this.limits.maxBytes) {
      throw new GitHubImportLimitError(entry.path);
    }
    this.consumeRequest(entry.path);
    this.files += 1;
    await (0, import_promises4.mkdir)((0, import_path5.dirname)(stagedPath), { recursive: true });
    const downloadedBytes = await this.dependencies.downloadFile(entry.download_url, stagedPath, this.limits.maxBytes - this.bytes);
    this.bytes += downloadedBytes;
    if (!Number.isFinite(downloadedBytes) || downloadedBytes < 0 || this.bytes > this.limits.maxBytes) {
      throw new GitHubImportLimitError(entry.path);
    }
  }
  async listContents(location, path) {
    this.consumeRequest(path);
    const query = location.ref ? `?ref=${encodeURIComponent(location.ref)}` : "";
    const contentsPath = path ? `/contents/${path}` : "/contents";
    const response = await this.dependencies.fetchJson(`/repos/${location.owner}/${location.repo}${contentsPath}${query}`);
    if (response.status === 404) throw new MissingSkillsFolderError(path);
    if (response.status !== 200) throw new Error(`GitHub contents request failed with status ${response.status}`);
    if (response.truncated || response.data.length >= GITHUB_CONTENTS_LISTING_LIMIT) throw new GitHubImportLimitError(path);
    return response.data;
  }
  consumeRequest(path) {
    this.requestBudget.consume(path);
  }
};
function resolveRootPath(location) {
  if (location.rootPath !== void 0) return location.rootPath;
  return location.skillsPath === "skills" ? "" : location.skillsPath.replace(/\/skills$/, "");
}
function appendGitHubPath(path, name) {
  return path ? `${path}/${name}` : name;
}
function isWithinPath(path, root) {
  const pathSegments = path.split("/");
  const rootSegments = root.split("/");
  if (pathSegments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))) return false;
  return pathSegments.length > rootSegments.length && rootSegments.every((segment, index) => pathSegments[index] === segment);
}

// src/importService.ts
var import_promises5 = require("fs/promises");
var import_path6 = require("path");
function toError(error) {
  return error instanceof Error ? error : new Error(String(error));
}
async function createCollisionSafeFolderName(baseName, exists) {
  if (!await exists(baseName)) return baseName;
  let suffix = 2;
  while (await exists(`${baseName}-${suffix}`)) suffix += 1;
  return `${baseName}-${suffix}`;
}
var SkillImportService = class {
  constructor(registry, settings) {
    this.registry = registry;
    this.settings = settings;
  }
  async importDiscoveredSkills(discovered, options) {
    var _a;
    const destinationRoot = await resolveVaultRelativePath(options.vaultPath, this.settings.skillFolder, { verifyFilesystem: true });
    const imported = [];
    const copyAttempts = [];
    const eventsStart = this.registry.data.events.length;
    let operationError;
    try {
      await (0, import_promises5.mkdir)(destinationRoot, { recursive: true });
      for (const skill of discovered) {
        const folderName = await createCollisionSafeFolderName(skill.folderName, async (candidate) => {
          try {
            await (0, import_promises5.access)((0, import_path6.join)(destinationRoot, candidate));
            return true;
          } catch (e) {
            return false;
          }
        });
        const vaultRelativePath = (0, import_path6.join)(this.settings.skillFolder, folderName);
        const destination = await resolveVaultRelativePath(options.vaultPath, vaultRelativePath, { verifyFilesystem: true });
        const timestamp = (/* @__PURE__ */ new Date()).toISOString();
        const record = {
          id: `${folderName}-${Math.random().toString(36).slice(2, 10)}`,
          folderName,
          vaultPath: (0, import_path6.relative)(options.vaultPath, destination).split(import_path6.sep).join("/"),
          originalName: skill.metadata.name,
          nickname: skill.metadata.name,
          description: skill.metadata.description,
          tags: [],
          collectionIds: [],
          source: options.source,
          importMethod: options.importMethod,
          warnings: skill.warnings,
          importedAt: timestamp,
          updatedAt: timestamp,
          installCount: 0
        };
        copyAttempts.push({ destination, record });
        await (0, import_promises5.cp)(skill.path, destination, { recursive: true, force: false, errorOnExist: true });
        imported.push(record);
      }
      for (const record of imported) {
        this.registry.upsertSkill(record);
        this.registry.recordEvent(createSkillEvent("skill_imported", record.id, { method: options.importMethod }, record.importedAt));
      }
      await ((_a = options.persist) == null ? void 0 : _a.call(options));
      return { imported };
    } catch (error) {
      const cleanupFailures = [];
      for (const attempt of copyAttempts) {
        try {
          await (0, import_promises5.rm)(attempt.destination, { force: true, recursive: true });
        } catch (cleanupError) {
          cleanupFailures.push({ record: attempt.record, error: cleanupError });
        }
      }
      for (const record of imported) this.registry.deleteSkill(record.id);
      this.registry.data.events.splice(eventsStart);
      operationError = error;
      if (cleanupFailures.length > 0) {
        for (const failure of cleanupFailures) {
          this.registry.upsertSkill(failure.record);
          this.registry.recordEvent(createSkillEvent(
            "skill_imported",
            failure.record.id,
            { method: options.importMethod, rollbackCleanupFailed: true },
            failure.record.importedAt
          ));
        }
        operationError = combineErrors(
          operationError,
          cleanupFailures.map((failure) => failure.error instanceof Error ? failure.error.message : String(failure.error)).join("; "),
          "rollback cleanup failed"
        );
        if (options.persist) {
          try {
            await options.persist();
          } catch (persistError) {
            operationError = combineErrors(operationError, persistError, "retained metadata persistence failed");
          }
        }
      }
      const importError = toError(operationError);
      throw importError;
    } finally {
      if (options.stagingPath) {
        try {
          await (0, import_promises5.rm)(options.stagingPath, { force: true, recursive: true });
        } catch (cleanupError) {
          const cleanupCombinedError = operationError ? combineErrors(operationError, cleanupError, "staging cleanup failed") : combineErrors("Import completed", cleanupError, "staging cleanup failed");
          await Promise.reject(cleanupCombinedError);
        }
      }
    }
  }
};

// src/localImport.ts
var import_child_process = require("child_process");
var import_promises6 = require("fs/promises");
var import_path7 = require("path");
var import_util = require("util");
var defaultExecFile = async (file, args, options) => {
  return (0, import_util.promisify)(import_child_process.execFile)(file, args, options);
};
function userShell() {
  var _a, _b;
  if (process.platform === "win32") return (_a = process.env.ComSpec) != null ? _a : "cmd.exe";
  return (_b = process.env.SHELL) != null ? _b : "/bin/sh";
}
function npxLookupArgs() {
  if (process.platform === "win32") return [["/d", "/s", "/c", "where npx"]];
  return [["-lc", "command -v npx"], ["-lic", "command -v npx"]];
}
function stdoutFromExecResult(result) {
  if (!result || typeof result !== "object" || !("stdout" in result)) return "";
  const stdout = result.stdout;
  return typeof stdout === "string" || Buffer.isBuffer(stdout) ? stdout.toString() : "";
}
function parseCommand(command) {
  const tokens = [];
  let token = "";
  let quote;
  let escaping = false;
  for (const character of command.trim()) {
    if (escaping) {
      token += character;
      escaping = false;
    } else if (character === "\\" && quote !== "'") {
      escaping = true;
    } else if (quote) {
      if (character === quote) quote = void 0;
      else token += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
    } else {
      token += character;
    }
  }
  if (escaping || quote) throw new Error("Invalid npx skills command: unmatched quote or escape");
  if (token) tokens.push(token);
  return tokens;
}
function validateNpxSkillsCommand(command) {
  try {
    normalizeNpxSkillsCommand(command);
    return true;
  } catch (e) {
    return false;
  }
}
function normalizeNpxSkillsCommand(command) {
  const tokens = parseCommand(command);
  if (tokens[0] !== "npx" || tokens[1] !== "skills" || tokens[2] !== "add" || !tokens[3]) {
    throw new Error("Invalid npx skills command");
  }
  if (tokens.some((token) => token === "--global" || token.startsWith("--global=") || /^-[^-]*g/.test(token))) {
    throw new Error("Global npx skill installation is not allowed");
  }
  if (tokens.some((token) => token === "--list" || token === "-l")) {
    throw new Error("List-only npx skills commands cannot be imported");
  }
  const args = tokens.slice(1);
  const hasCodexAgent = args.some(
    (token, index) => token === "--agent=codex" || token === "codex" && (args[index - 1] === "--agent" || args[index - 1] === "-a")
  );
  const hasSkill = args.some((token) => token === "--skill" || token === "-s" || token === "--all" || token.startsWith("--skill="));
  const hasYes = args.some((token) => token === "--yes" || token === "-y");
  const hasCopy = args.includes("--copy");
  if (!hasCodexAgent) args.push("--agent", "codex");
  if (!hasSkill) args.push("--skill", "*");
  if (!hasYes) args.push("--yes");
  if (!hasCopy) args.push("--copy");
  return ["--yes", ...args];
}
async function isNpxAvailable(execFile = defaultExecFile) {
  return await resolveNpxExecutable(execFile) !== void 0;
}
async function resolveNpxExecutable(execFile = defaultExecFile) {
  var _a;
  try {
    await execFile("npx", ["--version"], {});
    return { file: "npx" };
  } catch (e) {
  }
  for (const lookupArgs of npxLookupArgs()) {
    try {
      const lookupResult = await execFile(userShell(), lookupArgs, {});
      const executable = (_a = stdoutFromExecResult(lookupResult).split(/\r?\n/).find((line) => line.trim())) == null ? void 0 : _a.trim();
      if (!executable) continue;
      const env = envWithExecutablePath(executable);
      await execFile(executable, ["--version"], { env });
      return { file: executable, env };
    } catch (e) {
    }
  }
  return void 0;
}
async function runNpxSkillsAdd(command, cwd, execFile = defaultExecFile) {
  const args = normalizeNpxSkillsCommand(command);
  const npxExecutable = await resolveNpxExecutable(execFile);
  if (!npxExecutable) throw new Error("npx is not available.");
  const stagingPath = await (0, import_promises6.mkdtemp)((0, import_path7.join)(cwd, ".skillhub-npx-import-"));
  try {
    await execFile(npxExecutable.file, args, {
      cwd: stagingPath,
      env: {
        ...process.env,
        ...npxExecutable.env,
        DO_NOT_TRACK: "1",
        DISABLE_TELEMETRY: "1",
        CI: "1"
      }
    });
  } catch (error) {
    try {
      await (0, import_promises6.rm)(stagingPath, { force: true, recursive: true });
    } catch (cleanupError) {
      throw combineErrors(error, cleanupError, "staging cleanup failed");
    }
    throw error;
  }
  return stagingPath;
}
function envWithExecutablePath(executable) {
  const executableDir = (0, import_path7.dirname)(executable);
  return {
    ...process.env,
    PATH: [executableDir, process.env.PATH].filter(Boolean).join(import_path7.delimiter)
  };
}

// src/settingsDefaults.ts
var DEFAULT_SETTINGS = {
  skillFolder: "Skill",
  installMethod: "symlink",
  npxExecutionEnabled: false,
  defaultSymlinkConflictBehavior: "skip",
  defaultSort: "nickname",
  skillOrder: []
};

// src/registry.ts
function createEmptySkillHubData() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    skills: {},
    collections: {},
    bundleMetadata: {},
    pinnedFolderIds: [],
    folderOrder: [],
    tagColors: {},
    events: []
  };
}
function collectTagColors(data) {
  var _a, _b;
  const tagColors = { ...(_a = data.tagColors) != null ? _a : {} };
  for (const skill of Object.values(data.skills)) {
    for (const [tag, color] of Object.entries((_b = skill.tagColors) != null ? _b : {})) {
      if (!tagColors[tag]) tagColors[tag] = color;
    }
  }
  return tagColors;
}
var SkillRegistry = class {
  constructor(data) {
    this.data = data;
  }
  upsertSkill(record) {
    this.data.skills[record.id] = record;
  }
  deleteSkill(id) {
    delete this.data.skills[id];
    for (const collection of Object.values(this.data.collections)) {
      collection.skillIds = collection.skillIds.filter((skillId) => skillId !== id);
    }
  }
  updateSkillCollections(skillId, collectionIds) {
    const skill = this.data.skills[skillId];
    if (!skill) return;
    const selectedCollectionIds = new Set(collectionIds);
    skill.collectionIds = [...selectedCollectionIds];
    for (const collection of Object.values(this.data.collections)) {
      if (selectedCollectionIds.has(collection.id)) {
        if (!collection.skillIds.includes(skillId)) collection.skillIds.push(skillId);
      } else {
        collection.skillIds = collection.skillIds.filter((id) => id !== skillId);
      }
    }
  }
  saveCollection(collection) {
    this.data.collections[collection.id] = collection;
  }
  deleteCollection(id) {
    delete this.data.collections[id];
    for (const skill of Object.values(this.data.skills)) {
      skill.collectionIds = skill.collectionIds.filter((collectionId) => collectionId !== id);
    }
  }
  recordEvent(event) {
    this.data.events.push(event);
  }
  incrementInstall(skillId, at) {
    const skill = this.data.skills[skillId];
    if (!skill) return;
    skill.installCount += 1;
    skill.lastInstalledAt = at;
  }
};

// src/settings.ts
var import_obsidian = require("obsidian");
var SkillHubSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, skillHubPlugin) {
    super(app, skillHubPlugin);
    this.skillHubPlugin = skillHubPlugin;
  }
  getSettingDefinitions() {
    return [{
      type: "group",
      heading: "Skill Hub",
      items: [
        {
          name: "Skill folder",
          desc: "Vault folder used to store imported skills.",
          control: {
            type: "folder",
            key: "skillFolder",
            defaultValue: DEFAULT_SETTINGS.skillFolder,
            validate: (value) => this.validateSkillFolder(value)
          }
        },
        {
          name: "Install method",
          desc: "How skills are installed into .agents/skills.",
          control: {
            type: "dropdown",
            key: "installMethod",
            defaultValue: DEFAULT_SETTINGS.installMethod,
            options: { symlink: "Symlink", copy: "Copy" }
          }
        },
        {
          name: "Default sort",
          desc: "Initial ordering in the Skill Hub view.",
          control: {
            type: "dropdown",
            key: "defaultSort",
            defaultValue: DEFAULT_SETTINGS.defaultSort,
            options: {
              nickname: "Nickname",
              originalName: "Original name",
              updatedAt: "Recently updated",
              custom: "Custom order"
            }
          }
        },
        {
          name: "Enable npx execution",
          desc: "Allow Skill Hub to run npx skills add commands.",
          control: {
            type: "toggle",
            key: "npxExecutionEnabled",
            defaultValue: DEFAULT_SETTINGS.npxExecutionEnabled
          }
        },
        {
          name: "Symlink conflict behavior",
          desc: "Choose what happens when a destination is already a symlink.",
          control: {
            type: "dropdown",
            key: "defaultSymlinkConflictBehavior",
            defaultValue: DEFAULT_SETTINGS.defaultSymlinkConflictBehavior,
            options: { skip: "Skip", overwrite: "Overwrite symlinks" }
          }
        }
      ]
    }];
  }
  getControlValue(key) {
    return this.skillHubPlugin.data.settings[key];
  }
  async setControlValue(key, value) {
    if (key === "skillFolder") {
      const nextValue = String(value).trim() || DEFAULT_SETTINGS.skillFolder;
      const validationError = this.validateSkillFolder(nextValue);
      if (validationError) throw new Error(validationError);
      this.skillHubPlugin.data.settings.skillFolder = nextValue;
    } else if (key === "installMethod" && this.isInstallMethod(value)) {
      this.skillHubPlugin.data.settings.installMethod = value;
    } else if (key === "defaultSort" && this.isDefaultSort(value)) {
      this.skillHubPlugin.data.settings.defaultSort = value;
      this.skillHubPlugin.refreshSkillHub();
    } else if (key === "npxExecutionEnabled") {
      this.skillHubPlugin.data.settings.npxExecutionEnabled = Boolean(value);
    } else if (key === "defaultSymlinkConflictBehavior" && this.isSymlinkConflictBehavior(value)) {
      this.skillHubPlugin.data.settings.defaultSymlinkConflictBehavior = value;
    }
    await this.skillHubPlugin.saveSkillHubData();
  }
  validateSkillFolder(value) {
    try {
      resolveVaultRelativePath("/vault", value.trim() || DEFAULT_SETTINGS.skillFolder);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  isInstallMethod(value) {
    return value === "symlink" || value === "copy";
  }
  isDefaultSort(value) {
    return value === "nickname" || value === "originalName" || value === "updatedAt" || value === "custom";
  }
  isSymlinkConflictBehavior(value) {
    return value === "skip" || value === "overwrite";
  }
};

// src/ui/modals.ts
var import_obsidian2 = require("obsidian");

// src/stagingCleanup.ts
function createCleanupOnce(cleanup) {
  let cleanupPromise;
  return () => {
    cleanupPromise != null ? cleanupPromise : cleanupPromise = Promise.resolve(cleanup());
    return cleanupPromise;
  };
}

// src/ui/modals.ts
var SKILL_EMOJI_CANDIDATES = ["\u{1F9E0}", "\u{1F6E0}\uFE0F", "\u270D\uFE0F", "\u{1F50D}", "\u{1F4DA}", "\u{1F9EA}", "\u2699\uFE0F", "\u{1F680}", "\u{1F4A1}", "\u{1F4CA}", "\u{1F916}", "\u{1F9ED}"];
var DEFAULT_TAG_COLOR = "#7f8c8d";
function setButtonWarning(button) {
  return button.setClass("mod-warning");
}
var TextInputModal = class extends import_obsidian2.Modal {
  constructor(app, title, placeholder, submitText, onSubmit) {
    super(app);
    this.title = title;
    this.placeholder = placeholder;
    this.submitText = submitText;
    this.onSubmit = onSubmit;
    this.value = "";
  }
  onOpen() {
    this.setTitle(this.title);
    new import_obsidian2.Setting(this.contentEl).addText((text) => text.setPlaceholder(this.placeholder).onChange((value) => {
      this.value = value.trim();
    })).addButton((button) => button.setButtonText(this.submitText).setCta().onClick(async () => {
      if (!this.value) return;
      await this.onSubmit(this.value);
      this.close();
    }));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var GitHubUrlModal = class extends TextInputModal {
  constructor(app, onSubmit) {
    super(app, "Import skills from GitHub", "https://github.com/owner/repository", "Import", onSubmit);
  }
};
var NpxCommandModal = class extends TextInputModal {
  constructor(app, onSubmit) {
    super(app, "Import skills with npx", "npx skills add owner/repository", "Run import", onSubmit);
  }
};
var ManualNpxFallbackModal = class extends import_obsidian2.Modal {
  constructor(app, command, reason, onScan) {
    super(app);
    this.command = command;
    this.reason = reason;
    this.onScan = onScan;
  }
  onOpen() {
    this.setTitle("Run npx manually");
    this.contentEl.createEl("p", { text: this.reason });
    this.contentEl.createEl("code", { cls: "skillhub-command", text: this.command });
    this.contentEl.createEl("p", { text: "Run this command in a folder, then select that output folder for scanning." });
    new import_obsidian2.Setting(this.contentEl).addButton((button) => button.setButtonText("Scan output folder").setCta().onClick(async () => {
      await this.onScan(void 0);
      this.close();
    }));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var SkillSelectionModal = class extends import_obsidian2.Modal {
  constructor(app, options, onSubmit, onCleanup = () => void 0) {
    super(app);
    this.options = options;
    this.onSubmit = onSubmit;
    this.selected = /* @__PURE__ */ new Set();
    this.cleanupErrorShown = false;
    this.cleanup = createCleanupOnce(onCleanup);
  }
  onOpen() {
    this.setTitle("Select skills");
    const selectAll = this.contentEl.createEl("input", { type: "checkbox" });
    const selectAllLabel = this.contentEl.createEl("label", { text: " Select all" });
    selectAllLabel.prepend(selectAll);
    const list = this.contentEl.createDiv({ cls: "skillhub-selection-list" });
    const checks = this.options.map((option) => {
      const label = list.createEl("label", { cls: "skillhub-selection-item" });
      const checkbox = label.createEl("input", { type: "checkbox" });
      label.appendText(` ${option.label}`);
      checkbox.addEventListener("change", () => {
        checkbox.checked ? this.selected.add(option.id) : this.selected.delete(option.id);
        selectAll.checked = this.selected.size === this.options.length;
      });
      return checkbox;
    });
    selectAll.addEventListener("change", () => {
      for (const option of this.options) {
        selectAll.checked ? this.selected.add(option.id) : this.selected.delete(option.id);
      }
      for (const checkbox of checks) checkbox.checked = selectAll.checked;
    });
    new import_obsidian2.Setting(this.contentEl).addButton((button) => button.setButtonText("Continue").setCta().onClick(async () => {
      try {
        await this.onSubmit(this.options.filter((option) => this.selected.has(option.id)).map((option) => option.value));
      } finally {
        try {
          await this.cleanupWithNotice();
        } finally {
          this.close();
        }
      }
    }));
  }
  onClose() {
    void this.cleanupWithNotice().catch(() => void 0);
    this.contentEl.empty();
  }
  async cleanupWithNotice() {
    try {
      await this.cleanup();
    } catch (error) {
      if (!this.cleanupErrorShown) {
        this.cleanupErrorShown = true;
        new import_obsidian2.Notice(`Failed to clean staging folder: ${error instanceof Error ? error.message : String(error)}`);
      }
      throw error;
    }
  }
};
var InstallSelectionModal = class extends import_obsidian2.Modal {
  constructor(app, skills, collections, onSubmit) {
    super(app);
    this.skills = skills;
    this.collections = collections;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    this.setTitle("Install skills and collections");
    const skillIds = /* @__PURE__ */ new Set();
    const collectionIds = /* @__PURE__ */ new Set();
    const container = this.contentEl.createDiv({ cls: "skillhub-install-selection" });
    const skillsSection = container.createDiv({ cls: "skillhub-install-selection-section" });
    skillsSection.createEl("h3", { text: "Skills" });
    if (this.skills.length === 0) {
      skillsSection.createSpan({ cls: "skillhub-collection-empty", text: "No skills installed yet." });
    }
    for (const skill of this.skills) {
      const label = skillsSection.createEl("label", { cls: "skillhub-selection-item" });
      const checkbox = label.createEl("input", { type: "checkbox" });
      label.appendText(` ${skill.emoji ? `${skill.emoji} ` : ""}${skill.nickname}`);
      checkbox.addEventListener("change", () => {
        checkbox.checked ? skillIds.add(skill.id) : skillIds.delete(skill.id);
      });
    }
    const collectionsSection = container.createDiv({ cls: "skillhub-install-selection-section" });
    collectionsSection.createEl("h3", { text: "Collections" });
    if (this.collections.length === 0) {
      collectionsSection.createSpan({ cls: "skillhub-collection-empty", text: "No collections created yet." });
    }
    for (const collection of this.collections) {
      const label = collectionsSection.createEl("label", { cls: "skillhub-selection-item" });
      const checkbox = label.createEl("input", { type: "checkbox" });
      label.appendText(` ${collection.name} (${collection.skillIds.length})`);
      checkbox.addEventListener("change", () => {
        checkbox.checked ? collectionIds.add(collection.id) : collectionIds.delete(collection.id);
      });
    }
    new import_obsidian2.Setting(this.contentEl).addButton((button) => button.setButtonText("Install").setCta().onClick(async () => {
      await this.onSubmit({ skillIds: [...skillIds], collectionIds: [...collectionIds] });
      this.close();
    }));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var SkillEditModal = class extends import_obsidian2.Modal {
  constructor(app, skill, collections, allTags, sharedTagColors, onSubmit) {
    super(app);
    this.skill = skill;
    this.collections = collections;
    this.allTags = allTags;
    this.sharedTagColors = sharedTagColors;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    var _a, _b;
    this.setTitle(`Edit ${this.skill.nickname}`);
    let nickname = this.skill.nickname;
    let emoji = (_a = this.skill.emoji) != null ? _a : "";
    let color = (_b = this.skill.color) != null ? _b : "#7f8c8d";
    let tagDraft = "";
    const tags = [...this.skill.tags];
    const knownTags = /* @__PURE__ */ new Set([...this.allTags, ...tags]);
    const tagColors = { ...this.sharedTagColors };
    const collectionIds = new Set(this.skill.collectionIds);
    let emojiInput;
    let tagInput;
    new import_obsidian2.Setting(this.contentEl).setName("Nickname").addText((text) => text.setValue(nickname).onChange((value) => {
      nickname = value;
    }));
    new import_obsidian2.Setting(this.contentEl).setName("Emoji").addText((text) => {
      emojiInput = text;
      text.setValue(emoji).setPlaceholder("Optional").onChange((value) => {
        emoji = value;
        renderEmojiCandidates();
      });
    });
    const emojiCandidatesEl = this.contentEl.createDiv({ cls: "skillhub-emoji-candidates" });
    new import_obsidian2.Setting(this.contentEl).setName("Color").addColorPicker((picker) => picker.setValue(color).onChange((value) => {
      color = value;
    }));
    new import_obsidian2.Setting(this.contentEl).setName("Tags").setDesc("Right click to change tag color").addText((text) => {
      tagInput = text;
      text.setPlaceholder("Add tag and press Enter").onChange((value) => {
        tagDraft = value;
      });
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          addTag(tagDraft);
        }
      });
    });
    const currentTagsSection = this.contentEl.createDiv({ cls: "skillhub-current-tags" });
    currentTagsSection.createEl("h3", { text: "Current skill tags" });
    const currentTagsEl = currentTagsSection.createDiv({ cls: "skillhub-edit-tags" });
    const existingTagsSection = this.contentEl.createDiv({ cls: "skillhub-existing-tags" });
    existingTagsSection.createEl("h3", { text: "Existing tags" });
    const existingTagsEl = existingTagsSection.createDiv({ cls: "skillhub-edit-tags" });
    const renderEmojiCandidates = () => {
      emojiCandidatesEl.empty();
      for (const candidate of SKILL_EMOJI_CANDIDATES) {
        const button = emojiCandidatesEl.createEl("button", { text: candidate, cls: "skillhub-emoji-choice" });
        if (emoji === candidate) button.addClass("is-selected");
        button.addEventListener("click", () => {
          emoji = candidate;
          emojiInput == null ? void 0 : emojiInput.setValue(candidate);
          renderEmojiCandidates();
        });
      }
    };
    const addTag = (rawTag) => {
      const tag = rawTag.trim();
      if (!tag || tags.includes(tag)) return;
      knownTags.add(tag);
      tags.push(tag);
      tagDraft = "";
      tagInput == null ? void 0 : tagInput.setValue("");
      renderTags();
    };
    const renderTags = () => {
      var _a2, _b2;
      currentTagsEl.empty();
      for (const tag of tags) {
        const tagEl = currentTagsEl.createDiv({ cls: "skillhub-edit-tag" });
        const tagColor = (_a2 = tagColors[tag]) != null ? _a2 : DEFAULT_TAG_COLOR;
        tagEl.style.setProperty("--skillhub-tag-color", tagColor);
        const colorInput = tagEl.createEl("input", { type: "color", cls: "skillhub-tag-color" });
        colorInput.value = tagColor;
        colorInput.addEventListener("input", () => {
          tagColors[tag] = colorInput.value;
          tagEl.style.setProperty("--skillhub-tag-color", colorInput.value);
        });
        const tagButton = tagEl.createEl("button", { cls: "skillhub-edit-tag-button", attr: { "aria-label": `Delete ${tag}` } });
        tagButton.createSpan({ text: tag, cls: "skillhub-tag-text" });
        tagButton.createSpan({ text: "\xD7", cls: "skillhub-tag-delete-icon", attr: { "aria-hidden": "true" } });
        tagButton.addEventListener("click", () => {
          tags.splice(tags.indexOf(tag), 1);
          renderTags();
        });
        tagButton.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          colorInput.click();
        });
      }
      existingTagsEl.empty();
      for (const tag of [...knownTags].filter((candidate) => !tags.includes(candidate)).sort((left, right) => left.localeCompare(right))) {
        const button = existingTagsEl.createEl("button", { text: tag, cls: "skillhub-existing-tag" });
        const tagColor = (_b2 = tagColors[tag]) != null ? _b2 : DEFAULT_TAG_COLOR;
        button.style.setProperty("--skillhub-tag-color", tagColor);
        button.addEventListener("click", () => addTag(tag));
      }
    };
    const collectionsEl = this.contentEl.createDiv({ cls: "skillhub-collections" });
    collectionsEl.createEl("h3", { text: "Collections" });
    for (const collection of this.collections) {
      const label = collectionsEl.createEl("label", { cls: "skillhub-selection-item" });
      const checkbox = label.createEl("input", { type: "checkbox" });
      checkbox.checked = collectionIds.has(collection.id);
      label.appendText(` ${collection.name}`);
      checkbox.addEventListener("change", () => {
        checkbox.checked ? collectionIds.add(collection.id) : collectionIds.delete(collection.id);
      });
    }
    new import_obsidian2.Setting(this.contentEl).addButton((button) => button.setButtonText("Save").setCta().onClick(async () => {
      addTag(tagDraft);
      await this.onSubmit({
        nickname: nickname.trim() || this.skill.nickname,
        emoji: emoji.trim(),
        color,
        tags,
        tagColors: Object.fromEntries([...knownTags].filter((tag) => tagColors[tag]).map((tag) => [tag, tagColors[tag]])),
        collectionIds: [...collectionIds]
      });
      this.close();
    }));
    renderEmojiCandidates();
    renderTags();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var DeleteConfirmationModal = class extends import_obsidian2.Modal {
  constructor(app, skill, onConfirm) {
    super(app);
    this.onConfirm = onConfirm;
    this.skill = skill;
  }
  onOpen() {
    this.setTitle("Delete skill");
    this.contentEl.createEl("p", {
      text: `Delete ${this.skill.nickname}? Copied vault folder "${this.skill.vaultPath}" and Skill Hub plugin metadata will be permanently deleted.`
    });
    new import_obsidian2.Setting(this.contentEl).addButton((button) => setButtonWarning(button.setButtonText("Delete")).onClick(async () => {
      await this.onConfirm();
      this.close();
    }));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var BulkDeleteConfirmationModal = class extends import_obsidian2.Modal {
  constructor(app, skills, onConfirm) {
    super(app);
    this.skills = skills;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    this.setTitle("Delete selected skills");
    this.contentEl.createEl("p", {
      text: `Delete ${this.skills.length} selected skills? Copied vault folders ${this.skills.map((skill) => `"${skill.vaultPath}"`).join(", ")} and Skill Hub plugin metadata will be permanently deleted.`
    });
    new import_obsidian2.Setting(this.contentEl).addButton((button) => setButtonWarning(button.setButtonText("Delete all")).onClick(async () => {
      await this.onConfirm(void 0);
      this.close();
    }));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var CollectionDeleteConfirmationModal = class extends import_obsidian2.Modal {
  constructor(app, collection, onConfirm) {
    super(app);
    this.collection = collection;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    this.setTitle("Delete collection");
    this.contentEl.createEl("p", {
      text: `Delete ${this.collection.name}? Skills in this collection will remain installed.`
    });
    new import_obsidian2.Setting(this.contentEl).addButton((button) => setButtonWarning(button.setButtonText("Delete")).onClick(async () => {
      await this.onConfirm();
      this.close();
    }));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var SkillDetailModal = class extends import_obsidian2.Modal {
  constructor(app, skill, collections) {
    super(app);
    this.skill = skill;
    this.collections = collections;
  }
  onOpen() {
    this.setTitle(this.skill.nickname);
    this.addDetail("Original name", this.skill.originalName);
    this.addDetail("Description", this.skill.description || "No description provided.");
    this.addDetail("Vault path", this.skill.vaultPath);
    this.addDetail("Source", formatSkillSource(this.skill));
    this.addDetail("Tags", this.skill.tags.join(", ") || "None");
    this.addDetail(
      "Collections",
      this.collections.filter((collection) => this.skill.collectionIds.includes(collection.id)).map((collection) => collection.name).join(", ") || "None"
    );
    this.addDetail("Install count", String(this.skill.installCount));
    this.addDetail("Warnings", this.skill.warnings.join("; ") || "None");
  }
  onClose() {
    this.contentEl.empty();
  }
  addDetail(label, value) {
    const row = this.contentEl.createDiv({ cls: "skillhub-detail-row" });
    row.createEl("strong", { text: label });
    row.createSpan({ text: value });
  }
};
var BundleDetailModal = class extends import_obsidian2.Modal {
  constructor(app, bundle) {
    super(app);
    this.bundle = bundle;
  }
  onOpen() {
    this.setTitle(this.bundle.name);
    this.addDetail("Description", this.bundle.description || "No description provided.");
    this.addDetail("Source type", this.bundle.sourceType === "npx" ? "npx" : this.bundle.sourceType[0].toLocaleUpperCase() + this.bundle.sourceType.slice(1));
    this.addDetail("Source", this.bundle.sourceValue);
    this.addDetail("Skills", this.bundle.skills.map((skill) => skill.nickname).join(", "));
    this.addDetail("Skill count", String(this.bundle.skills.length));
  }
  onClose() {
    this.contentEl.empty();
  }
  addDetail(label, value) {
    const row = this.contentEl.createDiv({ cls: "skillhub-detail-row" });
    row.createEl("strong", { text: label });
    row.createSpan({ text: value });
  }
};
var BundleEditModal = class extends import_obsidian2.Modal {
  constructor(app, bundle, onSubmit) {
    super(app);
    this.bundle = bundle;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    var _a;
    this.setTitle("Edit bundle");
    let name = this.bundle.name;
    let description = this.bundle.description;
    let color = (_a = this.bundle.color) != null ? _a : "#fbc548";
    let skillIds = this.bundle.skills.map((skill) => skill.id);
    new import_obsidian2.Setting(this.contentEl).setName("Name").addText((text) => text.setValue(name).onChange((value) => {
      name = value;
    }));
    new import_obsidian2.Setting(this.contentEl).setName("Description").addText((text) => text.setValue(description).onChange((value) => {
      description = value;
    }));
    new import_obsidian2.Setting(this.contentEl).setName("Color").addColorPicker((picker) => picker.setValue(color).onChange((value) => {
      color = value;
    }));
    const skillsEl = this.contentEl.createDiv({ cls: "skillhub-collection-edit-skills" });
    const renderSkills = () => {
      skillsEl.empty();
      skillsEl.createEl("h3", { text: "Skills" });
      const visibleSkills = this.bundle.skills.filter((skill) => skillIds.includes(skill.id));
      if (visibleSkills.length === 0) {
        skillsEl.createSpan({ cls: "skillhub-collection-empty", text: "No skills in this bundle." });
        return;
      }
      for (const skill of visibleSkills) {
        const row = skillsEl.createDiv({ cls: "skillhub-collection-edit-skill-row" });
        const removeButton = row.createEl("button", {
          cls: "skillhub-collection-edit-skill",
          attr: { "aria-label": `Remove ${skill.nickname}` }
        });
        removeButton.createSpan({
          cls: "skillhub-collection-edit-skill-label",
          text: `${skill.emoji ? `${skill.emoji} ` : ""}${skill.nickname}`
        });
        removeButton.createSpan({ cls: "skillhub-collection-edit-skill-remove", text: "\xD7", attr: { "aria-hidden": "true" } });
        removeButton.addEventListener("click", () => {
          skillIds = skillIds.filter((skillId) => skillId !== skill.id);
          renderSkills();
        });
      }
    };
    new import_obsidian2.Setting(this.contentEl).addButton((button) => button.setButtonText("Save").setCta().onClick(async () => {
      const nextName = name.trim();
      if (!nextName) return;
      await this.onSubmit({ name: nextName, description: description.trim(), color, skillIds });
      this.close();
    }));
    renderSkills();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var CollectionDetailModal = class extends import_obsidian2.Modal {
  constructor(app, collection, skills) {
    super(app);
    this.collection = collection;
    this.skills = skills;
  }
  onOpen() {
    this.setTitle(this.collection.name);
    this.addDetail("Description", this.collection.description || "No description provided.");
    this.addDetail("Skills", this.skills.map((skill) => skill.nickname).join(", ") || "None");
    this.addDetail("Skill count", String(this.skills.length));
  }
  onClose() {
    this.contentEl.empty();
  }
  addDetail(label, value) {
    const row = this.contentEl.createDiv({ cls: "skillhub-detail-row" });
    row.createEl("strong", { text: label });
    row.createSpan({ text: value });
  }
};
var CollectionEditModal = class extends import_obsidian2.Modal {
  constructor(app, collection, onSubmit, collectionSkills) {
    super(app);
    this.collection = collection;
    this.onSubmit = onSubmit;
    this.collectionSkills = collectionSkills;
  }
  onOpen() {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    this.setTitle(this.collection ? "Edit collection" : "New collection");
    let name = (_b = (_a = this.collection) == null ? void 0 : _a.name) != null ? _b : "";
    let description = (_d = (_c = this.collection) == null ? void 0 : _c.description) != null ? _d : "";
    let color = (_f = (_e = this.collection) == null ? void 0 : _e.color) != null ? _f : "#7f8c8d";
    let skillIds = (_h = (_g = this.collectionSkills) == null ? void 0 : _g.map((skill) => skill.id)) != null ? _h : [];
    new import_obsidian2.Setting(this.contentEl).setName("Name").addText((text) => text.setValue(name).onChange((value) => {
      name = value;
    }));
    new import_obsidian2.Setting(this.contentEl).setName("Description").addText((text) => text.setValue(description).onChange((value) => {
      description = value;
    }));
    new import_obsidian2.Setting(this.contentEl).setName("Color").addColorPicker((picker) => picker.setValue(color).onChange((value) => {
      color = value;
    }));
    const skillsEl = this.collectionSkills ? this.contentEl.createDiv({ cls: "skillhub-collection-edit-skills" }) : void 0;
    const renderSkills = () => {
      if (!skillsEl || !this.collectionSkills) return;
      skillsEl.empty();
      skillsEl.createEl("h3", { text: "Skills" });
      const visibleSkills = this.collectionSkills.filter((skill) => skillIds.includes(skill.id));
      if (visibleSkills.length === 0) {
        skillsEl.createSpan({ cls: "skillhub-collection-empty", text: "No skills in this collection." });
        return;
      }
      for (const skill of visibleSkills) {
        const row = skillsEl.createDiv({ cls: "skillhub-collection-edit-skill-row" });
        const removeButton = row.createEl("button", {
          cls: "skillhub-collection-edit-skill",
          attr: { "aria-label": `Remove ${skill.nickname}` }
        });
        removeButton.createSpan({
          cls: "skillhub-collection-edit-skill-label",
          text: `${skill.emoji ? `${skill.emoji} ` : ""}${skill.nickname}`
        });
        removeButton.createSpan({
          cls: "skillhub-collection-edit-skill-remove",
          text: "\xD7",
          attr: { "aria-hidden": "true" }
        });
        removeButton.addEventListener("click", () => {
          skillIds = skillIds.filter((skillId) => skillId !== skill.id);
          renderSkills();
        });
      }
    };
    new import_obsidian2.Setting(this.contentEl).addButton((button) => button.setButtonText("Save").setCta().onClick(async () => {
      if (!name.trim()) return;
      await this.onSubmit({
        name: name.trim(),
        description: description.trim(),
        color,
        skillIds: this.collectionSkills ? skillIds : void 0
      });
      this.close();
    }));
    renderSkills();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var CollectionManagerModal = class extends import_obsidian2.Modal {
  constructor(app, getCollections, actions) {
    super(app);
    this.getCollections = getCollections;
    this.actions = actions;
  }
  onOpen() {
    this.renderCollections();
  }
  onClose() {
    this.contentEl.empty();
  }
  renderCollections() {
    this.contentEl.empty();
    this.setTitle("Collections");
    new import_obsidian2.Setting(this.contentEl).addButton((button) => button.setButtonText("New collection").setCta().onClick(() => {
      new CollectionEditModal(this.app, void 0, async (values) => {
        await this.actions.create(values);
        this.renderCollections();
      }).open();
    }));
    for (const collection of this.getCollections()) {
      new import_obsidian2.Setting(this.contentEl).setName(collection.name).setDesc(collection.description || `${collection.skillIds.length} skills`).addButton((button) => button.setButtonText("Edit").onClick(() => {
        new CollectionEditModal(this.app, collection, async (values) => {
          await this.actions.update(collection, values);
          this.renderCollections();
        }).open();
      })).addButton((button) => setButtonWarning(button.setButtonText("Delete")).onClick(() => {
        new CollectionDeleteConfirmationModal(this.app, collection, async () => {
          await this.actions.delete(collection);
          this.renderCollections();
        }).open();
      }));
    }
  }
};
var BulkCollectionMembershipModal = class extends import_obsidian2.Modal {
  constructor(app, collections, onSubmit) {
    super(app);
    this.collections = collections;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    this.setTitle("Update selected collections");
    let action = "add";
    const collectionIds = /* @__PURE__ */ new Set();
    new import_obsidian2.Setting(this.contentEl).setName("Action").addDropdown((dropdown) => dropdown.addOption("add", "Add membership").addOption("remove", "Remove membership").onChange((value) => {
      action = value;
    }));
    for (const collection of this.collections) {
      new import_obsidian2.Setting(this.contentEl).setName(collection.name).addToggle((toggle) => toggle.onChange((selected) => {
        selected ? collectionIds.add(collection.id) : collectionIds.delete(collection.id);
      }));
    }
    new import_obsidian2.Setting(this.contentEl).addButton((button) => button.setButtonText("Apply").setCta().onClick(async () => {
      if (collectionIds.size === 0) return;
      await this.onSubmit({ action, collectionIds: [...collectionIds] });
      this.close();
    }));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var InstallResultModal = class extends import_obsidian2.Modal {
  constructor(app, summary) {
    super(app);
    this.summary = summary;
  }
  onOpen() {
    this.setTitle("Install results");
    this.contentEl.createEl("p", { text: `Installed: ${this.summary.installed.length}` });
    this.contentEl.createEl("p", { text: `Replaced: ${this.summary.replaced.length}` });
    this.contentEl.createEl("p", { text: `Skipped: ${this.summary.skipped.length}` });
    this.contentEl.createEl("p", { text: `Failed: ${this.summary.failed.length}` });
    for (const failure of this.summary.failed) this.contentEl.createEl("p", { text: failure.reason, cls: "skillhub-error" });
  }
  onClose() {
    this.contentEl.empty();
  }
};
function formatSkillSource(skill) {
  var _a, _b, _c;
  if (skill.source.type === "github") return (_a = skill.source.url) != null ? _a : "GitHub";
  if (skill.source.type === "npx") return (_b = skill.source.command) != null ? _b : "npx";
  return (_c = skill.source.path) != null ? _c : "Local folder";
}

// src/ui/SkillHubView.ts
var import_obsidian3 = require("obsidian");

// src/skillBundles.ts
function parseGitHubRepository(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    if (url.hostname.toLocaleLowerCase() !== "github.com" && url.hostname.toLocaleLowerCase() !== "www.github.com") return void 0;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return void 0;
    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/i, "");
    if (!owner || !repo) return void 0;
    return {
      id: `github:${owner.toLocaleLowerCase()}/${repo.toLocaleLowerCase()}`,
      owner,
      repo,
      repoUrl: `https://github.com/${owner}/${repo}`
    };
  } catch (e) {
    return void 0;
  }
}
function deriveSkillBundles(skills, bundleMetadata) {
  var _a, _b, _c, _d, _e, _f, _g, _h;
  const grouped = /* @__PURE__ */ new Map();
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
        name: ((_b = (_a = bundleMetadata[source.id]) == null ? void 0 : _a.name) == null ? void 0 : _b.trim()) || source.defaultName,
        description: (_e = (_d = (_c = bundleMetadata[source.id]) == null ? void 0 : _c.description) == null ? void 0 : _d.trim()) != null ? _e : "",
        color: (_f = bundleMetadata[source.id]) == null ? void 0 : _f.color,
        skills: [skill]
      });
    }
  }
  for (const bundle of grouped.values()) {
    const excludedSkillIds = new Set((_h = (_g = bundleMetadata[bundle.id]) == null ? void 0 : _g.excludedSkillIds) != null ? _h : []);
    bundle.skills = bundle.skills.filter((skill) => !excludedSkillIds.has(skill.id));
  }
  return [...grouped.values()].filter((bundle) => bundle.skills.length >= 2 || bundle.skills.length === 1 && Boolean(bundleMetadata[bundle.id])).sort((left, right) => left.name.localeCompare(right.name));
}
function getSkillSourceIdentity(source) {
  if (source.type === "github" && source.url) {
    const repository = parseGitHubRepository(source.url);
    if (!repository) return void 0;
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
      sourceLabel: target != null ? target : "npx import",
      sourceValue: normalizedCommand
    };
  }
  return void 0;
}
function normalizeLocalPath(path) {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}
function getLastPathSegment(value) {
  var _a;
  return (_a = value.split("/").filter(Boolean).at(-1)) != null ? _a : "";
}
function parseNpxTarget(command) {
  var _a, _b;
  const match = command.match(/^npx\s+skills\s+add\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  return (_b = (_a = match == null ? void 0 : match[1]) != null ? _a : match == null ? void 0 : match[2]) != null ? _b : match == null ? void 0 : match[3];
}
function getSourceName(target) {
  const repository = parseGitHubRepository(target);
  if (repository) return repository.repo;
  return getLastPathSegment(target.replace(/\.git$/i, "")) || "npx import";
}

// src/ui/SkillHubView.ts
var VIEW_TYPE_SKILL_HUB = "banshan-skillhub-view";
var SKILL_HUB_ICON_ID = "banshan-skillhub";
var FOLDER_DRAG_TYPE = "application/x-skillhub-folder-id";
var SkillHubView = class extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.selectedSkillIds = /* @__PURE__ */ new Set();
    this.selectedCollectionIds = /* @__PURE__ */ new Set();
    this.selectMode = false;
    this.filterQuery = "";
  }
  getViewType() {
    return VIEW_TYPE_SKILL_HUB;
  }
  getDisplayText() {
    return "Skill Hub";
  }
  getIcon() {
    return SKILL_HUB_ICON_ID;
  }
  async onOpen() {
    this.render();
  }
  async onClose() {
    var _a;
    (_a = this.folderBoardResizeObserver) == null ? void 0 : _a.disconnect();
  }
  openGitHubImport() {
    new GitHubUrlModal(this.app, (url) => this.plugin.importFromGitHub(url)).open();
  }
  openLocalScan() {
    void this.plugin.pickAndImportLocalDirectory();
  }
  openNpxImport() {
    new NpxCommandModal(this.app, (command) => this.plugin.importFromNpx(command)).open();
  }
  installSelectedSkills() {
    const selected = this.getSelectedInstallSkills();
    if (selected.length > 0) {
      void this.plugin.installSkills(selected);
      return;
    }
    this.openInstallSelectionModal();
  }
  render() {
    this.removeMissingSelections();
    this.contentEl.empty();
    this.contentEl.addClass("skillhub-root");
    const toolbar = this.contentEl.createDiv({ cls: "skillhub-toolbar" });
    this.addToolbarButton(toolbar, "GitHub import", "github", () => this.openGitHubImport());
    this.addToolbarButton(toolbar, "Local scan", "folder", () => this.openLocalScan());
    this.addToolbarButton(toolbar, "npx import", "node", () => this.openNpxImport());
    this.addToolbarButton(toolbar, "Collections", "collections", () => this.openCollectionManager());
    this.addToolbarButton(toolbar, this.selectMode ? "Done" : "Select", this.selectMode ? "done" : "select", () => this.toggleSelectMode());
    this.addToolbarButton(toolbar, "Install", "download", () => this.installSelectedSkills());
    if (this.selectMode) {
      const bulkToolbar = this.contentEl.createDiv({ cls: "skillhub-toolbar skillhub-bulk-toolbar" });
      bulkToolbar.createSpan({ cls: "skillhub-selection-count", text: `${this.selectedSkillIds.size + this.selectedCollectionIds.size} selected` });
      this.addButton(bulkToolbar, "Update collections", () => this.openBulkCollections(), this.selectedSkillIds.size === 0);
      this.addButton(bulkToolbar, "Delete selected", () => this.openBulkDelete(), this.selectedSkillIds.size === 0);
    }
    const controls = this.contentEl.createDiv({ cls: "skillhub-controls" });
    const filter = controls.createEl("input", {
      type: "search",
      cls: "skillhub-filter",
      attr: { placeholder: "Filter skills", "aria-label": "Filter skills" }
    });
    filter.value = this.filterQuery;
    const sort = controls.createEl("select", { cls: "skillhub-sort", attr: { "aria-label": "Sort skills" } });
    this.addSortOption(sort, "nickname", "Nickname");
    this.addSortOption(sort, "originalName", "Original name");
    this.addSortOption(sort, "updatedAt", "Recently updated");
    this.addSortOption(sort, "custom", "Custom order");
    sort.value = this.plugin.data.settings.defaultSort;
    const results = this.contentEl.createDiv();
    filter.addEventListener("input", () => {
      this.filterQuery = filter.value;
      this.renderSkillGrid(results);
    });
    sort.addEventListener("change", () => {
      this.plugin.data.settings.defaultSort = sort.value;
      void this.plugin.saveSkillHubData();
      this.renderSkillGrid(results);
    });
    this.renderSkillGrid(results);
  }
  renderSkillGrid(container) {
    var _a;
    (_a = this.folderBoardResizeObserver) == null ? void 0 : _a.disconnect();
    this.folderBoardResizeObserver = void 0;
    container.empty();
    const visibleSkills = this.getVisibleSkills();
    const visibleSkillIds = new Set(visibleSkills.map((skill) => skill.id));
    const bundles = deriveSkillBundles(Object.values(this.plugin.registry.data.skills), this.plugin.registry.data.bundleMetadata);
    const bundledSkillIds = new Set(bundles.flatMap((bundle) => bundle.skills.map((skill) => skill.id)));
    const query = this.filterQuery.trim().toLocaleLowerCase();
    const visibleBundles = bundles.map((bundle) => ({
      bundle,
      skills: this.sortSkills(
        query && [bundle.name, bundle.sourceLabel, bundle.sourceValue].some((value) => value.toLocaleLowerCase().includes(query)) ? bundle.skills : bundle.skills.filter((skill) => visibleSkillIds.has(skill.id))
      )
    })).filter(({ skills }) => skills.length > 0);
    const standaloneSkills = visibleSkills.filter((skill) => !bundledSkillIds.has(skill.id));
    const collections = Object.values(this.plugin.registry.data.collections).sort((left, right) => left.name.localeCompare(right.name));
    if (standaloneSkills.length === 0 && visibleBundles.length === 0 && collections.length === 0) {
      container.createEl("p", {
        cls: "skillhub-empty",
        text: Object.keys(this.plugin.registry.data.skills).length === 0 ? "No skills installed yet." : "No skills match this filter."
      });
      return;
    }
    if (standaloneSkills.length > 0) {
      const grid = container.createDiv({ cls: "skillhub-grid" });
      for (const skill of standaloneSkills) this.renderCard(grid, skill);
    }
    this.renderFolderBoard(container, visibleBundles, collections);
  }
  renderCard(grid, skill, collection) {
    const selected = this.selectedSkillIds.has(skill.id);
    const card = grid.createDiv({ cls: `skillhub-card${selected ? " is-selected" : ""}` });
    if (this.selectMode) this.configureSelectableBlock(card, selected, () => this.toggleSkillSelection(skill.id));
    card.draggable = Boolean(collection) || this.isCustomSort() || this.hasCollections();
    if (card.draggable) {
      card.addClass("is-draggable");
      card.addEventListener("dragstart", (event) => {
        var _a, _b, _c, _d, _e;
        if (collection) {
          this.pendingCollectionDrag = { collectionId: collection.id, skillId: skill.id, handled: false };
          (_a = event.dataTransfer) == null ? void 0 : _a.setData("application/x-skillhub-collection-skill-id", skill.id);
          (_b = event.dataTransfer) == null ? void 0 : _b.setData("application/x-skillhub-collection-id", collection.id);
        }
        (_c = event.dataTransfer) == null ? void 0 : _c.setData("text/plain", skill.id);
        (_d = event.dataTransfer) == null ? void 0 : _d.setData("application/x-skillhub-skill-id", skill.id);
        (_e = event.dataTransfer) == null ? void 0 : _e.setDragImage(card, 20, 20);
      });
      if (collection || this.isCustomSort()) {
        card.addEventListener("dragover", (event) => {
          event.preventDefault();
          if (collection) event.stopPropagation();
          card.addClass("is-drop-target");
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        });
        card.addEventListener("dragleave", () => card.removeClass("is-drop-target"));
        card.addEventListener("drop", (event) => {
          var _a, _b, _c, _d, _e;
          event.preventDefault();
          if (collection) event.stopPropagation();
          card.removeClass("is-drop-target");
          if (collection) {
            const draggedCollectionId = (_a = event.dataTransfer) == null ? void 0 : _a.getData("application/x-skillhub-collection-id");
            const draggedCollectionSkillId = (_b = event.dataTransfer) == null ? void 0 : _b.getData("application/x-skillhub-collection-skill-id");
            if (draggedCollectionId === collection.id && draggedCollectionSkillId) {
              this.markCollectionDragHandled();
              void this.reorderCollectionSkill(collection.id, draggedCollectionSkillId, skill.id, this.shouldDropAfter(card, event));
              return;
            }
            const droppedSkillId = (_c = event.dataTransfer) == null ? void 0 : _c.getData("application/x-skillhub-skill-id");
            if (droppedSkillId) {
              this.markCollectionDragHandled();
              void this.handleCollectionDrop(droppedSkillId, collection.id);
            }
            return;
          }
          const draggedSkillId = ((_d = event.dataTransfer) == null ? void 0 : _d.getData("application/x-skillhub-skill-id")) || ((_e = event.dataTransfer) == null ? void 0 : _e.getData("text/plain"));
          if (draggedSkillId) void this.reorderSkill(draggedSkillId, skill.id, this.shouldDropAfter(card, event));
        });
      }
      if (collection) {
        card.addEventListener("dragend", () => {
          const pendingCollectionDrag = this.pendingCollectionDrag;
          if ((pendingCollectionDrag == null ? void 0 : pendingCollectionDrag.collectionId) === collection.id && pendingCollectionDrag.skillId === skill.id && !pendingCollectionDrag.handled) {
            void this.removeSkillFromCollection(skill.id, collection.id);
          }
          this.pendingCollectionDrag = void 0;
        });
      }
    }
    if (skill.color) card.style.setProperty("--skillhub-card-color", skill.color);
    card.createEl("strong", { text: `${skill.emoji ? `${skill.emoji} ` : ""}${skill.nickname}` });
    if (skill.originalName !== skill.nickname) card.createSpan({ cls: "skillhub-original-name", text: skill.originalName });
    const chips = card.createDiv({ cls: "skillhub-chips" });
    for (const tag of skill.tags) this.renderTagChip(chips, skill, tag);
    if (skill.warnings.length > 0) {
      chips.createSpan({ cls: "skillhub-chip is-warning", text: `${skill.warnings.length} warning${skill.warnings.length === 1 ? "" : "s"}` });
    }
    const actions = card.createDiv({ cls: "skillhub-card-actions" });
    this.addCardActionButton(actions, "Install", "install", () => this.installSkill(skill));
    this.addCardActionButton(actions, "Details", "details", () => this.openDetailModal(skill));
    this.addCardActionButton(actions, "Edit", "edit", () => this.openEditModal(skill));
    this.addCardActionButton(actions, "Delete", "delete", () => this.openDeleteModal(skill));
  }
  renderFolderBoard(container, bundles, collections) {
    if (bundles.length === 0 && collections.length === 0) return;
    const board = container.createDiv({ cls: "skillhub-folder-board" });
    const folders = [
      ...bundles.map(({ bundle, skills }) => ({
        id: bundle.id,
        name: bundle.name,
        renderFolder: () => this.renderBundleFolder(board, bundle),
        renderExpansion: () => this.renderBundleExpansion(board, bundle, skills)
      })),
      ...collections.map((collection) => ({
        id: this.getCollectionFolderId(collection.id),
        name: collection.name,
        renderFolder: () => this.renderCollectionFolder(board, collection),
        renderExpansion: () => this.renderCollectionExpansion(board, collection)
      }))
    ];
    const orderIndex = new Map(this.plugin.registry.data.folderOrder.map((id, index) => [id, index]));
    folders.sort((left, right) => {
      var _a, _b;
      const pinOrder = Number(this.isFolderPinned(right.id)) - Number(this.isFolderPinned(left.id));
      const customOrder = ((_a = orderIndex.get(left.id)) != null ? _a : Number.MAX_SAFE_INTEGER) - ((_b = orderIndex.get(right.id)) != null ? _b : Number.MAX_SAFE_INTEGER);
      return pinOrder || customOrder || left.name.localeCompare(right.name);
    });
    for (const folder of folders) folder.renderFolder();
    const expandedFolderIndex = folders.findIndex((folder) => folder.id === this.expandedFolderId);
    if (expandedFolderIndex === -1) return;
    const expansion = folders[expandedFolderIndex].renderExpansion();
    const positionExpansion = () => {
      if (!board.isConnected) return;
      const columns = window.getComputedStyle(board).gridTemplateColumns.split(" ").filter((column) => column && column !== "none");
      const columnCount = Math.max(1, columns.length);
      expansion.style.gridRow = String(Math.floor(expandedFolderIndex / columnCount) + 2);
    };
    positionExpansion();
    this.folderBoardResizeObserver = new ResizeObserver(positionExpansion);
    this.folderBoardResizeObserver.observe(board);
  }
  renderBundleFolder(board, bundle) {
    const selected = bundle.skills.every((skill) => this.selectedSkillIds.has(skill.id));
    const folder = this.createFolderTile(board, {
      id: bundle.id,
      title: bundle.name,
      count: bundle.skills.length,
      selected,
      onToggle: () => this.toggleExpandedFolder(bundle.id),
      onSelect: () => this.toggleBundleSelection(bundle),
      renderActions: (actions) => {
        this.addCardActionButton(actions, "Install", "install", () => this.installBundle(bundle));
        this.addCardActionButton(actions, this.isFolderPinned(bundle.id) ? "Unpin" : "Pin", "pin", () => void this.toggleFolderPin(bundle.id), this.isFolderPinned(bundle.id));
        this.addCardActionButton(actions, "Details", "details", () => this.openBundleDetailModal(bundle));
        this.addCardActionButton(actions, "Edit", "edit", () => this.openBundleEditModal(bundle));
        this.addCardActionButton(actions, "Delete", "delete", () => this.openBundleDeleteModal(bundle));
      }
    });
    folder.addClass("is-bundle");
    if (bundle.color) folder.style.setProperty("--skillhub-folder-color", bundle.color);
  }
  renderBundleExpansion(board, bundle, visibleSkills) {
    const expansion = board.createDiv({ cls: "skillhub-folder-expansion is-bundle" });
    if (bundle.color) expansion.style.setProperty("--skillhub-folder-color", bundle.color);
    const header = expansion.createDiv({ cls: "skillhub-folder-expansion-header" });
    header.createEl("strong", { text: bundle.name });
    header.createSpan({ text: bundle.sourceLabel });
    if (bundle.description) expansion.createEl("p", { cls: "skillhub-collection-description", text: bundle.description });
    const grid = expansion.createDiv({ cls: "skillhub-grid skillhub-folder-expanded-grid" });
    for (const skill of visibleSkills) this.renderCard(grid, skill);
    return expansion;
  }
  renderCollectionFolder(board, collection) {
    const selected = this.selectedCollectionIds.has(collection.id);
    const folderId = this.getCollectionFolderId(collection.id);
    const folder = this.createFolderTile(board, {
      id: folderId,
      title: collection.name,
      count: collection.skillIds.length,
      selected,
      onToggle: () => this.toggleExpandedFolder(folderId),
      onSelect: () => this.toggleCollectionSelection(collection.id),
      renderActions: (actions) => {
        this.addCardActionButton(actions, "Install", "install", () => this.installCollection(collection));
        this.addCardActionButton(actions, this.isFolderPinned(folderId) ? "Unpin" : "Pin", "pin", () => void this.toggleFolderPin(folderId), this.isFolderPinned(folderId));
        this.addCardActionButton(actions, "Details", "details", () => this.openCollectionDetailModal(collection));
        this.addCardActionButton(actions, "Edit", "edit", () => this.openCollectionEditModal(collection));
        this.addCardActionButton(actions, "Delete", "delete", () => this.openCollectionDeleteModal(collection));
      }
    });
    folder.addClass("is-collection");
    if (collection.color) folder.style.setProperty("--skillhub-folder-color", collection.color);
    this.configureCollectionDropTarget(folder, collection.id);
  }
  renderCollectionExpansion(board, collection) {
    const expansion = board.createDiv({ cls: "skillhub-folder-expansion is-collection" });
    if (collection.color) expansion.style.setProperty("--skillhub-collection-color", collection.color);
    this.configureCollectionDropTarget(expansion, collection.id);
    const header = expansion.createDiv({ cls: "skillhub-folder-expansion-header" });
    header.createEl("strong", { text: collection.name });
    header.createSpan({ text: `${collection.skillIds.length} skill${collection.skillIds.length === 1 ? "" : "s"}` });
    if (collection.description) expansion.createEl("p", { cls: "skillhub-collection-description", text: collection.description });
    const memberSkills = this.getCollectionSkills(collection);
    if (memberSkills.length === 0) {
      expansion.createSpan({ cls: "skillhub-collection-empty", text: "Drop skills here" });
    } else {
      const grid = expansion.createDiv({ cls: "skillhub-grid skillhub-folder-expanded-grid" });
      for (const skill of memberSkills) this.renderCard(grid, skill, collection);
    }
    return expansion;
  }
  createFolderTile(board, options) {
    const expanded = this.expandedFolderId === options.id;
    const folder = board.createDiv({ cls: `skillhub-folder${expanded ? " is-expanded" : ""}${options.selected ? " is-selected" : ""}` });
    folder.setAttribute("role", "button");
    folder.setAttribute("tabindex", "0");
    folder.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (this.selectMode) {
      this.configureSelectableBlock(folder, options.selected, options.onSelect);
    } else {
      folder.draggable = true;
      folder.addClass("is-draggable");
      folder.addEventListener("dragstart", (event) => {
        var _a, _b;
        if (this.isInteractiveSelectionTarget(event.target)) {
          event.preventDefault();
          return;
        }
        (_a = event.dataTransfer) == null ? void 0 : _a.setData(FOLDER_DRAG_TYPE, options.id);
        (_b = event.dataTransfer) == null ? void 0 : _b.setDragImage(folder, 20, 20);
      });
      folder.addEventListener("dragover", (event) => {
        if (!this.hasDataTransferType(event, FOLDER_DRAG_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        const dropAfter = this.shouldDropAfter(folder, event);
        folder.removeClass(dropAfter ? "is-folder-drop-before" : "is-folder-drop-after");
        folder.addClass(dropAfter ? "is-folder-drop-after" : "is-folder-drop-before");
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      });
      folder.addEventListener("dragleave", () => this.clearFolderDropIndicator(folder));
      folder.addEventListener("drop", (event) => {
        var _a;
        const draggedFolderId = (_a = event.dataTransfer) == null ? void 0 : _a.getData(FOLDER_DRAG_TYPE);
        if (!draggedFolderId) return;
        event.preventDefault();
        event.stopPropagation();
        const dropAfter = this.shouldDropAfter(folder, event);
        this.clearFolderDropIndicator(folder);
        void this.reorderFolder(draggedFolderId, options.id, dropAfter);
      });
      folder.addEventListener("click", (event) => {
        if (this.isInteractiveSelectionTarget(event.target)) return;
        options.onToggle();
      });
      folder.addEventListener("keydown", (event) => {
        if (this.isInteractiveSelectionTarget(event.target)) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        options.onToggle();
      });
    }
    const shape = folder.createDiv({ cls: "skillhub-folder__shape" });
    shape.createDiv({ cls: "skillhub-folder__back" });
    const papers = shape.createDiv({ cls: "skillhub-folder__papers" });
    papers.createSpan({ cls: "skillhub-folder__paper skillhub-folder__paper--1" });
    papers.createSpan({ cls: "skillhub-folder__paper skillhub-folder__paper--2" });
    papers.createSpan({ cls: "skillhub-folder__paper skillhub-folder__paper--3" });
    shape.createDiv({ cls: "skillhub-folder__front" });
    const meta = folder.createDiv({ cls: "skillhub-folder__meta" });
    const titleEl = meta.createSpan({ cls: "skillhub-folder__title", text: options.title });
    const countEl = meta.createSpan({ cls: "skillhub-folder__count", text: `${options.count} skill${options.count === 1 ? "" : "s"}` });
    const labelId = `skillhub-folder-${encodeURIComponent(options.id)}`;
    titleEl.id = `${labelId}-title`;
    countEl.id = `${labelId}-count`;
    folder.setAttribute("aria-labelledby", `${titleEl.id} ${countEl.id}`);
    const actions = folder.createDiv({ cls: "skillhub-folder-actions" });
    options.renderActions(actions);
    return folder;
  }
  configureCollectionDropTarget(element, collectionId) {
    element.addEventListener("dragover", (event) => {
      if (!this.hasDataTransferType(event, "application/x-skillhub-skill-id")) return;
      event.preventDefault();
      element.addClass("is-drop-target");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    element.addEventListener("dragleave", () => element.removeClass("is-drop-target"));
    element.addEventListener("drop", (event) => {
      var _a, _b;
      if (!this.hasDataTransferType(event, "application/x-skillhub-skill-id")) return;
      event.preventDefault();
      element.removeClass("is-drop-target");
      const skillId = ((_a = event.dataTransfer) == null ? void 0 : _a.getData("application/x-skillhub-skill-id")) || ((_b = event.dataTransfer) == null ? void 0 : _b.getData("text/plain"));
      if (skillId) {
        this.markCollectionDragHandled();
        void this.handleCollectionDrop(skillId, collectionId);
      }
    });
  }
  openDetailModal(skill) {
    new SkillDetailModal(this.app, skill, Object.values(this.plugin.registry.data.collections)).open();
  }
  installSkill(skill) {
    void this.plugin.installSkills([skill]);
  }
  installBundle(bundle) {
    void this.plugin.installSkills(bundle.skills);
  }
  installCollection(collection) {
    const skills = this.getCollectionSkills(collection);
    if (skills.length === 0) {
      new import_obsidian3.Notice("Collection has no skills to install.");
      return;
    }
    void this.plugin.installSkills(skills);
  }
  openEditModal(skill) {
    this.plugin.registry.data.tagColors = collectTagColors(this.plugin.registry.data);
    new SkillEditModal(this.app, skill, Object.values(this.plugin.registry.data.collections), this.getAllTags(), this.plugin.registry.data.tagColors, async (values) => {
      skill.nickname = values.nickname;
      skill.emoji = values.emoji;
      skill.color = values.color;
      skill.tags = values.tags;
      delete skill.tagColors;
      this.plugin.registry.data.tagColors = values.tagColors;
      this.plugin.registry.updateSkillCollections(skill.id, values.collectionIds);
      skill.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await this.plugin.saveSkillHubData();
      this.render();
    }).open();
  }
  renderTagChip(chips, skill, tag) {
    const chip = chips.createSpan({ cls: "skillhub-chip", text: tag });
    const tagColor = this.plugin.registry.data.tagColors[tag];
    if (tagColor) {
      chip.addClass("has-color");
      chip.style.setProperty("--skillhub-tag-color", tagColor);
    }
  }
  getAllTags() {
    const tags = new Set(Object.keys(this.plugin.registry.data.tagColors));
    for (const skill of Object.values(this.plugin.registry.data.skills)) {
      for (const tag of skill.tags) tags.add(tag);
    }
    return [...tags].sort((left, right) => left.localeCompare(right));
  }
  openDeleteModal(skill) {
    new DeleteConfirmationModal(this.app, skill, async () => {
      try {
        await this.plugin.deleteSkill(skill);
        this.selectedSkillIds.delete(skill.id);
        this.render();
      } catch (error) {
        new import_obsidian3.Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }
  openBundleDetailModal(bundle) {
    new BundleDetailModal(this.app, bundle).open();
  }
  openBundleEditModal(bundle) {
    new BundleEditModal(this.app, bundle, async (values) => {
      var _a;
      const previous = this.plugin.registry.data.bundleMetadata[bundle.id];
      const retainedSkillIds = new Set(values.skillIds);
      const excludedSkillIds = new Set((_a = previous == null ? void 0 : previous.excludedSkillIds) != null ? _a : []);
      for (const skill of bundle.skills) {
        if (!retainedSkillIds.has(skill.id)) excludedSkillIds.add(skill.id);
      }
      this.plugin.registry.data.bundleMetadata[bundle.id] = {
        name: values.name,
        description: values.description,
        color: values.color,
        excludedSkillIds: [...excludedSkillIds]
      };
      await this.plugin.saveSkillHubData();
      this.render();
    }).open();
  }
  openBundleDeleteModal(bundle) {
    new BulkDeleteConfirmationModal(this.app, bundle.skills, async () => {
      try {
        await this.plugin.deleteSkills(bundle.skills);
        delete this.plugin.registry.data.bundleMetadata[bundle.id];
        this.removeFolderPin(bundle.id);
        this.removeFolderOrder(bundle.id);
        for (const skill of bundle.skills) this.selectedSkillIds.delete(skill.id);
        if (this.expandedFolderId === bundle.id) this.expandedFolderId = void 0;
        await this.plugin.saveSkillHubData();
        this.render();
      } catch (error) {
        new import_obsidian3.Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }
  openCollectionDetailModal(collection) {
    new CollectionDetailModal(this.app, collection, this.getCollectionSkills(collection)).open();
  }
  openCollectionEditModal(collection) {
    new CollectionEditModal(this.app, collection, async (values) => {
      var _a;
      this.plugin.registry.saveCollection({ ...collection, ...values, skillIds: (_a = values.skillIds) != null ? _a : collection.skillIds });
      if (values.skillIds) this.applyCollectionSkillIds(collection.id, values.skillIds);
      this.plugin.registry.recordEvent(createSkillEvent("collection_saved", void 0, { collectionId: collection.id }));
      await this.plugin.saveSkillHubData();
      this.render();
    }, this.getCollectionSkills(collection)).open();
  }
  openCollectionDeleteModal(collection) {
    new CollectionDeleteConfirmationModal(this.app, collection, () => this.deleteCollection(collection)).open();
  }
  async deleteCollection(collection) {
    this.plugin.registry.deleteCollection(collection.id);
    const folderId = this.getCollectionFolderId(collection.id);
    this.removeFolderPin(folderId);
    this.removeFolderOrder(folderId);
    if (this.expandedFolderId === folderId) this.expandedFolderId = void 0;
    this.plugin.registry.recordEvent(createSkillEvent("collection_deleted", void 0, { collectionId: collection.id }));
    await this.plugin.saveSkillHubData();
    this.render();
  }
  async handleCollectionDrop(skillId, collectionId) {
    const skill = this.plugin.registry.data.skills[skillId];
    const collection = this.plugin.registry.data.collections[collectionId];
    if (!skill || !collection || skill.collectionIds.includes(collectionId)) return;
    this.plugin.registry.updateSkillCollections(skillId, [...skill.collectionIds, collectionId]);
    skill.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.plugin.registry.recordEvent(createSkillEvent("collection_saved", void 0, { collectionId, skillId }));
    await this.plugin.saveSkillHubData();
    this.render();
  }
  async removeSkillFromCollection(skillId, collectionId) {
    const skill = this.plugin.registry.data.skills[skillId];
    if (!(skill == null ? void 0 : skill.collectionIds.includes(collectionId))) return;
    this.plugin.registry.updateSkillCollections(skillId, skill.collectionIds.filter((id) => id !== collectionId));
    skill.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.plugin.registry.recordEvent(createSkillEvent("collection_saved", void 0, { collectionId, skillId }));
    await this.plugin.saveSkillHubData();
    this.render();
  }
  applyCollectionSkillIds(collectionId, skillIds) {
    const collection = this.plugin.registry.data.collections[collectionId];
    if (!collection) return;
    const validSkillIds = [...new Set(skillIds)].filter((skillId) => Boolean(this.plugin.registry.data.skills[skillId]));
    const selectedSkillIds = new Set(validSkillIds);
    collection.skillIds = validSkillIds;
    for (const skill of Object.values(this.plugin.registry.data.skills)) {
      if (selectedSkillIds.has(skill.id)) {
        if (!skill.collectionIds.includes(collectionId)) skill.collectionIds.push(collectionId);
      } else {
        skill.collectionIds = skill.collectionIds.filter((id) => id !== collectionId);
      }
      skill.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
  }
  async reorderCollectionSkill(collectionId, draggedSkillId, targetSkillId, afterTarget) {
    const collection = this.plugin.registry.data.collections[collectionId];
    if (!collection || draggedSkillId === targetSkillId || !collection.skillIds.includes(draggedSkillId) || !collection.skillIds.includes(targetSkillId)) return;
    const reorderedSkillIds = collection.skillIds.filter((skillId) => skillId !== draggedSkillId);
    const targetIndex = reorderedSkillIds.indexOf(targetSkillId);
    if (targetIndex === -1) return;
    reorderedSkillIds.splice(targetIndex + (afterTarget ? 1 : 0), 0, draggedSkillId);
    collection.skillIds = reorderedSkillIds;
    this.plugin.registry.recordEvent(createSkillEvent("collection_saved", void 0, { collectionId, skillId: draggedSkillId }));
    await this.plugin.saveSkillHubData();
    this.render();
  }
  markCollectionDragHandled() {
    if (this.pendingCollectionDrag) this.pendingCollectionDrag.handled = true;
  }
  configureSelectableBlock(element, selected, onToggle) {
    element.addClass("is-selectable");
    element.setAttribute("role", "button");
    element.setAttribute("tabindex", "0");
    element.setAttribute("aria-pressed", selected ? "true" : "false");
    element.addEventListener("click", (event) => {
      if (this.isInteractiveSelectionTarget(event.target)) return;
      onToggle();
    });
    element.addEventListener("keydown", (event) => {
      if (this.isInteractiveSelectionTarget(event.target)) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onToggle();
    });
  }
  isInteractiveSelectionTarget(target) {
    return target instanceof HTMLElement && Boolean(target.closest("button, input, select, textarea, a"));
  }
  toggleSkillSelection(skillId) {
    this.selectedSkillIds.has(skillId) ? this.selectedSkillIds.delete(skillId) : this.selectedSkillIds.add(skillId);
    this.render();
  }
  toggleSelectMode() {
    this.selectMode = !this.selectMode;
    if (!this.selectMode) {
      this.selectedSkillIds.clear();
      this.selectedCollectionIds.clear();
    }
    this.render();
  }
  toggleBundleSelection(bundle) {
    const allSelected = bundle.skills.every((skill) => this.selectedSkillIds.has(skill.id));
    for (const skill of bundle.skills) {
      allSelected ? this.selectedSkillIds.delete(skill.id) : this.selectedSkillIds.add(skill.id);
    }
    this.render();
  }
  toggleCollectionSelection(collectionId) {
    this.selectedCollectionIds.has(collectionId) ? this.selectedCollectionIds.delete(collectionId) : this.selectedCollectionIds.add(collectionId);
    this.render();
  }
  toggleExpandedFolder(folderId) {
    this.expandedFolderId = this.expandedFolderId === folderId ? void 0 : folderId;
    this.render();
  }
  getCollectionFolderId(collectionId) {
    return `collection:${collectionId}`;
  }
  hasDataTransferType(event, type) {
    var _a, _b;
    return Array.from((_b = (_a = event.dataTransfer) == null ? void 0 : _a.types) != null ? _b : []).includes(type);
  }
  clearFolderDropIndicator(folder) {
    folder.removeClass("is-folder-drop-before");
    folder.removeClass("is-folder-drop-after");
  }
  isFolderPinned(folderId) {
    return this.plugin.registry.data.pinnedFolderIds.includes(folderId);
  }
  async toggleFolderPin(folderId) {
    if (this.isFolderPinned(folderId)) {
      this.removeFolderPin(folderId);
    } else {
      this.plugin.registry.data.pinnedFolderIds.push(folderId);
    }
    await this.plugin.saveSkillHubData();
    this.render();
  }
  removeFolderPin(folderId) {
    this.plugin.registry.data.pinnedFolderIds = this.plugin.registry.data.pinnedFolderIds.filter((id) => id !== folderId);
  }
  async reorderFolder(draggedFolderId, targetFolderId, afterTarget) {
    if (draggedFolderId === targetFolderId) return;
    const bundleIds = deriveSkillBundles(
      Object.values(this.plugin.registry.data.skills),
      this.plugin.registry.data.bundleMetadata
    ).map((bundle) => bundle.id);
    const collectionIds = Object.values(this.plugin.registry.data.collections).sort((left, right) => left.name.localeCompare(right.name)).map((collection) => this.getCollectionFolderId(collection.id));
    const knownFolderIds = /* @__PURE__ */ new Set([...bundleIds, ...collectionIds]);
    if (!knownFolderIds.has(draggedFolderId) || !knownFolderIds.has(targetFolderId)) return;
    const orderedFolderIds = [
      ...this.plugin.registry.data.folderOrder.filter((id) => knownFolderIds.has(id)),
      ...[...bundleIds, ...collectionIds].filter((id) => !this.plugin.registry.data.folderOrder.includes(id))
    ].filter((id) => id !== draggedFolderId);
    const targetIndex = orderedFolderIds.indexOf(targetFolderId);
    if (targetIndex === -1) return;
    orderedFolderIds.splice(targetIndex + (afterTarget ? 1 : 0), 0, draggedFolderId);
    this.plugin.registry.data.folderOrder = orderedFolderIds;
    await this.plugin.saveSkillHubData();
    this.render();
  }
  removeFolderOrder(folderId) {
    this.plugin.registry.data.folderOrder = this.plugin.registry.data.folderOrder.filter((id) => id !== folderId);
  }
  openBulkDelete() {
    const records = this.getSelectedSkills();
    new BulkDeleteConfirmationModal(this.app, records, async () => {
      try {
        await this.plugin.deleteSkills(records);
        this.selectedSkillIds.clear();
        this.render();
      } catch (error) {
        new import_obsidian3.Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }
  openBulkCollections() {
    const records = this.getSelectedSkills();
    const collections = Object.values(this.plugin.registry.data.collections);
    if (collections.length === 0) {
      new import_obsidian3.Notice("Create a collection first.");
      return;
    }
    new BulkCollectionMembershipModal(this.app, collections, async ({ action, collectionIds }) => {
      for (const record of records) {
        const memberships = new Set(record.collectionIds);
        for (const collectionId of collectionIds) action === "add" ? memberships.add(collectionId) : memberships.delete(collectionId);
        this.plugin.registry.updateSkillCollections(record.id, [...memberships]);
        record.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
      await this.plugin.saveSkillHubData();
      this.render();
    }).open();
  }
  openInstallSelectionModal() {
    new InstallSelectionModal(
      this.app,
      Object.values(this.plugin.registry.data.skills),
      Object.values(this.plugin.registry.data.collections),
      async ({ skillIds, collectionIds }) => {
        const records = this.resolveInstallSkills(skillIds, collectionIds);
        if (records.length === 0) {
          new import_obsidian3.Notice("Select at least one skill or collection to install.");
          return;
        }
        await this.plugin.installSkills(records);
      }
    ).open();
  }
  openCollectionManager() {
    new CollectionManagerModal(this.app, () => Object.values(this.plugin.registry.data.collections), {
      create: async (values) => {
        const collection = {
          id: `collection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          ...values,
          skillIds: []
        };
        this.plugin.registry.saveCollection(collection);
        this.plugin.registry.recordEvent(createSkillEvent("collection_saved", void 0, { collectionId: collection.id }));
        await this.plugin.saveSkillHubData();
        this.render();
      },
      update: async (collection, values) => {
        this.plugin.registry.saveCollection({ ...collection, ...values });
        this.plugin.registry.recordEvent(createSkillEvent("collection_saved", void 0, { collectionId: collection.id }));
        await this.plugin.saveSkillHubData();
        this.render();
      },
      delete: (collection) => this.deleteCollection(collection)
    }).open();
  }
  getSelectedSkills() {
    return Object.values(this.plugin.registry.data.skills).filter((skill) => this.selectedSkillIds.has(skill.id));
  }
  getSelectedInstallSkills() {
    return this.resolveInstallSkills([...this.selectedSkillIds], [...this.selectedCollectionIds]);
  }
  resolveInstallSkills(skillIds, collectionIds) {
    const resolvedSkillIds = /* @__PURE__ */ new Set();
    for (const skillId of skillIds) {
      if (this.plugin.registry.data.skills[skillId]) resolvedSkillIds.add(skillId);
    }
    for (const collectionId of collectionIds) {
      const collection = this.plugin.registry.data.collections[collectionId];
      if (!collection) continue;
      for (const skillId of collection.skillIds) {
        if (this.plugin.registry.data.skills[skillId]) resolvedSkillIds.add(skillId);
      }
    }
    return [...resolvedSkillIds].map((skillId) => this.plugin.registry.data.skills[skillId]);
  }
  getVisibleSkills() {
    const query = this.filterQuery.trim().toLocaleLowerCase();
    const collections = this.plugin.registry.data.collections;
    const visibleSkills = Object.values(this.plugin.registry.data.skills).filter((skill) => {
      if (!query) return true;
      const collectionNames = skill.collectionIds.map((id) => {
        var _a, _b;
        return (_b = (_a = collections[id]) == null ? void 0 : _a.name) != null ? _b : "";
      });
      return [skill.nickname, skill.originalName, skill.description, ...skill.tags, ...collectionNames].some((value) => value.toLocaleLowerCase().includes(query));
    });
    return this.sortSkills(visibleSkills);
  }
  sortSkills(skills) {
    const sort = this.plugin.data.settings.defaultSort;
    if (sort === "custom") return this.sortByCustomOrder(skills);
    return [...skills].sort((left, right) => {
      if (sort === "updatedAt") return right.updatedAt.localeCompare(left.updatedAt);
      return left[sort].localeCompare(right[sort]);
    });
  }
  sortByCustomOrder(skills) {
    const orderIndex = new Map(this.plugin.data.settings.skillOrder.map((id, index) => [id, index]));
    return [...skills].sort((left, right) => {
      var _a, _b;
      const leftIndex = (_a = orderIndex.get(left.id)) != null ? _a : Number.MAX_SAFE_INTEGER;
      const rightIndex = (_b = orderIndex.get(right.id)) != null ? _b : Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return left.nickname.localeCompare(right.nickname);
    });
  }
  async reorderSkill(draggedSkillId, targetSkillId, afterTarget) {
    if (draggedSkillId === targetSkillId || !this.plugin.registry.data.skills[draggedSkillId] || !this.plugin.registry.data.skills[targetSkillId]) return;
    const knownSkillIds = new Set(Object.keys(this.plugin.registry.data.skills));
    const orderedIds = [
      ...this.plugin.data.settings.skillOrder.filter((id) => knownSkillIds.has(id)),
      ...Object.keys(this.plugin.registry.data.skills).filter((id) => !this.plugin.data.settings.skillOrder.includes(id))
    ];
    const withoutDragged = orderedIds.filter((id) => id !== draggedSkillId);
    const targetIndex = withoutDragged.indexOf(targetSkillId);
    if (targetIndex === -1) return;
    withoutDragged.splice(targetIndex + (afterTarget ? 1 : 0), 0, draggedSkillId);
    this.plugin.data.settings.skillOrder = withoutDragged;
    await this.plugin.saveSkillHubData();
    this.render();
  }
  shouldDropAfter(card, event) {
    const rect = card.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2 || event.clientY >= rect.top && event.clientY <= rect.bottom && event.clientX > rect.left + rect.width / 2;
  }
  isCustomSort() {
    return this.plugin.data.settings.defaultSort === "custom";
  }
  hasCollections() {
    return Object.keys(this.plugin.registry.data.collections).length > 0;
  }
  getCollectionSkills(collection) {
    return collection.skillIds.map((skillId) => this.plugin.registry.data.skills[skillId]).filter((skill) => Boolean(skill));
  }
  removeMissingSelections() {
    for (const id of this.selectedSkillIds) {
      if (!this.plugin.registry.data.skills[id]) this.selectedSkillIds.delete(id);
    }
    for (const id of this.selectedCollectionIds) {
      if (!this.plugin.registry.data.collections[id]) this.selectedCollectionIds.delete(id);
    }
  }
  addSortOption(select, value, label) {
    select.createEl("option", { text: label, value });
  }
  addButton(container, label, onClick, disabled = false) {
    const button = container.createEl("button", { text: label });
    button.disabled = disabled;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
  }
  addToolbarButton(container, label, icon, onClick, disabled = false) {
    const button = container.createEl("button", {
      cls: "skillhub-toolbar-button",
      attr: { "aria-label": label }
    });
    button.disabled = disabled;
    button.createSpan({ cls: "skillhub-toolbar-label", text: label });
    this.createToolbarIcon(button, icon);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
  }
  addCardActionButton(container, label, icon, onClick, active = false) {
    const actionClass = icon === "delete" ? "skillhub-delete-button" : icon === "edit" ? "skillhub-edit-button" : icon === "install" ? "skillhub-install-button" : icon === "pin" ? "skillhub-pin-button" : "skillhub-details-button";
    const button = container.createEl("button", {
      cls: `skillhub-card-action-button ${actionClass}${active ? " is-active" : ""}`,
      attr: { type: "button", ...icon === "pin" ? { "aria-pressed": String(active) } : {} }
    });
    button.createSpan({ cls: "skillhub-action-tooltip", text: label });
    this.createSvgIcon(button, icon);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
  }
  createSvgIcon(container, icon) {
    const svg = createSvg("svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", icon === "delete" ? "skillhub-action-svg bin" : "skillhub-action-svg");
    container.appendChild(svg);
    if (icon === "install") {
      this.appendSvgElement(svg, "path", { d: "M12 4v10" });
      this.appendSvgElement(svg, "path", { d: "m7 10 5 5 5-5" });
      this.appendSvgElement(svg, "path", { d: "M5 20h14" });
      return;
    }
    if (icon === "pin") {
      this.appendSvgElement(svg, "path", { d: "M12 17v5" });
      this.appendSvgElement(svg, "path", { d: "M5 10l2-2V4h10v4l2 2v2H5v-2Z" });
      return;
    }
    if (icon === "details") {
      this.appendSvgElement(svg, "circle", { cx: "12", cy: "12", r: "8.5" });
      this.appendSvgElement(svg, "path", { d: "M12 10.5v5.5" });
      this.appendSvgElement(svg, "path", { d: "M12 7.5h.01" });
      return;
    }
    if (icon === "edit") {
      this.appendSvgElement(svg, "path", { d: "M5 19h4.2L18.4 9.8a2.1 2.1 0 0 0 0-3L17.2 5.6a2.1 2.1 0 0 0-3 0L5 14.8V19Z" });
      this.appendSvgElement(svg, "path", { d: "M13.5 6.5l4 4" });
      return;
    }
    this.appendSvgElement(svg, "path", { d: "M8 8h8l-.6 10.2A2 2 0 0 1 13.4 20h-2.8a2 2 0 0 1-2-1.8L8 8Z" });
    this.appendSvgElement(svg, "path", { d: "M6 8h12" });
    this.appendSvgElement(svg, "path", { d: "M9.5 8V6.5A1.5 1.5 0 0 1 11 5h2a1.5 1.5 0 0 1 1.5 1.5V8" });
    this.appendSvgElement(svg, "path", { d: "M10.5 11v5" });
    this.appendSvgElement(svg, "path", { d: "M13.5 11v5" });
  }
  appendSvgElement(svg, tag, attrs) {
    const element = createSvg(tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    svg.appendChild(element);
  }
  createToolbarIcon(container, icon) {
    const svg = createSvg("svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", "skillhub-toolbar-icon");
    container.appendChild(svg);
    if (icon === "github") {
      this.appendSvgElement(svg, "path", { d: "M12 2.5a9.5 9.5 0 0 0-3 18c.48.09.65-.2.65-.46v-1.7c-2.64.58-3.2-1.12-3.2-1.12-.43-1.1-1.05-1.4-1.05-1.4-.86-.58.06-.57.06-.57.95.07 1.45.98 1.45.98.84 1.44 2.2 1.02 2.74.78.08-.61.33-1.02.6-1.26-2.1-.24-4.32-1.05-4.32-4.68 0-1.03.37-1.88.98-2.54-.1-.24-.42-1.2.09-2.5 0 0 .8-.26 2.62.97A9.1 9.1 0 0 1 12 6.68c.81 0 1.62.11 2.38.32 1.82-1.23 2.62-.97 2.62-.97.51 1.3.19 2.26.09 2.5.61.66.98 1.51.98 2.54 0 3.64-2.22 4.43-4.33 4.67.34.3.64.87.64 1.76v2.54c0 .26.17.56.66.46a9.5 9.5 0 0 0-3.04-18Z" });
      return;
    }
    if (icon === "folder") {
      this.appendSvgElement(svg, "path", { d: "M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2.5h7.5A2.5 2.5 0 0 1 21 9v7.5A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-10Z" });
      this.appendSvgElement(svg, "path", { d: "m15.5 14.5 2 2" });
      this.appendSvgElement(svg, "circle", { cx: "13", cy: "12", r: "3" });
      return;
    }
    if (icon === "node") {
      this.appendSvgElement(svg, "path", { d: "M12 2.7 20 7.2v9.6l-8 4.5-8-4.5V7.2l8-4.5Z" });
      this.appendSvgElement(svg, "path", { d: "M9.2 15.3c.5.7 1.4 1 2.5 1 1.5 0 2.4-.7 2.4-1.8 0-.9-.5-1.4-1.9-1.7l-1-.2c-.7-.2-1-.4-1-.8 0-.5.5-.8 1.2-.8.8 0 1.3.3 1.6.8" });
      return;
    }
    if (icon === "collections") {
      this.appendSvgElement(svg, "path", { d: "M7 4h11v11H7z" });
      this.appendSvgElement(svg, "path", { d: "M4 7h11v11H4z" });
      this.appendSvgElement(svg, "path", { d: "M10 10h5" });
      return;
    }
    if (icon === "select") {
      this.appendSvgElement(svg, "path", { d: "M5 7h14" });
      this.appendSvgElement(svg, "path", { d: "M5 12h14" });
      this.appendSvgElement(svg, "path", { d: "M5 17h14" });
      return;
    }
    if (icon === "done") {
      this.appendSvgElement(svg, "path", { d: "m5 12 4 4L19 6" });
      return;
    }
    this.appendSvgElement(svg, "path", { d: "M12 4v10" });
    this.appendSvgElement(svg, "path", { d: "m7 10 5 5 5-5" });
    this.appendSvgElement(svg, "path", { d: "M5 20h14" });
  }
};

// src/main.ts
var SKILL_HUB_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 6.8v3.4" />
  <path d="M8.7 13.4 6 16" />
  <path d="m15.3 13.4 2.7 2.6" />
  <path d="M10.6 11.1 12 9.7l1.4 1.4L12 12.5l-1.4-1.4Z" />
  <rect x="9.2" y="2.8" width="5.6" height="4" rx="1.2" />
  <rect x="2.8" y="16.2" width="5.6" height="4" rx="1.2" />
  <rect x="15.6" y="16.2" width="5.6" height="4" rx="1.2" />
  <path d="M12 14.4v3.2" />
  <path d="m10.6 18.4 1.4-1.4 1.4 1.4-1.4 1.4-1.4-1.4Z" />
</svg>`;
var SkillHubPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    this.data = createEmptySkillHubData();
    this.registry = new SkillRegistry(this.data);
  }
  async onload() {
    var _a, _b, _c, _d, _e, _f, _g;
    const saved = await this.loadData();
    const legacyBundleMetadata = Object.fromEntries(
      Object.entries((_a = saved == null ? void 0 : saved.bundleNames) != null ? _a : {}).map(([id, name]) => [id, { name }])
    );
    this.data = {
      settings: { ...DEFAULT_SETTINGS, ...saved == null ? void 0 : saved.settings },
      skills: (_b = saved == null ? void 0 : saved.skills) != null ? _b : {},
      collections: (_c = saved == null ? void 0 : saved.collections) != null ? _c : {},
      bundleMetadata: { ...legacyBundleMetadata, ...saved == null ? void 0 : saved.bundleMetadata },
      pinnedFolderIds: (_d = saved == null ? void 0 : saved.pinnedFolderIds) != null ? _d : [],
      folderOrder: (_e = saved == null ? void 0 : saved.folderOrder) != null ? _e : [],
      tagColors: collectTagColors({ skills: (_f = saved == null ? void 0 : saved.skills) != null ? _f : {}, tagColors: saved == null ? void 0 : saved.tagColors }),
      events: (_g = saved == null ? void 0 : saved.events) != null ? _g : []
    };
    this.registry = new SkillRegistry(this.data);
    (0, import_obsidian4.addIcon)(SKILL_HUB_ICON_ID, SKILL_HUB_ICON_SVG);
    this.addRibbonIcon(SKILL_HUB_ICON_ID, "Open Skill Hub", () => {
      void this.openSkillHub();
    });
    this.addCommand({ id: "open-skill-hub", name: "Open Skill Hub", callback: () => void this.openSkillHub() });
    this.addCommand({ id: "import-skills-from-github", name: "Import skills from GitHub", callback: () => void this.openGitHubImport() });
    this.addCommand({ id: "scan-local-skill-directory", name: "Scan local skill directory", callback: () => void this.openLocalScan() });
    this.addCommand({ id: "install-selected-skills", name: "Install selected skills", callback: () => void this.installSelectedSkills() });
    this.addSettingTab(new SkillHubSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_SKILL_HUB, (leaf) => new SkillHubView(leaf, this));
  }
  async saveSkillHubData() {
    await this.saveData(this.registry.data);
  }
  async openSkillHub() {
    var _a;
    const leaf = (_a = this.app.workspace.getLeavesOfType(VIEW_TYPE_SKILL_HUB)[0]) != null ? _a : this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_SKILL_HUB, active: true });
    void this.app.workspace.revealLeaf(leaf);
    return leaf.view;
  }
  async openGitHubImport() {
    (await this.openSkillHub()).openGitHubImport();
  }
  async openLocalScan() {
    (await this.openSkillHub()).openLocalScan();
  }
  async installSelectedSkills() {
    (await this.openSkillHub()).installSelectedSkills();
  }
  async importFromGitHub(url) {
    try {
      const requestBudget = new GitHubRequestBudget();
      const location = await resolveGitHubSkillUrl(
        url,
        (owner, repo, ref) => this.githubRefExists(owner, repo, ref, requestBudget),
        { requestBudget }
      );
      const downloader = new GitHubSkillDownloader({
        fetchJson: async (path) => {
          const response = await (0, import_obsidian4.requestUrl)({ url: `https://api.github.com${path}`, throw: false });
          return { status: response.status, data: response.json };
        },
        downloadFile: async (downloadUrl, destination, maxBytes) => {
          const response = await (0, import_obsidian4.requestUrl)({ url: downloadUrl, throw: false });
          return writeBoundedGitHubResponse(response, destination, maxBytes);
        }
      }, {}, requestBudget);
      const candidates = await downloader.listSkillCandidates(location);
      new SkillSelectionModal(this.app, candidates.map((candidate) => ({
        id: `${candidate.kind}:${candidate.name}`,
        label: candidate.label,
        value: candidate
      })), async (selected) => {
        let stagingPath;
        try {
          if (selected.length === 0) return;
          stagingPath = await (0, import_promises7.mkdtemp)((0, import_path8.join)(this.getVaultBasePath(), ".skillhub-github-import-"));
          for (const candidate of selected) await downloader.downloadSkillCandidate(location, candidate, stagingPath);
          const discovered = await discoverSkills(stagingPath);
          this.showDiscoveryWarnings(discovered.warnings);
          await this.openImportSelection(discovered.skills, { type: "github", url }, "github", stagingPath);
        } catch (error) {
          this.showError(await this.cleanupStagingAfterError(error, stagingPath));
        }
      }).open();
    } catch (error) {
      this.showError(error);
    }
  }
  async importFromLocalDirectory(path) {
    await this.importFromDirectory(path, { type: "local", path }, "local");
  }
  async pickAndImportLocalDirectory() {
    try {
      const path = await pickNativeFolder();
      if (path) await this.importFromLocalDirectory(path);
    } catch (error) {
      this.showError(error);
    }
  }
  async importFromNpx(command) {
    if (!validateNpxSkillsCommand(command)) {
      new import_obsidian4.Notice("Use an npx skills add command.");
      return;
    }
    if (!this.data.settings.npxExecutionEnabled) {
      this.openNpxFallback(command, "Automatic npx execution is disabled.");
      return;
    }
    if (!await isNpxAvailable()) {
      this.openNpxFallback(command, "npx is not available.");
      return;
    }
    let stagingPath;
    try {
      stagingPath = await runNpxSkillsAdd(command, this.getVaultBasePath());
      const discovered = await discoverSkills(stagingPath);
      this.showDiscoveryWarnings(discovered.warnings);
      await this.openImportSelection(discovered.skills, { type: "npx", command }, "npx", stagingPath);
    } catch (error) {
      this.showError(await this.cleanupStagingAfterError(error, stagingPath));
    }
  }
  async installSkills(records) {
    try {
      const targetDir = await pickNativeFolder();
      if (!targetDir) return;
      const summary = await new SkillExportService(this.registry).installSkills(records, targetDir, {
        vaultPath: this.getVaultBasePath(),
        method: this.data.settings.installMethod,
        conflictBehavior: this.data.settings.defaultSymlinkConflictBehavior === "overwrite" ? "replace-symlinks" : "skip"
      });
      await this.saveSkillHubData();
      new InstallResultModal(this.app, summary).open();
      this.refreshSkillHub();
    } catch (error) {
      this.showError(error);
    }
  }
  async deleteSkill(record) {
    await removeVaultRelativePath(this.getVaultBasePath(), record.vaultPath);
    this.registry.deleteSkill(record.id);
    this.registry.recordEvent(createSkillEvent("skill_deleted", record.id, { vaultPath: record.vaultPath }));
    await this.saveSkillHubData();
    this.refreshSkillHub();
  }
  async deleteSkills(records) {
    const vaultPath = this.getVaultBasePath();
    await Promise.all(records.map((record) => resolveVaultRelativePath(vaultPath, record.vaultPath, { verifyFilesystem: true })));
    for (const record of records) {
      await removeVaultRelativePath(vaultPath, record.vaultPath);
      this.registry.deleteSkill(record.id);
      this.registry.recordEvent(createSkillEvent("skill_deleted", record.id, { vaultPath: record.vaultPath }));
    }
    await this.saveSkillHubData();
    this.refreshSkillHub();
  }
  async openImportSelection(discovered, source, importMethod, stagingPath) {
    if (discovered.length === 0) {
      await this.cleanupStagingPath(stagingPath);
      new import_obsidian4.Notice("No valid skills were found.");
      return;
    }
    new SkillSelectionModal(this.app, discovered.map((skill) => ({ id: skill.folderName, label: skill.metadata.name, value: skill })), async (selected) => {
      try {
        if (selected.length === 0) {
          await this.cleanupStagingPath(stagingPath);
          return;
        }
        const result = await new SkillImportService(this.registry, this.data.settings).importDiscoveredSkills(selected, {
          vaultPath: this.getVaultBasePath(),
          source,
          importMethod,
          stagingPath,
          persist: () => this.saveSkillHubData()
        });
        this.refreshSkillHub();
        new import_obsidian4.Notice(`Imported ${result.imported.length} skill${result.imported.length === 1 ? "" : "s"}.`);
      } catch (error) {
        this.showError(await this.cleanupStagingAfterError(error, stagingPath));
      }
    }, () => this.cleanupStagingPath(stagingPath)).open();
  }
  async cleanupStagingPath(stagingPath) {
    if (stagingPath) await (0, import_promises7.rm)(stagingPath, { force: true, recursive: true });
  }
  async cleanupStagingAfterError(error, stagingPath) {
    try {
      await this.cleanupStagingPath(stagingPath);
      return error;
    } catch (cleanupError) {
      return combineErrors(error, cleanupError, "staging cleanup failed");
    }
  }
  getVaultBasePath() {
    if (!(this.app.vault.adapter instanceof import_obsidian4.FileSystemAdapter)) throw new Error("Skill Hub requires a local vault.");
    return this.app.vault.adapter.getBasePath();
  }
  refreshSkillHub() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SKILL_HUB)) {
      leaf.view.render();
    }
  }
  showError(error) {
    new import_obsidian4.Notice(error instanceof Error ? error.message : String(error));
  }
  async importFromDirectory(path, source, importMethod) {
    try {
      const discovered = await discoverSkills(path);
      if (discovered.missingSkillsFolder) throw new Error(formatMissingSkillsFolderMessage());
      this.showDiscoveryWarnings(discovered.warnings);
      await this.openImportSelection(discovered.skills, source, importMethod);
    } catch (error) {
      this.showError(error);
    }
  }
  openNpxFallback(command, reason) {
    new ManualNpxFallbackModal(this.app, command, reason, async () => {
      try {
        const path = await pickNativeFolder();
        if (path) await this.importFromDirectory(path, { type: "npx", command }, "npx");
      } catch (error) {
        this.showError(error);
      }
    }).open();
  }
  showDiscoveryWarnings(warnings) {
    if (warnings.length > 0) new import_obsidian4.Notice(`Skipped ${warnings.length} unreadable SKILL.md file${warnings.length === 1 ? "" : "s"}.`);
  }
  async githubRefExists(owner, repo, ref, requestBudget) {
    for (const kind of ["heads", "tags"]) {
      try {
        requestBudget.consume(`refs/${kind}/${ref}`);
        const response = await (0, import_obsidian4.requestUrl)({
          url: `https://api.github.com/repos/${owner}/${repo}/git/ref/${kind}/${ref.split("/").map(encodeURIComponent).join("/")}`,
          throw: false
        });
        if (response.status === 200) return true;
        if (response.status !== 404) throw new Error(`GitHub ref request failed with status ${response.status}`);
      } catch (error) {
        if (!String(error).includes("404")) throw error;
      }
    }
    return false;
  }
};
