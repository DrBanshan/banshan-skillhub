import { PluginSettingTab, Setting } from "obsidian";
import type SkillHubPlugin from "./main";
import type { SkillHubSettings } from "./types";

export const DEFAULT_SETTINGS: SkillHubSettings = {
  skillFolder: "Skill",
  installMethod: "symlink",
  npxExecutionEnabled: false,
  defaultSymlinkConflictBehavior: "skip",
  defaultSort: "nickname"
};

export class SkillHubSettingTab extends PluginSettingTab {
  constructor(app: PluginSettingTab["app"], private readonly skillHubPlugin: SkillHubPlugin) {
    super(app, skillHubPlugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Skill Hub settings" });

    new Setting(containerEl)
      .setName("Skill folder")
      .setDesc("Vault folder used to store imported skills.")
      .addText((text) => text.setValue(this.skillHubPlugin.data.settings.skillFolder).onChange(async (value) => {
        this.skillHubPlugin.data.settings.skillFolder = value.trim() || DEFAULT_SETTINGS.skillFolder;
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
