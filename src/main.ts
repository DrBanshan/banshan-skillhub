import { addIcon, FileSystemAdapter, Notice, Plugin, requestUrl } from "obsidian";
import { lstat, mkdtemp, rm, unlink } from "fs/promises";
import { homedir } from "os";
import { isAbsolute, join, relative, resolve } from "path";
import { applyUninstallPlan, CliError, installTargetViolation, rankSkillMatches, registerSkillHubCli, SKILL_ROW_COLUMNS, skillMatches, skillRecordRows, splitSkillSelector, type UninstallCandidate, uninstallDecision, type CliArgs, type CliCommandDefinition, type CliOutcome, type CliRow, type SkillHubCliBridge } from "./cli";
import { combineErrors } from "./errors";
import { inspectDestination, SkillExportService, type InstallLinkMechanism, type InstallOptions, type InstallSummary, type SymlinkConflictBehavior } from "./exportService";
import { createSkillEvent } from "./events";
import { pickNativeFolder } from "./folderPicker";
import { GitHubRequestBudget, GitHubSkillDownloader, resolveGitHubSkillUrl, writeBoundedGitHubResponse, type GitHubContentEntry } from "./githubImport";
import { SkillImportService, type ImportResult } from "./importService";
import { isNpxAvailable, runNpxSkillsAdd, validateNpxSkillsCommand } from "./localImport";
import { collectTagColors, createEmptySkillHubData, SkillRegistry } from "./registry";
import { SkillHubSettingTab } from "./settings";
import { DEFAULT_SETTINGS } from "./settingsDefaults";
import { discoverSkills, formatMissingSkillsFolderMessage, type DiscoveredSkill } from "./skillDiscovery";
import type { InstallMethod, SkillHubData, SkillRecord, SkillSource } from "./types";
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

