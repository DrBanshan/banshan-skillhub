import { addIcon, FileSystemAdapter, Notice, Plugin, requestUrl } from "obsidian";
import { lstat, mkdtemp, rm } from "fs/promises";
import { isAbsolute, join, relative } from "path";
import { CliError, rankSkillMatches, registerSkillHubCli, SKILL_ROW_COLUMNS, skillMatches, skillRecordRows, type CliArgs, type CliCommandDefinition, type CliOutcome, type CliRow, type SkillHubCliBridge } from "./cli";
import { combineErrors } from "./errors";
import { SkillExportService, type InstallOptions, type InstallSummary } from "./exportService";
import { createSkillEvent } from "./events";
import { pickNativeFolder } from "./folderPicker";
import { GitHubRequestBudget, GitHubSkillDownloader, resolveGitHubSkillUrl, writeBoundedGitHubResponse, type GitHubContentEntry } from "./githubImport";
import { SkillImportService, type ImportResult } from "./importService";
import { isNpxAvailable, runNpxSkillsAdd, validateNpxSkillsCommand } from "./localImport";
import { collectTagColors, createEmptySkillHubData, SkillRegistry } from "./registry";
import { SkillHubSettingTab } from "./settings";
import { DEFAULT_SETTINGS } from "./settingsDefaults";
import { discoverSkills, formatMissingSkillsFolderMessage, type DiscoveredSkill } from "./skillDiscovery";
import type { SkillHubData, SkillRecord, SkillSource } from "./types";
import { InstallResultModal, ManualNpxFallbackModal, SkillSelectionModal } from "./ui/modals";
import { SkillHubView, SKILL_HUB_ICON_ID, VIEW_TYPE_SKILL_HUB } from "./ui/SkillHubView";
import { removeVaultRelativePath, resolveVaultRelativePath } from "./vaultPaths";

