import { Notice, Plugin } from "obsidian";
import { createEmptySkillHubData, SkillRegistry } from "./registry";
import { DEFAULT_SETTINGS } from "./settings";
import type { SkillHubData } from "./types";

export default class SkillHubPlugin extends Plugin {
  data: SkillHubData = createEmptySkillHubData();
  registry = new SkillRegistry(this.data);

  async onload(): Promise<void> {
    const saved = (await this.loadData()) as Partial<SkillHubData> | null;
    this.data = {
      settings: { ...DEFAULT_SETTINGS, ...saved?.settings },
      skills: saved?.skills ?? {},
      collections: saved?.collections ?? {},
      events: saved?.events ?? []
    };
    this.registry = new SkillRegistry(this.data);

    this.addRibbonIcon("blocks", "Open Skill Hub", () => {
      new Notice("Skill Hub scaffold loaded");
    });
  }

  async saveSkillHubData(): Promise<void> {
    await this.saveData(this.registry.data);
  }
}
