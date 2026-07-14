import { DEFAULT_SETTINGS } from "./settings";
import type { SkillCollection, SkillEvent, SkillHubData, SkillRecord } from "./types";

export function createEmptySkillHubData(): SkillHubData {
  return {
    settings: { ...DEFAULT_SETTINGS },
    skills: {},
    collections: {},
    events: []
  };
}

export class SkillRegistry {
  constructor(public readonly data: SkillHubData) {}

  upsertSkill(record: SkillRecord): void {
    this.data.skills[record.id] = record;
  }

  deleteSkill(id: string): void {
    delete this.data.skills[id];
  }

  saveCollection(collection: SkillCollection): void {
    this.data.collections[collection.id] = collection;
  }

  deleteCollection(id: string): void {
    delete this.data.collections[id];
  }

  recordEvent(event: SkillEvent): void {
    this.data.events.push(event);
  }

  incrementInstall(skillId: string, at: string): void {
    const skill = this.data.skills[skillId];
    if (!skill) return;
    skill.installCount += 1;
    skill.lastInstalledAt = at;
  }
}