const SKILL_HUB_ICON_SVG = `
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

export default class SkillHubPlugin extends Plugin {
  data: SkillHubData = createEmptySkillHubData();
  registry = new SkillRegistry(this.data);

  async onload(): Promise<void> {
    const saved = (await this.loadData()) as (Partial<SkillHubData> & { bundleNames?: Record<string, string> }) | null;
    const legacyBundleMetadata = Object.fromEntries(
      Object.entries(saved?.bundleNames ?? {}).map(([id, name]) => [id, { name }])
    );
    this.data = {
      settings: { ...DEFAULT_SETTINGS, ...saved?.settings },
      skills: saved?.skills ?? {},
      collections: saved?.collections ?? {},
      bundleMetadata: { ...legacyBundleMetadata, ...saved?.bundleMetadata },
      pinnedFolderIds: saved?.pinnedFolderIds ?? [],
      folderOrder: saved?.folderOrder ?? [],
      tagColors: collectTagColors({ skills: saved?.skills ?? {}, tagColors: saved?.tagColors }),
      events: saved?.events ?? []
    };
    this.registry = new SkillRegistry(this.data);

    addIcon(SKILL_HUB_ICON_ID, SKILL_HUB_ICON_SVG);
    this.addRibbonIcon(SKILL_HUB_ICON_ID, "Open Skill Hub", () => {
      void this.openSkillHub();
    });
    this.addCommand({ id: "open-skill-hub", name: "Open Skill Hub", callback: () => void this.openSkillHub() });
    this.addCommand({ id: "import-skills-from-github", name: "Import skills from GitHub", callback: () => void this.openGitHubImport() });
    this.addCommand({ id: "scan-local-skill-directory", name: "Scan local skill directory", callback: () => void this.openLocalScan() });
    this.addCommand({ id: "install-selected-skills", name: "Install selected skills", callback: () => void this.installSelectedSkills() });
    this.addSettingTab(new SkillHubSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_SKILL_HUB, (leaf) => new SkillHubView(leaf, this));
    this.registerCommandLine();
  }

  async saveSkillHubData(): Promise<void> {
    await this.saveData(this.registry.data);
  }

  async openSkillHub(): Promise<SkillHubView> {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SKILL_HUB)[0] ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_SKILL_HUB, active: true });
    void this.app.workspace.revealLeaf(leaf);
    return leaf.view as SkillHubView;
  }

  async openGitHubImport(): Promise<void> {
    (await this.openSkillHub()).openGitHubImport();
  }

  async openLocalScan(): Promise<void> {
    (await this.openSkillHub()).openLocalScan();
  }

  async installSelectedSkills(): Promise<void> {
    (await this.openSkillHub()).installSelectedSkills();
  }

  async importFromGitHub(url: string): Promise<void> {
    try {
      const requestBudget = new GitHubRequestBudget();
      const location = await resolveGitHubSkillUrl(
        url,
        (owner, repo, ref) => this.githubRefExists(owner, repo, ref, requestBudget),
        { requestBudget }
      );
      const downloader = new GitHubSkillDownloader({
        fetchJson: async (path) => {
          const response = await requestUrl({ url: `https://api.github.com${path}`, throw: false });
          return { status: response.status, data: response.json as GitHubContentEntry[] };
        },
        downloadFile: async (downloadUrl, destination, maxBytes) => {
          const response = await requestUrl({ url: downloadUrl, throw: false });
          return writeBoundedGitHubResponse(response, destination, maxBytes);
        }
      }, {}, requestBudget);
      const candidates = await downloader.listSkillCandidates(location);
      new SkillSelectionModal(this.app, candidates.map((candidate) => ({
        id: `${candidate.kind}:${candidate.name}`,
        label: candidate.label,
        value: candidate
      })), async (selected) => {
        let stagingPath: string | undefined;
        try {
          if (selected.length === 0) return;
          stagingPath = await mkdtemp(join(this.getVaultBasePath(), ".skillhub-github-import-"));
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

  async importFromLocalDirectory(path: string): Promise<void> {
    await this.importFromDirectory(path, { type: "local", path }, "local");
  }

  async pickAndImportLocalDirectory(): Promise<void> {
    try {
      const path = await pickNativeFolder();
      if (path) await this.importFromLocalDirectory(path);
    } catch (error) {
      this.showError(error);
    }
  }

  async importFromNpx(command: string): Promise<void> {
    if (!validateNpxSkillsCommand(command)) {
      new Notice("Use an npx skills add command.");
      return;
    }
    if (!this.data.settings.npxExecutionEnabled) {
      this.openNpxFallback(command, "Automatic npx execution is disabled.");
      return;
    }
    if (!(await isNpxAvailable())) {
      this.openNpxFallback(command, "npx is not available.");
      return;
    }

    let stagingPath: string | undefined;
    try {
      stagingPath = await runNpxSkillsAdd(command, this.getVaultBasePath());
      const discovered = await discoverSkills(stagingPath);
      this.showDiscoveryWarnings(discovered.warnings);
      await this.openImportSelection(discovered.skills, { type: "npx", command }, "npx", stagingPath);
    } catch (error) {
      this.showError(await this.cleanupStagingAfterError(error, stagingPath));
    }
  }

  async installSkills(records: SkillRecord[]): Promise<void> {
    try {
      const targetDir = await pickNativeFolder();
      if (!targetDir) return;
      this.rememberInstallTarget(targetDir);
      const summary = await this.installSkillsTo(records, targetDir);
      new InstallResultModal(this.app, summary).open();
      this.refreshSkillHub();
    } catch (error) {
      this.showError(error);
    }
  }

  defaultInstallTarget(): string | undefined {
    return this.knownInstallTargets()[0];
  }

  knownInstallTargets(): string[] {
    const stored = this.data.settings.knownInstallTargets;
    return Array.isArray(stored) ? stored.filter((entry) => typeof entry === "string" && entry.length > 0) : [];
  }

  private rememberInstallTarget(targetDir: string): void {
    const known = this.knownInstallTargets().filter((entry) => entry !== targetDir);
    this.data.settings.knownInstallTargets = [targetDir, ...known].slice(0, 8);
  }

  async installSkillsTo(
    records: SkillRecord[],
    targetDir: string,
    overrides: Partial<InstallOptions> = {}
  ): Promise<InstallSummary> {
    const summary = await new SkillExportService(this.registry).installSkills(records, targetDir, {
      vaultPath: overrides.vaultPath ?? this.getVaultBasePath(),
      method: overrides.method ?? this.data.settings.installMethod,
      conflictBehavior: overrides.conflictBehavior
        ?? (this.data.settings.defaultSymlinkConflictBehavior === "overwrite" ? "replace-symlinks" : "skip")
    });
    await this.saveSkillHubData();
    return summary;
  }

  async deleteSkill(record: SkillRecord): Promise<void> {
    await removeVaultRelativePath(this.getVaultBasePath(), record.vaultPath);
    this.registry.deleteSkill(record.id);
    this.registry.recordEvent(createSkillEvent("skill_deleted", record.id, { vaultPath: record.vaultPath }));
    await this.saveSkillHubData();
    this.refreshSkillHub();
  }

  async deleteSkills(records: SkillRecord[]): Promise<void> {
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

  async importDirectoryHeadless(
    path: string,
    source: SkillSource,
    importMethod: SkillRecord["importMethod"],
    selection: "*" | string[] = "*",
    stagingPath?: string
  ): Promise<ImportResult> {
    const discovered = await discoverSkills(path);
    if (discovered.missingSkillsFolder) throw new Error(formatMissingSkillsFolderMessage());
    const chosen = selection === "*"
      ? discovered.skills
      : discovered.skills.filter((skill) => selection.includes(skill.folderName));
    return this.importDiscoveredHeadless(chosen, source, importMethod, stagingPath);
  }

  async importDiscoveredHeadless(
    selected: DiscoveredSkill[],
    source: SkillSource,
    importMethod: SkillRecord["importMethod"],
    stagingPath?: string
  ): Promise<ImportResult> {
    if (selected.length === 0) {
      await this.cleanupStagingPath(stagingPath);
      return { imported: [] };
    }
    const result = await new SkillImportService(this.registry, this.data.settings).importDiscoveredSkills(selected, {
      vaultPath: this.getVaultBasePath(),
      source,
      importMethod,
      stagingPath,
      persist: () => this.saveSkillHubData()
    });
    this.refreshSkillHub();
    return result;
  }

  private async openImportSelection(
    discovered: DiscoveredSkill[],
    source: SkillSource,
    importMethod: SkillRecord["importMethod"],
    stagingPath?: string
  ): Promise<void> {
    if (discovered.length === 0) {
      await this.cleanupStagingPath(stagingPath);
      new Notice("No valid skills were found.");
      return;
    }
    new SkillSelectionModal(this.app, discovered.map((skill) => ({ id: skill.folderName, label: skill.metadata.name, value: skill })), async (selected) => {
      try {
        if (selected.length === 0) {
          await this.cleanupStagingPath(stagingPath);
          return;
        }
        const result = await this.importDiscoveredHeadless(selected, source, importMethod, stagingPath);
        new Notice(`Imported ${result.imported.length} skill${result.imported.length === 1 ? "" : "s"}.`);
      } catch (error) {
        this.showError(await this.cleanupStagingAfterError(error, stagingPath));
      }
    }, () => this.cleanupStagingPath(stagingPath)).open();
  }

  private async cleanupStagingPath(stagingPath?: string): Promise<void> {
    if (stagingPath) await rm(stagingPath, { force: true, recursive: true });
  }

  private async cleanupStagingAfterError(error: unknown, stagingPath?: string): Promise<unknown> {
    try {
      await this.cleanupStagingPath(stagingPath);
      return error;
    } catch (cleanupError) {
      return combineErrors(error, cleanupError, "staging cleanup failed");
    }
  }

  /**
   * Registers the command line surface.
   * Registration is unconditional so the commands stay discoverable and the gate can report itself:
   * the command layer rejects capability calls until the cliEnabled setting is on, and the
   * register-once guard keeps hot reloads from tripping the duplicate command id check.
   */
  private registerCommandLine(): void {
    const bridge: SkillHubCliBridge = {
      cliEnabled: () => this.data.settings.cliEnabled === true,
      vaultBasePath: () => this.getVaultBasePath(),
      rememberedInstallTargets: () => this.knownInstallTargets(),
      execute: (action: string, args: CliArgs) => this.runCliCommand(action, args)
    };
    registerSkillHubCli(this, bridge, this.cliCommandDefinitions());
  }

  private cliCommandDefinitions(): CliCommandDefinition[] {
    return [
      { action: "", description: "Show Skill Hub command line usage" },
      {
        action: "info",
        description: "Report the Skill Hub command line environment, gate states and an optional target",
        readonlyGate: true,
        flags: { target: { value: "<path>", description: "Also report the state of this install target" } }
      },
      {
        action: "list",
        description: "List the skills in the registry",
        flags: {
          filter: { value: "<text>", description: "Match against nickname, original name, tags or description" },
          source: { value: "<local|github|npx>", description: "Only report skills imported from this source" }
        }
      },
      {
        action: "show",
        description: "Report one skill in detail",
        flags: { skill: { value: "<name>", description: "Skill id, nickname or folder name", required: true } }
      },
      {
        action: "search",
        description: "Search skill metadata",
        flags: {
          query: { value: "<text>", description: "Text to look for", required: true },
          source: { value: "<local|github|npx>", description: "Only report skills imported from this source" }
        }
      },
      {
        action: "scan",
        description: "Discover the skills in a directory without writing anything",
        flags: { path: { value: "<path>", description: "Directory to scan", required: true } }
      }
    ];
  }

  private async runCliCommand(action: string, args: CliArgs): Promise<CliOutcome> {
    switch (action) {
      case "info": return this.cliInfo(args);
      case "list": return this.cliList(args);
      case "show": return this.cliShow(args);
      case "search": return this.cliSearch(args);
      case "scan": return this.cliScan(args);
      default: return { action, ok: false, message: `No Skill Hub command line action is registered for ${action} yet.` };
    }
  }

  private async cliInfo(args: CliArgs): Promise<CliOutcome> {
    let vaultPath = "unavailable";
    try {
      vaultPath = this.getVaultBasePath();
    } catch (error) {
      vaultPath = `unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
    const settings = this.data.settings;
    const entries: Array<{ property: string; value: string }> = [
      { property: "plugin", value: `${this.manifest.id} ${this.manifest.version}` },
      { property: "minAppVersion", value: this.manifest.minAppVersion },
      { property: "cliEnabled", value: String(settings.cliEnabled === true) },
      { property: "npxExecutionEnabled", value: String(settings.npxExecutionEnabled) },
      { property: "installMethod", value: settings.installMethod },
      { property: "symlinkConflictBehavior", value: settings.defaultSymlinkConflictBehavior },
      { property: "skillFolder", value: settings.skillFolder },
      { property: "vaultPath", value: vaultPath },
      { property: "skillCount", value: String(Object.keys(this.registry.data.skills).length) },
      { property: "rememberedTargets", value: this.knownInstallTargets().join(", ") || "(none)" }
    ];
    const requested = (args.value("target") ?? "").trim();
    if (requested.length > 0) {
      const state = await this.describeCliTarget(requested, vaultPath);
      entries.push({ property: "target", value: requested }, { property: "targetState", value: state.kind }, { property: "targetInsideVault", value: String(state.insideVault) });
    }
    return { action: "info", ok: true, columns: ["property", "value"], rows: entries };
  }

  private async describeCliTarget(target: string, vaultPath: string): Promise<{ kind: string; insideVault: boolean }> {
    const insideVault = vaultPath === "unavailable" ? false : this.isInsideDirectory(vaultPath, target);
    try {
      const stats = await lstat(target);
      if (stats.isDirectory()) return { kind: "directory", insideVault };
      if (stats.isFile()) return { kind: "file", insideVault };
      return { kind: "other", insideVault };
    } catch (error) {
      const code = (error as { code?: string })?.code;
      return { kind: code === "ENOENT" ? "missing" : `unavailable: ${code ?? (error instanceof Error ? error.message : String(error))}`, insideVault };
    }
  }

  private isInsideDirectory(parent: string, child: string): boolean {
    const relation = relative(parent, child);
    return relation.length > 0 && !relation.startsWith("..") && !isAbsolute(relation);
  }

  private cliRecords(): SkillRecord[] {
    return Object.values(this.registry.data.skills).sort((left, right) => left.nickname.localeCompare(right.nickname));
  }

  private cliList(args: CliArgs): CliOutcome {
    const filter = (args.value("filter") ?? "").trim().toLowerCase();
    const source = (args.value("source") ?? "").trim().toLowerCase();
    const records = this.cliRecords().filter((record) => skillMatches(record, filter, source));
    return {
      action: "list",
      ok: true,
      message: `${records.length} skill${records.length === 1 ? "" : "s"}`,
      columns: SKILL_ROW_COLUMNS,
      rows: skillRecordRows(records)
    };
  }

  private cliFindRecord(selector: string): SkillRecord | undefined {
    const wanted = selector.trim().toLowerCase();
    return this.cliRecords().find((record) => record.id.toLowerCase() === wanted
      || record.nickname.toLowerCase() === wanted
      || record.folderName.toLowerCase() === wanted);
  }

  private cliShow(args: CliArgs): CliOutcome {
    const selector = args.required("skill");
    const record = this.cliFindRecord(selector);
    if (!record) {
      const available = this.cliRecords().map((entry) => entry.nickname).slice(0, 8).join(", ");
      throw new CliError(`No skill named ${selector}. ${available.length > 0 ? `Known skills: ${available}${this.cliRecords().length > 8 ? ", ..." : ""}` : "The registry is empty."}`);
    }
    const entries: CliRow[] = [
      { property: "id", value: record.id },
      { property: "nickname", value: record.nickname },
      { property: "originalName", value: record.originalName },
      { property: "folderName", value: record.folderName },
      { property: "vaultPath", value: record.vaultPath },
      { property: "description", value: record.description },
      { property: "tags", value: record.tags.join(", ") },
      { property: "collections", value: record.collectionIds.map((id) => this.registry.data.collections[id]?.name ?? id).join(", ") },
      { property: "source", value: record.source.url ?? record.source.path ?? record.source.command ?? record.source.type },
      { property: "importMethod", value: record.importMethod },
      { property: "installCount", value: String(record.installCount) },
      { property: "lastInstalledAt", value: record.lastInstalledAt ?? "never" },
      { property: "importedAt", value: record.importedAt },
      { property: "updatedAt", value: record.updatedAt },
      { property: "warnings", value: record.warnings.join("; ") || "(none)" }
    ];
    return { action: "show", ok: true, message: record.nickname, columns: ["property", "value"], rows: entries, data: record };
  }

  private cliSearch(args: CliArgs): CliOutcome {
    const query = args.required("query").trim().toLowerCase();
    const source = (args.value("source") ?? "").trim().toLowerCase();
    const matches = this.cliRecords().filter((record) => skillMatches(record, query, source));
    const ranked = rankSkillMatches(matches, query);
    return {
      action: "search",
      ok: true,
      message: `${ranked.length} match${ranked.length === 1 ? "" : "es"} for ${query}`,
      columns: SKILL_ROW_COLUMNS,
      rows: skillRecordRows(ranked)
    };
  }

  private async cliScan(args: CliArgs): Promise<CliOutcome> {
    const path = args.required("path");
    const discovered = await discoverSkills(path);
    if (discovered.missingSkillsFolder) {
      return { action: "scan", ok: false, message: formatMissingSkillsFolderMessage(), data: { path, missingSkillsFolder: true } };
    }
    return {
      action: "scan",
      ok: true,
      message: `${discovered.skills.length} skill${discovered.skills.length === 1 ? "" : "s"} found in ${path}`,
      columns: ["folder", "name", "description", "warnings"],
      rows: discovered.skills.map((skill) => ({
        folder: skill.folderName,
        name: skill.metadata.name,
        description: skill.metadata.description,
        warnings: skill.warnings.join("; ")
      })),
      data: {
        path,
        missingSkillsFolder: false,
        unreadable: discovered.warnings.map((warning) => ({ path: warning.path, message: warning.message }))
      }
    };
  }

  private getVaultBasePath(): string {
    if (!(this.app.vault.adapter instanceof FileSystemAdapter)) throw new Error("Skill Hub requires a local vault.");
    return this.app.vault.adapter.getBasePath();
  }

  refreshSkillHub(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SKILL_HUB)) {
      (leaf.view as SkillHubView).render();
    }
  }

  private showError(error: unknown): void {
    new Notice(error instanceof Error ? error.message : String(error));
  }

  private async importFromDirectory(
    path: string,
    source: SkillSource,
    importMethod: SkillRecord["importMethod"]
  ): Promise<void> {
    try {
      const discovered = await discoverSkills(path);
      if (discovered.missingSkillsFolder) throw new Error(formatMissingSkillsFolderMessage());
      this.showDiscoveryWarnings(discovered.warnings);
      await this.openImportSelection(discovered.skills, source, importMethod);
    } catch (error) {
      this.showError(error);
    }
  }

  private openNpxFallback(command: string, reason: string): void {
    new ManualNpxFallbackModal(this.app, command, reason, async () => {
      try {
        const path = await pickNativeFolder();
        if (path) await this.importFromDirectory(path, { type: "npx", command }, "npx");
      } catch (error) {
        this.showError(error);
      }
    }).open();
  }

  private showDiscoveryWarnings(warnings: Array<{ path: string; message: string }>): void {
    if (warnings.length > 0) new Notice(`Skipped ${warnings.length} unreadable SKILL.md file${warnings.length === 1 ? "" : "s"}.`);
  }

  private async githubRefExists(owner: string, repo: string, ref: string, requestBudget: GitHubRequestBudget): Promise<boolean> {
    for (const kind of ["heads", "tags"]) {
      try {
        requestBudget.consume(`refs/${kind}/${ref}`);
        const response = await requestUrl({
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
}
