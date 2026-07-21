export type InstallMethod = "symlink" | "copy";

export interface SkillHubSettings {
  skillFolder: string;
  installMethod: InstallMethod;
  npxExecutionEnabled: boolean;
  defaultSymlinkConflictBehavior: "skip" | "overwrite";
  defaultSort: "nickname" | "originalName" | "updatedAt" | "custom";
  skillOrder: string[];
}

export interface SkillSource {
  type: "local" | "github" | "npx";
  path?: string;
  url?: string;
  command?: string;
}

export interface SkillRecord {
  id: string;
  folderName: string;
  vaultPath: string;
  originalName: string;
  nickname: string;
  emoji?: string;
  color?: string;
  description: string;
  tags: string[];
  tagColors?: Record<string, string>;
  collectionIds: string[];
  source: SkillSource;
  importMethod: "local" | "github" | "npx";
  warnings: string[];
  importedAt: string;
  updatedAt: string;
  installCount: number;
  lastInstalledAt?: string;
}

export interface SkillCollection {
  id: string;
  name: string;
  description: string;
  skillIds: string[];
  color?: string;
}

export interface SkillEvent {
  id: string;
  skillId?: string;
  type: "skill_imported" | "skill_installed" | "skill_deleted" | "collection_saved" | "collection_deleted";
  at: string;
  details: Record<string, unknown>;
}

export interface SkillHubData {
  settings: SkillHubSettings;
  skills: Record<string, SkillRecord>;
  collections: Record<string, SkillCollection>;
  bundleNames: Record<string, string>;
  tagColors: Record<string, string>;
  events: SkillEvent[];
}
