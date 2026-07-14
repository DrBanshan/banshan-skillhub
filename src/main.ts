import { Notice, Plugin } from "obsidian";

export default class SkillHubPlugin extends Plugin {
  async onload(): Promise<void> {
    this.addRibbonIcon("blocks", "Open Skill Hub", () => {
      new Notice("Skill Hub scaffold loaded");
    });
  }
}
