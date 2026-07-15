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
var import_path3 = require("path");
function extractNativeFolderPath(files, webUtils = getElectronWebUtils()) {
  if (files.length === 0) {
    throw new Error("Native folder selection cannot select an empty directory because the folder picker did not provide a file. Select a non-empty directory.");
  }
  if (!webUtils) {
    throw new Error("Native folder selection is unavailable because Electron webUtils.getPathForFile is unavailable.");
  }
  let selectedFile;
  let selectedPath;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const path = webUtils.getPathForFile(file);
    if (path && (0, import_path3.isAbsolute)(path)) {
      selectedFile = file;
      selectedPath = path;
      break;
    }
  }
  if (!selectedFile || !selectedPath) {
    throw new Error("Native folder selection could not provide an absolute folder path through Electron webUtils.getPathForFile.");
  }
  const relativeSegments = selectedFile.webkitRelativePath.split("/").filter(Boolean);
  if (relativeSegments.length < 2) return (0, import_path3.dirname)(selectedPath);
  return (0, import_path3.resolve)(selectedPath, ...Array(relativeSegments.length - 1).fill(".."));
}
function getElectronWebUtils() {
  try {
    return require("electron").webUtils;
  } catch (e) {
    return void 0;
  }
}
async function pickNativeFolder() {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.hidden = true;
  input.setAttribute("webkitdirectory", "");
  return new Promise((resolveSelection, rejectSelection) => {
    let settled = false;
    const finish = (files) => {
      if (settled) return;
      settled = true;
      input.remove();
      try {
        resolveSelection(files ? extractNativeFolderPath(files) : void 0);
      } catch (error) {
        rejectSelection(error);
      }
    };
    input.addEventListener("change", () => finish(input.files), { once: true });
    input.addEventListener("cancel", () => finish(), { once: true });
    try {
      document.body.appendChild(input);
      input.click();
    } catch (error) {
      settled = true;
      input.remove();
      rejectSelection(error);
    }
  });
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
  constructor(skillsPath) {
    super(`GitHub skills folder not found: ${skillsPath}`);
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
  if (remainder.length === 0) return { owner, repo, skillsPath: "skills" };
  if (remainder[0] !== "tree" || remainder.length < 2) throw new InvalidGitHubUrlError(input);
  const treeSegments = remainder.slice(1);
  const ref = resolveRef(treeSegments, options.knownRefs);
  const pathSegments = treeSegments.slice(ref.split("/").length);
  const skillsPath = pathSegments.at(-1) === "skills" ? pathSegments.join("/") : [...pathSegments, "skills"].join("/");
  return { owner, repo, ref, skillsPath };
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
  async downloadSkillFolder(location, folderName, destination) {
    if (!folderName || folderName.includes("/") || folderName.includes("\\")) throw new InvalidGitHubUrlError(folderName);
    const selectedPath = `${location.skillsPath}/${folderName}`;
    await this.downloadContents(location, selectedPath, destination, selectedPath, 0);
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
      if (!entry.download_url) throw new GitHubImportLimitError(entry.path);
      if (this.files >= this.limits.maxFiles) throw new GitHubImportLimitError(entry.path);
      if (typeof entry.size === "number" && this.bytes + entry.size > this.limits.maxBytes) {
        throw new GitHubImportLimitError(entry.path);
      }
      this.consumeRequest(entry.path);
      this.files += 1;
      const stagedPath = (0, import_path5.join)(destination, "skills", entry.path.slice(`${location.skillsPath}/`.length));
      await (0, import_promises4.mkdir)((0, import_path5.dirname)(stagedPath), { recursive: true });
      const downloadedBytes = await this.dependencies.downloadFile(entry.download_url, stagedPath, this.limits.maxBytes - this.bytes);
      this.bytes += downloadedBytes;
      if (!Number.isFinite(downloadedBytes) || downloadedBytes < 0 || this.bytes > this.limits.maxBytes) {
        throw new GitHubImportLimitError(entry.path);
      }
    }
  }
  async listContents(location, path) {
    this.consumeRequest(path);
    const query = location.ref ? `?ref=${encodeURIComponent(location.ref)}` : "";
    const response = await this.dependencies.fetchJson(`/repos/${location.owner}/${location.repo}/contents/${path}${query}`);
    if (response.status === 404) throw new MissingSkillsFolderError(path);
    if (response.status !== 200) throw new Error(`GitHub contents request failed with status ${response.status}`);
    if (response.truncated || response.data.length >= GITHUB_CONTENTS_LISTING_LIMIT) throw new GitHubImportLimitError(path);
    return response.data;
  }
  consumeRequest(path) {
    this.requestBudget.consume(path);
  }
};
function isWithinPath(path, root) {
  const pathSegments = path.split("/");
  const rootSegments = root.split("/");
  if (pathSegments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))) return false;
  return pathSegments.length > rootSegments.length && rootSegments.every((segment, index) => pathSegments[index] === segment);
}

