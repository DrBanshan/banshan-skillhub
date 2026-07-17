import { PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type SkillHubPlugin from "./main";
import { DEFAULT_SETTINGS } from "./settingsDefaults";
import type { SkillHubSettings } from "./types";
import { resolveVaultRelativePath } from "./vaultPaths";

export class SkillHubSettingTab extends PluginSettingTab {
  constructor(app: PluginSettingTab["app"], private readonly skillHubPlugin: SkillHubPlugin) {
    super(app, skillHubPlugin);
  }

  getSettingDefinitions(): SettingDefinitionItem<keyof SkillHubSettings & string>[] {
    return [{
      type: "group",
      heading: "Skill Hub settings",
      items: [
        {
          name: "Skill folder",
          desc: "Vault folder used to store imported skills.",
          control: {
            type: "text",
            key: "skillFolder",
            defaultValue: DEFAULT_SETTINGS.skillFolder,
            validate: (value) => {
              try {
                resolveVaultRelativePath("/vault", value.trim() || DEFAULT_SETTINGS.skillFolder);
              } catch (error) {
                return error instanceof Error ? error.message : String(error);
              }
            }
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

  getControlValue(key: keyof SkillHubSettings & string): unknown {
    return this.skillHubPlugin.data.settings[key];
  }

  async setControlValue(key: keyof SkillHubSettings & string, value: unknown): Promise<void> {
    if (key === "skillFolder") {
      this.skillHubPlugin.data.settings.skillFolder = String(value).trim() || DEFAULT_SETTINGS.skillFolder;
    } else if (key === "installMethod" && (value === "symlink" || value === "copy")) {
      this.skillHubPlugin.data.settings.installMethod = value;
    } else if (key === "defaultSort" && (value === "nickname" || value === "originalName" || value === "updatedAt" || value === "custom")) {
      this.skillHubPlugin.data.settings.defaultSort = value;
      this.skillHubPlugin.refreshSkillHub();
    } else if (key === "npxExecutionEnabled") {
      this.skillHubPlugin.data.settings.npxExecutionEnabled = Boolean(value);
    } else if (key === "defaultSymlinkConflictBehavior" && (value === "skip" || value === "overwrite")) {
      this.skillHubPlugin.data.settings.defaultSymlinkConflictBehavior = value;
    }
    await this.skillHubPlugin.saveSkillHubData();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Skill Hub settings").setHeading();

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
