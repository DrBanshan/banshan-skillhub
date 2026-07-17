import { PluginSettingTab, Setting } from "obsidian";
import type SkillHubPlugin from "./main";
import { DEFAULT_SETTINGS } from "./settingsDefaults";
import type { SkillHubSettings } from "./types";
import { resolveVaultRelativePath } from "./vaultPaths";

// eslint-disable-next-line obsidianmd/settings-tab/prefer-setting-definitions -- Declarative definitions require app 1.13.0; manifest stays at 1.12.7.
export class SkillHubSettingTab extends PluginSettingTab {
  constructor(app: PluginSettingTab["app"], private readonly skillHubPlugin: SkillHubPlugin) {
    super(app, skillHubPlugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Skill Hub").setHeading();

    const skillFolderSetting = new Setting(containerEl)
      .setName("Skill folder")
      .setDesc("Vault folder used to store imported skills.")
      .addText((text) => text.setValue(this.skillHubPlugin.data.settings.skillFolder).onChange(async (value) => {
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

    new Setting(containerEl)
      .setName("Install method")
      .setDesc("How skills are installed into .agents/skills.")
      .addDropdown((dropdown) => dropdown
        .addOption("symlink", "Symlink")
        .addOption("copy", "Copy")
        .setValue(this.skillHubPlugin.data.settings.installMethod)
        .onChange(async (value) => {
          this.skillHubPlugin.data.settings.installMethod = value as SkillHubSettings["installMethod"];
          await this.skillHubPlugin.saveSkillHubData();
        }));

    new Setting(containerEl)
      .setName("Default sort")
      .setDesc("Initial ordering in the Skill Hub view.")
      .addDropdown((dropdown) => dropdown
        .addOption("nickname", "Nickname")
        .addOption("originalName", "Original name")
        .addOption("updatedAt", "Recently updated")
        .addOption("custom", "Custom order")
        .setValue(this.skillHubPlugin.data.settings.defaultSort)
        .onChange(async (value) => {
          this.skillHubPlugin.data.settings.defaultSort = value as SkillHubSettings["defaultSort"];
          await this.skillHubPlugin.saveSkillHubData();
          this.skillHubPlugin.refreshSkillHub();
        }));

    new Setting(containerEl)
      .setName("Enable npx execution")
      .setDesc("Allow Skill Hub to run npx skills add commands.")
      .addToggle((toggle) => toggle.setValue(this.skillHubPlugin.data.settings.npxExecutionEnabled).onChange(async (value) => {
        this.skillHubPlugin.data.settings.npxExecutionEnabled = value;
        await this.skillHubPlugin.saveSkillHubData();
      }));

    new Setting(containerEl)
      .setName("Symlink conflict behavior")
      .setDesc("Choose what happens when a destination is already a symlink.")
      .addDropdown((dropdown) => dropdown
        .addOption("skip", "Skip")
        .addOption("overwrite", "Overwrite symlinks")
        .setValue(this.skillHubPlugin.data.settings.defaultSymlinkConflictBehavior)
        .onChange(async (value) => {
          this.skillHubPlugin.data.settings.defaultSymlinkConflictBehavior = value as SkillHubSettings["defaultSymlinkConflictBehavior"];
          await this.skillHubPlugin.saveSkillHubData();
        }));
  }
}
