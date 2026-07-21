import { DEFAULT_SETTINGS } from "./settingsDefaults";
import type { SkillCollection, SkillEvent, SkillHubData, SkillRecord } from "./types";

export function createEmptySkillHubData(): SkillHubData {
  return {
    settings: { ...DEFAULT_SETTINGS },
    skills: {},
    collections: {},
    bundleNames: {},
    pinnedFolderIds: [],
    tagColors: {},
    events: []
  };
}

export function collectTagColors(data: Pick<SkillHubData, "skills"> & { tagColors?: Record<string, string> }): Record<string, string> {
  const tagColors = { ...(data.tagColors ?? {}) };
  for (const skill of Object.values(data.skills)) {
    for (const [tag, color] of Object.entries(skill.tagColors ?? {})) {
      if (!tagColors[tag]) tagColors[tag] = color;
    }
  }
  return tagColors;
}

export class SkillRegistry {
  constructor(public readonly data: SkillHubData) {}

  upsertSkill(record: SkillRecord): void {
    this.data.skills[record.id] = record;
  }

  deleteSkill(id: string): void {
    delete this.data.skills[id];
    for (const collection of Object.values(this.data.collections)) {
      collection.skillIds = collection.skillIds.filter((skillId) => skillId !== id);
    }
  }

  updateSkillCollections(skillId: string, collectionIds: string[]): void {
    const skill = this.data.skills[skillId];
    if (!skill) return;

    const selectedCollectionIds = new Set(collectionIds);
    skill.collectionIds = [...selectedCollectionIds];
    for (const collection of Object.values(this.data.collections)) {
      if (selectedCollectionIds.has(collection.id)) {
        if (!collection.skillIds.includes(skillId)) collection.skillIds.push(skillId);
      } else {
        collection.skillIds = collection.skillIds.filter((id) => id !== skillId);
      }
    }
  }

  saveCollection(collection: SkillCollection): void {
    this.data.collections[collection.id] = collection;
  }

  deleteCollection(id: string): void {
    delete this.data.collections[id];
    for (const skill of Object.values(this.data.skills)) {
      skill.collectionIds = skill.collectionIds.filter((collectionId) => collectionId !== id);
    }
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
