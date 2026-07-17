import { PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type SkillHubPlugin from "./main";
import { DEFAULT_SETTINGS } from "./settingsDefaults";
import type { SkillHubSettings } from "./types";
import { resolveVaultRelativePath } from "./vaultPaths";

type SkillHubSettingKey =
  | "skillFolder"
  | "installMethod"
  | "defaultSort"
  | "npxExecutionEnabled"
  | "defaultSymlinkConflictBehavior";

export class SkillHubSettingTab extends PluginSettingTab {
  constructor(app: PluginSettingTab["app"], private readonly skillHubPlugin: SkillHubPlugin) {
    super(app, skillHubPlugin);
  }

  getSettingDefinitions(): SettingDefinitionItem<SkillHubSettingKey>[] {
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

  getControlValue(key: SkillHubSettingKey): unknown {
    return this.skillHubPlugin.data.settings[key];
  }

  async setControlValue(key: SkillHubSettingKey, value: unknown): Promise<void> {
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

  private validateSkillFolder(value: string): string | void {
    try {
      resolveVaultRelativePath("/vault", value.trim() || DEFAULT_SETTINGS.skillFolder);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private isInstallMethod(value: unknown): value is SkillHubSettings["installMethod"] {
    return value === "symlink" || value === "copy";
  }

  private isDefaultSort(value: unknown): value is SkillHubSettings["defaultSort"] {
    return value === "nickname" || value === "originalName" || value === "updatedAt" || value === "custom";
  }

  private isSymlinkConflictBehavior(value: unknown): value is SkillHubSettings["defaultSymlinkConflictBehavior"] {
    return value === "skip" || value === "overwrite";
  }
}
