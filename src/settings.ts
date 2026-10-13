import { PluginSettingTab, type Setting, type SettingDefinitionItem } from "obsidian";
import type SkillHubPlugin from "./main";
import { cliVerificationCommands } from "./cli";
import { DEFAULT_SETTINGS } from "./settingsDefaults";
import type { SkillHubSettings } from "./types";
import { resolveVaultRelativePath } from "./vaultPaths";

type SkillHubSettingKey =
  | "skillFolder"
  | "installMethod"
  | "defaultSort"
  | "npxExecutionEnabled"
  | "cliEnabled"
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
          name: "Enable Skill Hub command line actions",
          desc: "Publishes the banshan-skillhub command to the Obsidian command line interface, which you switch on separately under Settings -> General. Skill Hub actions then run without opening a window.",
          control: {
            type: "toggle",
            key: "cliEnabled",
            defaultValue: DEFAULT_SETTINGS.cliEnabled
          }
        },
        {
          name: "Check the actions from a terminal",
          desc: "Name the vault before the command, because the client reads a vault first and then the command. "
            + "Run the lines below from anywhere, with Obsidian open and this vault loaded, and the plugin answers in the terminal. "
            + "To exercise every action at once, run test.cmd from a checkout of the plugin repository: it detects the vault, "
            + "or takes one as test.cmd vault=<folder>, and test.cmd --list shows the vaults Obsidian knows about. "
            + "The report is written under the temporary folder and the exit code is the number of checks that failed. "
            + "The fields hold the lines ready to copy, for the vault you have open now.",
          render: (setting: Setting) => {
            for (const command of cliVerificationCommands(this.vaultNameForCli())) {
              setting.addText((field) => {
                field.setValue(command);
              });
            }
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

  /**
   * The vault name the command line takes, which for a vault that cannot answer is left blank so the
   * shown line carries a placeholder rather than a wrong name.
   */
  private vaultNameForCli(): string {
    try {
      return this.app.vault.getName() ?? "";
    } catch (error) {
      return "";
    }
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
    } else if (key === "cliEnabled") {
      this.skillHubPlugin.data.settings.cliEnabled = Boolean(value);
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