// src/importService.ts
var import_promises5 = require("fs/promises");
var import_path6 = require("path");
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
      throw operationError;
    } finally {
      if (options.stagingPath) {
        try {
          await (0, import_promises5.rm)(options.stagingPath, { force: true, recursive: true });
        } catch (cleanupError) {
          if (operationError) throw combineErrors(operationError, cleanupError, "staging cleanup failed");
          throw combineErrors("Import completed", cleanupError, "staging cleanup failed");
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
  return args;
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
  defaultSort: "nickname"
};

// src/registry.ts
function createEmptySkillHubData() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    skills: {},
    collections: {},
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
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Skill Hub settings" });
    const skillFolderSetting = new import_obsidian.Setting(containerEl).setName("Skill folder").setDesc("Vault folder used to store imported skills.").addText((text) => text.setValue(this.skillHubPlugin.data.settings.skillFolder).onChange(async (value) => {
      const nextValue = value.trim() || DEFAULT_SETTINGS.skillFolder;
      try {
        resolveVaultRelativePath("/vault", nextValue);
        skillFolderSetting.setDesc("Vault folder used to store imported skills.");
      } catch (error) {
        skillFolderSetting.setDesc(error instanceof Error ? error.message : String(error));
        return;
      }
      this.skillHubPlugin.data.settings.skillFolder = nextValue;
      await this.skillHubPlugin.saveSkillHubData();
    }));
    new import_obsidian.Setting(containerEl).setName("Install method").setDesc("How skills are installed into .agents/skills.").addDropdown((dropdown) => dropdown.addOption("symlink", "Symlink").addOption("copy", "Copy").setValue(this.skillHubPlugin.data.settings.installMethod).onChange(async (value) => {
      this.skillHubPlugin.data.settings.installMethod = value;
      await this.skillHubPlugin.saveSkillHubData();
    }));
    new import_obsidian.Setting(containerEl).setName("Default sort").setDesc("Initial ordering in the Skill Hub view.").addDropdown((dropdown) => dropdown.addOption("nickname", "Nickname").addOption("originalName", "Original name").addOption("updatedAt", "Recently updated").setValue(this.skillHubPlugin.data.settings.defaultSort).onChange(async (value) => {
      this.skillHubPlugin.data.settings.defaultSort = value;
      await this.skillHubPlugin.saveSkillHubData();
      this.skillHubPlugin.refreshSkillHub();
    }));
    new import_obsidian.Setting(containerEl).setName("Enable npx execution").setDesc("Allow Skill Hub to run npx skills add commands.").addToggle((toggle) => toggle.setValue(this.skillHubPlugin.data.settings.npxExecutionEnabled).onChange(async (value) => {
      this.skillHubPlugin.data.settings.npxExecutionEnabled = value;
      await this.skillHubPlugin.saveSkillHubData();
    }));
    new import_obsidian.Setting(containerEl).setName("Symlink conflict behavior").setDesc("Choose what happens when a destination is already a symlink.").addDropdown((dropdown) => dropdown.addOption("skip", "Skip").addOption("overwrite", "Overwrite symlinks").setValue(this.skillHubPlugin.data.settings.defaultSymlinkConflictBehavior).onChange(async (value) => {
      this.skillHubPlugin.data.settings.defaultSymlinkConflictBehavior = value;
      await this.skillHubPlugin.saveSkillHubData();
    }));
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
        tagButton.createEl("span", { text: tag, cls: "skillhub-tag-text" });
        tagButton.createEl("span", { text: "\xD7", cls: "skillhub-tag-delete-icon", attr: { "aria-hidden": "true" } });
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
    new import_obsidian2.Setting(this.contentEl).addButton((button) => button.setButtonText("Delete").setWarning().onClick(async () => {
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
    new import_obsidian2.Setting(this.contentEl).addButton((button) => button.setButtonText("Delete all").setWarning().onClick(async () => {
      await this.onConfirm(void 0);
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
    row.createEl("span", { text: value });
  }
};
var CollectionEditModal = class extends import_obsidian2.Modal {
  constructor(app, collection, onSubmit) {
    super(app);
    this.collection = collection;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    var _a, _b, _c, _d, _e, _f;
    this.setTitle(this.collection ? "Edit collection" : "New collection");
    let name = (_b = (_a = this.collection) == null ? void 0 : _a.name) != null ? _b : "";
    let description = (_d = (_c = this.collection) == null ? void 0 : _c.description) != null ? _d : "";
    let color = (_f = (_e = this.collection) == null ? void 0 : _e.color) != null ? _f : "#7f8c8d";
    new import_obsidian2.Setting(this.contentEl).setName("Name").addText((text) => text.setValue(name).onChange((value) => {
      name = value;
    }));
    new import_obsidian2.Setting(this.contentEl).setName("Description").addText((text) => text.setValue(description).onChange((value) => {
      description = value;
    }));
    new import_obsidian2.Setting(this.contentEl).setName("Color").addColorPicker((picker) => picker.setValue(color).onChange((value) => {
      color = value;
    }));
    new import_obsidian2.Setting(this.contentEl).addButton((button) => button.setButtonText("Save").setCta().onClick(async () => {
      if (!name.trim()) return;
      await this.onSubmit({ name: name.trim(), description: description.trim(), color });
      this.close();
    }));
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
      })).addButton((button) => button.setButtonText("Delete").setWarning().onClick(async () => {
        await this.actions.delete(collection);
        this.renderCollections();
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
var VIEW_TYPE_SKILL_HUB = "banshan-skillhub-view";
var SkillHubView = class extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.selectedSkillIds = /* @__PURE__ */ new Set();
    this.selectMode = false;
    this.filterQuery = "";
  }
  getViewType() {
    return VIEW_TYPE_SKILL_HUB;
  }
  getDisplayText() {
    return "Skill Hub";
  }
  async onOpen() {
    this.render();
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
    const selected = this.getSelectedSkills();
    if (selected.length === 0) {
      new import_obsidian3.Notice("Select at least one skill to install.");
      return;
    }
    void this.plugin.installSkills(selected);
  }
  render() {
    this.removeMissingSelections();
    this.contentEl.empty();
    this.contentEl.addClass("skillhub-root");
    const toolbar = this.contentEl.createDiv({ cls: "skillhub-toolbar" });
    this.addButton(toolbar, "GitHub import", () => this.openGitHubImport());
    this.addButton(toolbar, "Local scan", () => this.openLocalScan());
    this.addButton(toolbar, "npx import", () => this.openNpxImport());
    this.addButton(toolbar, "Collections", () => this.openCollectionManager());
    this.addButton(toolbar, this.selectMode ? "Done" : "Select", () => {
      this.selectMode = !this.selectMode;
      this.render();
    });
    this.addButton(toolbar, "Install", () => this.installSelectedSkills(), this.selectedSkillIds.size === 0);
    if (this.selectMode) {
      const bulkToolbar = this.contentEl.createDiv({ cls: "skillhub-toolbar skillhub-bulk-toolbar" });
      bulkToolbar.createEl("span", { cls: "skillhub-selection-count", text: `${this.selectedSkillIds.size} selected` });
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
    container.empty();
    const skills = this.getVisibleSkills();
    if (skills.length === 0) {
      container.createEl("p", {
        cls: "skillhub-empty",
        text: Object.keys(this.plugin.registry.data.skills).length === 0 ? "No skills installed yet." : "No skills match this filter."
      });
      return;
    }
    const grid = container.createDiv({ cls: "skillhub-grid" });
    for (const skill of skills) this.renderCard(grid, skill);
  }
  renderCard(grid, skill) {
    const selected = this.selectedSkillIds.has(skill.id);
    const card = grid.createDiv({ cls: `skillhub-card${selected ? " is-selected" : ""}` });
    if (skill.color) card.style.setProperty("--skillhub-card-color", skill.color);
    if (this.selectMode) {
      const checkbox = card.createEl("input", { type: "checkbox", cls: "skillhub-card-select" });
      checkbox.checked = selected;
      checkbox.addEventListener("change", () => {
        checkbox.checked ? this.selectedSkillIds.add(skill.id) : this.selectedSkillIds.delete(skill.id);
        this.render();
      });
    }
    card.createEl("strong", { text: `${skill.emoji ? `${skill.emoji} ` : ""}${skill.nickname}` });
    if (skill.originalName !== skill.nickname) card.createEl("span", { cls: "skillhub-original-name", text: skill.originalName });
    const chips = card.createDiv({ cls: "skillhub-chips" });
    for (const tag of skill.tags) this.renderTagChip(chips, skill, tag);
    if (skill.warnings.length > 0) {
      chips.createEl("span", { cls: "skillhub-chip is-warning", text: `${skill.warnings.length} warning${skill.warnings.length === 1 ? "" : "s"}` });
    }
    const actions = card.createDiv({ cls: "skillhub-card-actions" });
    this.addCardActionButton(actions, "Details", "details", () => this.openDetailModal(skill));
    this.addCardActionButton(actions, "Edit", "edit", () => this.openEditModal(skill));
    this.addCardActionButton(actions, "Delete", "delete", () => this.openDeleteModal(skill));
  }
  openDetailModal(skill) {
    new SkillDetailModal(this.app, skill, Object.values(this.plugin.registry.data.collections)).open();
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
    const chip = chips.createEl("span", { cls: "skillhub-chip", text: tag });
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
      delete: async (collection) => {
        this.plugin.registry.deleteCollection(collection.id);
        this.plugin.registry.recordEvent(createSkillEvent("collection_deleted", void 0, { collectionId: collection.id }));
        await this.plugin.saveSkillHubData();
        this.render();
      }
    }).open();
  }
  getSelectedSkills() {
    return Object.values(this.plugin.registry.data.skills).filter((skill) => this.selectedSkillIds.has(skill.id));
  }
  getVisibleSkills() {
    const query = this.filterQuery.trim().toLocaleLowerCase();
    const collections = this.plugin.registry.data.collections;
    return Object.values(this.plugin.registry.data.skills).filter((skill) => {
      if (!query) return true;
      const collectionNames = skill.collectionIds.map((id) => {
        var _a, _b;
        return (_b = (_a = collections[id]) == null ? void 0 : _a.name) != null ? _b : "";
      });
      return [skill.nickname, skill.originalName, skill.description, ...skill.tags, ...collectionNames].some((value) => value.toLocaleLowerCase().includes(query));
    }).sort((left, right) => {
      const sort = this.plugin.data.settings.defaultSort;
      if (sort === "updatedAt") return right.updatedAt.localeCompare(left.updatedAt);
      return left[sort].localeCompare(right[sort]);
    });
  }
  removeMissingSelections() {
    for (const id of this.selectedSkillIds) {
      if (!this.plugin.registry.data.skills[id]) this.selectedSkillIds.delete(id);
    }
  }
  addSortOption(select, value, label) {
    select.createEl("option", { text: label, value });
  }
  addButton(container, label, onClick, disabled = false) {
    const button = container.createEl("button", { text: label });
    button.disabled = disabled;
    button.addEventListener("click", onClick);
  }
  addCardActionButton(container, label, icon, onClick) {
    const actionClass = icon === "delete" ? "skillhub-delete-button" : icon === "edit" ? "skillhub-edit-button" : "skillhub-details-button";
    const button = container.createEl("button", {
      cls: `skillhub-card-action-button ${actionClass}`,
      attr: { "aria-label": label }
    });
    button.createSpan({ cls: "skillhub-action-tooltip", text: label });
    this.createSvgIcon(button, icon);
    button.addEventListener("click", onClick);
  }
  createSvgIcon(container, icon) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", icon === "delete" ? "skillhub-action-svg bin" : "skillhub-action-svg");
    container.appendChild(svg);
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
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    svg.appendChild(element);
  }
};

// src/main.ts
var SkillHubPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    this.data = createEmptySkillHubData();
    this.registry = new SkillRegistry(this.data);
  }
  async onload() {
    var _a, _b, _c, _d;
    const saved = await this.loadData();
    this.data = {
      settings: { ...DEFAULT_SETTINGS, ...saved == null ? void 0 : saved.settings },
      skills: (_a = saved == null ? void 0 : saved.skills) != null ? _a : {},
      collections: (_b = saved == null ? void 0 : saved.collections) != null ? _b : {},
      tagColors: collectTagColors({ skills: (_c = saved == null ? void 0 : saved.skills) != null ? _c : {}, tagColors: saved == null ? void 0 : saved.tagColors }),
      events: (_d = saved == null ? void 0 : saved.events) != null ? _d : []
    };
    this.registry = new SkillRegistry(this.data);
    this.addRibbonIcon("blocks", "Open Skill Hub", () => {
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
    this.app.workspace.revealLeaf(leaf);
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
      const folders = await downloader.listSkillFolders(location);
      if (folders.length === 0) throw new Error("No skill folders were found.");
      new SkillSelectionModal(this.app, folders.map((folder) => ({ id: folder, label: folder, value: folder })), async (selected) => {
        let stagingPath;
        try {
          if (selected.length === 0) return;
          stagingPath = await (0, import_promises7.mkdtemp)((0, import_path8.join)(this.getVaultBasePath(), ".skillhub-github-import-"));
          for (const folder of selected) await downloader.downloadSkillFolder(location, folder, stagingPath);
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
