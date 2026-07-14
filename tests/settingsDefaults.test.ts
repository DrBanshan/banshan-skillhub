import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settingsDefaults";

describe("DEFAULT_SETTINGS", () => {
  it("is available without the Obsidian settings UI module", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      skillFolder: "Skill",
      installMethod: "symlink",
      npxExecutionEnabled: false,
      defaultSymlinkConflictBehavior: "skip",
      defaultSort: "nickname"
    });
  });
});
