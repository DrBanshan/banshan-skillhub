import type { SkillHubSettings } from "./types";

export const DEFAULT_SETTINGS: SkillHubSettings = {
  skillFolder: "Skill",
  installMethod: "symlink",
  npxExecutionEnabled: false,
  cliEnabled: false,
  knownInstallTargets: [],
  defaultSymlinkConflictBehavior: "skip",
  defaultSort: "nickname",
  skillOrder: []
};
