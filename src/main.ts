import { addIcon, FileSystemAdapter, Notice, Plugin, requestUrl } from "obsidian";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { combineErrors } from "./errors";
import { SkillExportService } from "./exportService";
import { createSkillEvent } from "./events";
import { pickNativeFolder } from "./folderPicker";
import { GitHubRequestBudget, GitHubSkillDownloader, resolveGitHubSkillUrl, writeBoundedGitHubResponse, type GitHubContentEntry } from "./githubImport";
import { SkillImportService } from "./importService";
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
    const saved = (await this.loadData()) as Partial<SkillHubData> | null;
    this.data = {
      settings: { ...DEFAULT_SETTINGS, ...saved?.settings },
      skills: saved?.skills ?? {},
      collections: saved?.collections ?? {},
      bundleNames: saved?.bundleNames ?? {},
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
      const folders = await downloader.listSkillFolders(location);
      if (folders.length === 0) throw new Error("No skill folders were found.");
      new SkillSelectionModal(this.app, folders.map((folder) => ({ id: folder, label: folder, value: folder })), async (selected) => {
        let stagingPath: string | undefined;
        try {
          if (selected.length === 0) return;
          stagingPath = await mkdtemp(join(this.getVaultBasePath(), ".skillhub-github-import-"));
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
        const result = await new SkillImportService(this.registry, this.data.settings).importDiscoveredSkills(selected, {
          vaultPath: this.getVaultBasePath(),
          source,
          importMethod,
          stagingPath,
          persist: () => this.saveSkillHubData()
        });
        this.refreshSkillHub();
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