const CLI_INSTALL_COLUMNS = ["name", "decision", "destination", "mechanism", "reason"];

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
      },
      {
        action: "install",
        description: "Install skills into an agent skill directory",
        mutating: true,
        flags: {
          skill: { value: "<name|id|all>", description: "Comma separated skill names, or all" },
          collection: { value: "<name|id>", description: "Restrict the selection to one collection" },
          target: { value: "<path>", description: "Directory receiving .agents/skills; defaults to the remembered target" },
          method: { value: "<copy|symlink|junction>", description: "Link or copy mechanism; defaults to the install method setting" },
          conflict: { value: "<skip|replace-symlinks>", description: "What to do with an existing link; defaults to the conflict setting" }
        }
      },
      {
        action: "link",
        description: "Link one skill into an agent skill directory",
        mutating: true,
        flags: {
          skill: { value: "<name|id>", description: "Skill to link", required: true },
          target: { value: "<path>", description: "Directory receiving .agents/skills; defaults to the remembered target" },
          method: { value: "<symlink|junction>", description: "Link kind; a refused symlink falls back to a junction" },
          force: { description: "Replace an existing link that Skill Hub made here" }
        }
      },
      {
        action: "uninstall",
        description: "Remove Skill Hub installs from a target directory, only where the install record proves ownership",
        destructive: true,
        flags: {
          target: { value: "<path>", description: "Directory the skills were installed into; defaults to the remembered target" },
          skill: { value: "<name|id|all>", description: "Comma separated skill names, or all; defaults to every install recorded for the target" }
        }
      },
      {
        action: "import",
        description: "Import skills discovered in a local directory",
        mutating: true,
        flags: {
          path: { value: "<path>", description: "Directory holding a skills folder", required: true },
          skill: { value: "<folder|all>", description: "Comma separated folder names, or all; defaults to all discovered skills" },
          method: { value: "<copy|symlink>", description: "How imported skills are stored; defaults to copy" },
          staging: { value: "<path>", description: "Scratch directory, which must sit outside the vault" }
        }
      },
      {
        action: "refresh",
        description: "Reopen every open Skill Hub view"
      },
      {
        action: "probe",
        description: "Report the parameters the plugin actually received, for diagnosing how a command line reaches it"
      },
      {
        action: "order",
        description: "Read or set the curated skill ordering used by the custom sort",
        destructive: true,
        flags: {
          list: { value: "<name|id,...>", description: "Proposed order; omit to read the current one" }
        }
      },
      {
        action: "settings",
        description: "Read or set a single Skill Hub setting",
        destructive: true,
        flags: {
          key: { value: "<name>", description: "Setting name; omit to list every reported setting" },
          value: { value: "<value>", description: "New value; required to change a setting" }
        }
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
      case "install": return this.cliInstall(args);
      case "link": return this.cliLink(args);
      case "uninstall": return this.cliUninstall(args);
      case "import": return this.cliImport(args);
      case "refresh": return this.cliRefresh(args);
      case "probe": return this.cliProbe(args);
      case "order": return this.cliOrder(args);
      case "settings": return this.cliSettings(args);
      default: return { action, ok: false, message: `No Skill Hub command line action is registered for ${action} yet.` };
    }
  }

  private async cliImport(args: CliArgs): Promise<CliOutcome> {
    const path = args.required("path");
    const sourceKind = (args.value("source") ?? "local").trim().toLowerCase();
    if (sourceKind !== "local") {
      throw new CliError(`Command line imports cover local directories only, not ${sourceKind}. Use the GitHub import or the npx flow inside Skill Hub for the other sources.`);
    }
    const method = (args.value("method") ?? "copy").trim().toLowerCase();
    if (method !== "copy" && method !== "symlink") throw new CliError(`Unknown method ${method}. Imports support copy or symlink.`);
    const staging = (args.value("staging") ?? "").trim();
    if (staging.length > 0) {
      const violation = installTargetViolation(staging, this.getVaultBasePath(), homedir());
      if (violation) throw new CliError(`Staging directory is not usable: ${violation}`);
    }
    const selection = splitSkillSelector(args.value("skill") ?? "*");

    if (args.dryrun) {
      const discovered = await discoverSkills(path);
      if (discovered.missingSkillsFolder) {
        return { action: "import", ok: false, message: formatMissingSkillsFolderMessage(), data: { path, missingSkillsFolder: true } };
      }
      const chosen = selection === "all"
        ? discovered.skills
        : discovered.skills.filter((skill) => selection.some((name) => name.toLowerCase() === skill.folderName.toLowerCase()));
      return {
        action: "import",
        ok: true,
        message: `dryrun: ${chosen.length} of ${discovered.skills.length} skills under ${path} would be imported via ${method}`,
        columns: ["folder", "name", "description", "warnings"],
        rows: chosen.map((skill) => ({ folder: skill.folderName, name: skill.metadata.name, description: skill.metadata.description, warnings: skill.warnings.join("; ") })),
        data: { path, method, dryrun: true, unreadable: discovered.warnings.length }
      };
    }

    const result = await this.importDirectoryHeadless(path, { type: "local", path }, "local", selection === "all" ? "*" : selection, staging.length > 0 ? staging : undefined);
    return {
      action: "import",
      ok: true,
      message: `imported ${result.imported.length} skill${result.imported.length === 1 ? "" : "s"} from ${path}`,
      columns: SKILL_ROW_COLUMNS,
      rows: skillRecordRows(result.imported),
      data: { path, method, imported: result.imported.map((record) => record.id) }
    };
  }

  private cliRefresh(args: CliArgs): CliOutcome {
    this.refreshSkillHub();
    return {
      action: "refresh",
      ok: true,
      message: "open Skill Hub views were redrawn from the registry",
      data: { skills: Object.keys(this.registry.data.skills).length }
    };
  }

  private cliProbe(args: CliArgs): CliOutcome {
    const keys = Object.keys(args.raw).sort();
    const rendered = keys.map((key) => `${key}=${args.raw[key] === true ? "" : String(args.raw[key])}`);
    return {
      action: "probe",
      ok: true,
      message: `${keys.length} parameter${keys.length === 1 ? "" : "s"} reached the command layer: ${rendered.length > 0 ? rendered.join(" ") : "(none)"}`,
      columns: ["parameter", "received"],
      rows: keys.map((key) => ({ parameter: key, received: args.raw[key] === true ? "(flag without a value)" : String(args.raw[key]) })),
      data: { received: args.raw }
    };
  }

  private async cliOrder(args: CliArgs): Promise<CliOutcome> {
    const list = args.value("list");
    if (list === undefined) {
      const rows = this.data.settings.skillOrder.map((id, index) => ({ position: index + 1, skill: this.registry.data.skills[id]?.nickname ?? id }));
      return { action: "order", ok: true, message: `${rows.length} curated entries`, columns: ["position", "skill"], rows, data: { order: this.data.settings.skillOrder } };
    }
    const proposed = this.cliResolveOrder(list);
    if (args.dryrun) {
      return { action: "order", ok: true, message: `dryrun: the curated order would become ${proposed.ids.length} entries`, columns: ["position", "skill"], rows: proposed.rows, data: { dryrun: true, order: proposed.ids } };
    }
    this.data.settings.skillOrder = proposed.ids;
    await this.saveSkillHubData();
    this.refreshSkillHub();
    return { action: "order", ok: true, message: `curated order set to ${proposed.ids.length} entries`, columns: ["position", "skill"], rows: proposed.rows, data: { order: proposed.ids } };
  }

  private cliResolveOrder(list: string): { ids: string[]; rows: CliRow[] } {
    const ids: string[] = [];
    const rows: CliRow[] = [];
    for (const name of list.split(",").map((part) => part.trim()).filter((part) => part.length > 0)) {
      const found = this.cliFindRecord(name);
      if (!found) throw new CliError(`No skill named ${name} is in the registry, so the curated order was not changed.`);
      if (ids.includes(found.id)) continue;
      ids.push(found.id);
      rows.push({ position: ids.length, skill: found.nickname });
    }
    if (ids.length === 0) throw new CliError("Missing a non empty list=<name|id,...> value.");
    return { ids, rows };
  }

  private async cliSettings(args: CliArgs): Promise<CliOutcome> {
    const reported = this.cliReportedSettings();
    const key = (args.value("key") ?? "").trim();
    if (key.length === 0) {
      return { action: "settings", ok: true, message: `${reported.length} settings`, columns: ["property", "value"], rows: reported.map((entry) => ({ property: entry.key, value: entry.value })) };
    }
    const match = reported.find((entry) => entry.key.toLowerCase() === key.toLowerCase());
    if (!match) throw new CliError(`Unknown setting ${key}. Reported settings: ${reported.map((entry) => entry.key).join(", ")}.`);
    const proposed = args.value("value");
    if (proposed === undefined) {
      return { action: "settings", ok: true, columns: ["property", "value"], rows: [{ property: match.key, value: match.value }] };
    }
    if (match.protected === true) {
      throw new CliError(`${match.key} cannot be changed from the command line. Turn it on under Settings -> Community plugins -> Skill Hub.`);
    }
    const applied = this.cliApplySetting(match.key, proposed);
    await this.saveSkillHubData();
    this.refreshSkillHub();
    return { action: "settings", ok: true, message: `${match.key} set to ${applied}`, columns: ["property", "value"], rows: [{ property: match.key, value: applied }] };
  }

  private cliReportedSettings(): Array<{ key: string; value: string; protected?: boolean }> {
    const settings = this.data.settings;
    return [
      { key: "skillFolder", value: settings.skillFolder },
      { key: "installMethod", value: settings.installMethod },
      { key: "defaultSort", value: settings.defaultSort },
      { key: "defaultSymlinkConflictBehavior", value: settings.defaultSymlinkConflictBehavior },
      { key: "cliEnabled", value: String(settings.cliEnabled === true), protected: true },
      { key: "npxExecutionEnabled", value: String(settings.npxExecutionEnabled), protected: true }
    ];
  }

  private cliApplySetting(key: string, proposed: string): string {
    const settings = this.data.settings;
    const value = proposed.trim();
    switch (key) {
      case "skillFolder": {
        const next = value.length > 0 ? value : DEFAULT_SETTINGS.skillFolder;
        try {
          resolveVaultRelativePath("/vault", next);
        } catch (error) {
          throw new CliError(`Rejected skill folder ${value}: ${error instanceof Error ? error.message : String(error)}`);
        }
        settings.skillFolder = next;
        return next;
      }
      case "installMethod": {
        if (value !== "symlink" && value !== "copy") throw new CliError(`Unknown installMethod ${value}. Use symlink or copy.`);
        settings.installMethod = value;
        return value;
      }
      case "defaultSort": {
        if (value !== "nickname" && value !== "originalName" && value !== "updatedAt" && value !== "custom") {
          throw new CliError(`Unknown defaultSort ${value}. Use nickname, originalName, updatedAt or custom.`);
        }
        settings.defaultSort = value;
        return value;
      }
      case "defaultSymlinkConflictBehavior": {
        if (value !== "skip" && value !== "overwrite") throw new CliError(`Unknown defaultSymlinkConflictBehavior ${value}. Use skip or overwrite.`);
        settings.defaultSymlinkConflictBehavior = value;
        return value;
      }
      default:
        throw new CliError(`${key} cannot be changed from the command line.`);
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

  private cliTarget(args: CliArgs, action: string): string {
    const target = (args.value("target") ?? this.knownInstallTargets()[0] ?? "").trim();
    if (target.length === 0) {
      throw new CliError(`Missing required parameter target=<path>. Pick an install target once in Skill Hub so it is remembered, or pass target=<path> before running ${action}.`);
    }
    return target;
  }

  private async cliLink(args: CliArgs): Promise<CliOutcome> {
    const selector = args.required("skill");
    const record = this.cliFindRecord(selector);
    const all = this.cliRecords();
    if (!record) {
      const known = all.slice(0, 8).map((entry) => entry.nickname).join(", ");
      throw new CliError(`No skill named ${selector}. Known skills: ${known.length > 0 ? `${known}${all.length > 8 ? ", ..." : ""}` : "(none)"}.`);
    }
    const target = this.cliTarget(args, "link");
    const vaultPath = this.getVaultBasePath();
    const mechanism = this.cliLinkMethod(args);
    await this.assertCliInstallTarget(target, vaultPath);
    const destination = this.cliInstallDestination(target, record, "link");
    const state = await inspectDestination(destination);

    if (state === "real") {
      throw new CliError(`${destination} is a real path that the install record does not account for, so link refuses to touch it. Use another skill name, or remove that path yourself first.`);
    }
    if (state === "symlink" && !args.flag("force")) {
      throw new CliError(`${destination} is already linked. Pass force=1 to replace the existing link.`);
    }
    const replacing = state === "symlink";

    if (args.dryrun) {
      return {
        action: "link",
        ok: true,
        message: `dryrun: would ${replacing ? "replace the link at" : "link"} ${destination} to ${record.vaultPath} using ${mechanism}`,
        columns: CLI_INSTALL_COLUMNS,
        rows: [{ name: record.nickname, decision: replacing ? "replaced" : "installed", destination, mechanism, reason: replacing ? "existing link would be replaced" : "" }],
        data: { target, skill: record.id, mechanism, dryrun: true }
      };
    }

    const summary = await this.installSkillsTo([record], target, {
      vaultPath,
      method: mechanism,
      conflictBehavior: replacing ? "replace-symlinks" : "skip"
    });
    this.refreshSkillHub();
    const failure = summary.failed.find((entry) => entry.skillId === record.id);
    return {
      action: "link",
      ok: failure === undefined,
      message: failure
        ? `${destination}: ${failure.reason}`
        : `${destination} -> ${record.vaultPath} via ${summary.mechanisms?.[record.id] ?? mechanism}`,
      columns: CLI_INSTALL_COLUMNS,
      rows: this.cliInstallRows([record], target, summary),
      data: { target, skill: record.id, mechanism, summary }
    };
  }

  private cliLinkMethod(args: CliArgs): InstallLinkMechanism {
    const fallback = this.data.settings.installMethod === "copy" ? "symlink" : this.data.settings.installMethod;
    const requested = (args.value("method") ?? fallback).trim().toLowerCase();
    if (requested === "symlink" || requested === "junction") return requested;
    if (requested === "copy") throw new CliError("link needs method=symlink or method=junction. Use install for copies.");
    throw new CliError(`Unknown method ${requested}. Use symlink or junction.`);
  }

  private async cliUninstall(args: CliArgs): Promise<CliOutcome> {
    const target = this.cliTarget(args, "uninstall");
    const vaultPath = this.getVaultBasePath();
    await this.assertCliInstallTarget(target, vaultPath);
    const installed = this.cliInstallRecordsForTarget(target);
    const requested = splitSkillSelector(args.value("skill") ?? "");
    const selection = requested === "all"
      ? installed
      : installed.filter((entry) => requested.some((name) => this.cliSameSkillName(entry.record, name)));

    if (selection.length === 0) {
      throw new CliError(installed.length === 0
        ? `No Skill Hub install record points at ${target}, so nothing is removed. Installs made by earlier versions are deliberately left alone: install again first, or remove those entries by hand.`
        : `No selected skill is recorded as installed at ${target}. Recorded installs: ${installed.slice(0, 8).map((entry) => entry.record.nickname).join(", ")}${installed.length > 8 ? ", ..." : ""}.`);
    }

    const candidates: UninstallCandidate[] = selection.map((entry) => ({
      key: entry.record.id,
      label: entry.record.nickname,
      destination: this.cliInstallDestination(target, entry.record, "uninstall"),
      method: entry.method,
      proven: true
    }));
    const plan = await applyUninstallPlan(
      candidates,
      async (destination) => await inspectDestination(destination),
      async (candidate) => {
        if (candidate.method === "copy") await rm(candidate.destination, { recursive: true, force: true });
        else await unlink(candidate.destination);
      },
      !args.dryrun
    );
    const rows: CliRow[] = plan.rows.map((row) => ({ name: row.label, decision: row.decision, destination: row.destination, mechanism: row.mechanism, reason: row.reason }));

    if (args.dryrun) {
      return {
        action: "uninstall",
        ok: plan.blocked === 0,
        message: `dryrun for ${target}: ${plan.removable} to remove, ${plan.missing} already absent, ${plan.blocked} left alone`,
        columns: CLI_INSTALL_COLUMNS,
        rows,
        data: { target, dryrun: true, counts: { removable: plan.removable, missing: plan.missing, blocked: plan.blocked } }
      };
    }

    this.refreshSkillHub();
    return {
      action: "uninstall",
      ok: plan.failed === 0 && plan.blocked === 0,
      message: `${target}: removed ${plan.removed}, ${plan.missing} already absent, ${plan.blocked} left alone, ${plan.failed} failed`,
      columns: CLI_INSTALL_COLUMNS,
      rows,
      data: { target, counts: { removed: plan.removed, missing: plan.missing, blocked: plan.blocked, failed: plan.failed } }
    };
  }

  private cliInstallDestination(target: string, record: SkillRecord, action: string): string {
    const root = resolve(target);
    const destination = resolve(join(root, ".agents", "skills", record.folderName));
    if (!this.isInsideDirectory(root, destination)) {
      throw new CliError(`Refusing ${action}: ${destination} does not sit inside the requested target.`);
    }
    return destination;
  }

  private cliInstallRecordsForTarget(target: string): Array<{ record: SkillRecord; method: string }> {
    const wanted = resolve(target);
    const skills = this.registry.data.skills;
    const found: Array<{ record: SkillRecord; method: string }> = [];
    for (const event of this.registry.data.events) {
      if (event.type !== "skill_installed") continue;
      const recorded = typeof event.details.targetDir === "string" ? event.details.targetDir : "";
      if (recorded.length === 0 || resolve(recorded) !== wanted) continue;
      const record = skills[event.skillId ?? ""];
      if (!record) continue;
      if (!found.some((entry) => entry.record.id === record.id)) {
        found.push({ record, method: typeof event.details.method === "string" ? event.details.method : "symlink" });
      }
    }
    return found.sort((left, right) => left.record.nickname.localeCompare(right.record.nickname));
  }

  private cliSameSkillName(record: SkillRecord, name: string): boolean {
    const wanted = name.trim().toLowerCase();
    return record.id.toLowerCase() === wanted || record.nickname.toLowerCase() === wanted || record.folderName.toLowerCase() === wanted;
  }

  private async cliInstall(args: CliArgs): Promise<CliOutcome> {
    const records = this.cliSelectRecords(args);
    const target = this.cliTarget(args, "install");
    const vaultPath = this.getVaultBasePath();
    const method = this.cliInstallMethod(args);
    const conflictBehavior = this.cliConflictBehavior(args);
    await this.assertCliInstallTarget(target, vaultPath);

    const plan = await this.cliPlanInstall(records, target, conflictBehavior, vaultPath);
    if (args.dryrun) {
      return {
        action: "install",
        ok: true,
        message: `dryrun for ${target} using ${method}: ${plan.installed} to add, ${plan.replaced} to replace, ${plan.skipped} already present, ${plan.failed} would fail`,
        columns: CLI_INSTALL_COLUMNS,
        rows: plan.rows,
        data: { target, method, conflictBehavior, dryrun: true, counts: { installed: plan.installed, replaced: plan.replaced, skipped: plan.skipped, failed: plan.failed } }
      };
    }
    if (plan.replaced > 0 && !args.confirm) {
      const victims = plan.rows.filter((row) => row.decision === "replaced").map((row) => String(row.name ?? "")).join(", ");
      throw new CliError(`Installing into ${target} would replace ${plan.replaced} existing ${plan.replaced === 1 ? "link" : "links"} (${victims}). Re-run with confirm=1 to apply, or dryrun=1 to review.`);
    }

    const summary = await this.installSkillsTo(records, target, { vaultPath, method, conflictBehavior });
    this.refreshSkillHub();
    return {
      action: "install",
      ok: summary.failed.length === 0,
      message: `${target}: installed ${summary.installed.length}, replaced ${summary.replaced.length}, skipped ${summary.skipped.length}, failed ${summary.failed.length}`,
      columns: CLI_INSTALL_COLUMNS,
      rows: this.cliInstallRows(records, target, summary),
      data: { target, method, conflictBehavior, summary }
    };
  }

  private cliSelectRecords(args: CliArgs): SkillRecord[] {
    const all = this.cliRecords();
    const selector = (args.value("skill") ?? "").trim();
    const collection = (args.value("collection") ?? "").trim();
    if (selector.length === 0 && collection.length === 0) {
      throw new CliError("Missing required parameter skill=<name|id|all>. Pass skill=all together with collection=<name> to install a whole collection.");
    }

    let picked: SkillRecord[];
    const requested = splitSkillSelector(selector);
    if (requested === "all") {
      picked = all.slice();
    } else {
      picked = [];
      for (const name of requested) {
        const found = this.cliFindRecord(name);
        if (!found) {
          const known = all.slice(0, 8).map((entry) => entry.nickname).join(", ");
          throw new CliError(`No skill named ${name}. Known skills: ${known.length > 0 ? `${known}${all.length > 8 ? ", ..." : ""}` : "(none)"}.`);
        }
        if (!picked.includes(found)) picked.push(found);
      }
    }

    const selected = collection.length === 0 ? picked : this.cliCollectionMembers(picked, collection);
    if (selected.length === 0) throw new CliError("That selection resolved to no skills.");
    return selected;
  }

  private cliCollectionMembers(records: SkillRecord[], collection: string): SkillRecord[] {
    const wanted = collection.trim().toLowerCase();
    const match = Object.values(this.registry.data.collections).find((entry) => entry.id.toLowerCase() === wanted || entry.name.toLowerCase() === wanted);
    if (!match) throw new CliError(`No collection named ${collection}.`);
    const memberIds = new Set(match.skillIds);
    return records.filter((record) => memberIds.has(record.id));
  }

  private cliInstallMethod(args: CliArgs): InstallMethod {
    const requested = (args.value("method") ?? "").trim().toLowerCase();
    if (requested.length === 0) return this.data.settings.installMethod;
    if (requested === "copy" || requested === "symlink" || requested === "junction") return requested;
    throw new CliError(`Unknown method ${requested}. Use copy, symlink or junction.`);
  }

  private cliConflictBehavior(args: CliArgs): SymlinkConflictBehavior {
    const requested = (args.value("conflict") ?? "").trim().toLowerCase();
    if (requested.length === 0) return this.data.settings.defaultSymlinkConflictBehavior === "overwrite" ? "replace-symlinks" : "skip";
    if (requested === "skip" || requested === "replace-symlinks") return requested;
    throw new CliError(`Unknown conflict ${requested}. Use skip or replace-symlinks.`);
  }

  private async assertCliInstallTarget(target: string, vaultPath: string): Promise<void> {
    const violation = installTargetViolation(target, vaultPath, homedir());
    if (violation) throw new CliError(violation);
    const resolved = resolve(target);
    try {
      const stats = await lstat(resolved);
      if (!stats.isDirectory()) throw new CliError(`Install target ${target} is a file, not a directory.`);
    } catch (error) {
      if (error instanceof CliError) throw error;
      const code = (error as { code?: string })?.code;
      throw new CliError(code === "ENOENT"
        ? `Install target ${target} does not exist yet. Create it first, or install from the Skill Hub user interface.`
        : `Install target ${target} cannot be inspected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async cliPlanInstall(
    records: SkillRecord[],
    target: string,
    conflictBehavior: SymlinkConflictBehavior,
    vaultPath: string
  ): Promise<{ rows: CliRow[]; installed: number; replaced: number; skipped: number; failed: number }> {
    const rows: CliRow[] = [];
    const counts = { installed: 0, replaced: 0, skipped: 0, failed: 0 };
    for (const record of records) {
      const destination = this.cliInstallDestination(target, record, "install");
      try {
        await resolveVaultRelativePath(vaultPath, record.vaultPath, { verifyFilesystem: true });
      } catch (error) {
        counts.failed += 1;
        rows.push({ name: record.nickname, decision: "failed", destination, mechanism: "", reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      const state = await inspectDestination(destination);
      if (state === "missing") {
        counts.installed += 1;
        rows.push({ name: record.nickname, decision: "installed", destination, mechanism: "", reason: "" });
      } else if (state === "symlink" && conflictBehavior === "replace-symlinks") {
        counts.replaced += 1;
        rows.push({ name: record.nickname, decision: "replaced", destination, mechanism: "", reason: "existing link would be replaced" });
      } else {
        counts.skipped += 1;
        rows.push({ name: record.nickname, decision: "skipped", destination, mechanism: "", reason: `destination already ${state}` });
      }
    }
    return { rows, ...counts };
  }

  private cliInstallRows(records: SkillRecord[], target: string, summary: InstallSummary): CliRow[] {
    return records.map((record) => {
      const decision = summary.installed.includes(record.id) ? "installed"
        : summary.replaced.includes(record.id) ? "replaced"
          : summary.skipped.includes(record.id) ? "skipped" : "failed";
      const failure = summary.failed.find((entry) => entry.skillId === record.id);
      return {
        name: record.nickname,
        decision,
        destination: this.cliInstallDestination(target, record, "install"),
        mechanism: summary.mechanisms?.[record.id] ?? "",
        reason: failure?.reason ?? ""
      };
    });
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
