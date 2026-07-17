import { readFile } from "fs/promises";
import { describe, expect, it } from "vitest";

describe("Obsidian review compliance", () => {
  it("keeps plugin metadata review-safe", async () => {
    const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8")) as { description: string };
    const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");

    expect(manifest.description).not.toMatch(/\bObsidian\b/i);
    expect(packageJson).not.toContain("\"builtin-modules\"");
  });

  it("uses Obsidian 1.12.7-compatible settings and destructive button APIs", async () => {
    const settingsSource = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
    const modalSource = await readFile(new URL("../src/ui/modals.ts", import.meta.url), "utf8");

    expect(settingsSource).toContain(".setHeading()");
    expect(settingsSource).not.toContain("SettingDefinitionItem");
    expect(settingsSource).not.toContain("getSettingDefinitions");
    expect(settingsSource).not.toContain("getControlValue");
    expect(settingsSource).not.toContain("setControlValue");
    expect(settingsSource).not.toContain("Skill Hub settings");
    expect(settingsSource).not.toContain("createEl(\"h2\"");
    expect(modalSource).not.toContain(".setDestructive()");
    expect(modalSource).not.toContain(".setWarning()");
    expect(modalSource).toContain("setButtonWarning");
  });

  it("avoids unsafe folder picker and throw patterns", async () => {
    const folderPickerSource = await readFile(new URL("../src/folderPicker.ts", import.meta.url), "utf8");
    const importServiceSource = await readFile(new URL("../src/importService.ts", import.meta.url), "utf8");

    expect(folderPickerSource).not.toContain("require(");
    expect(folderPickerSource).not.toContain("document.createElement");
    expect(folderPickerSource).not.toContain("Array(relativeSegments.length - 1).fill");
    expect(folderPickerSource).not.toContain("rejectSelection(error)");
    expect(importServiceSource).not.toContain("throw operationError");
    expect(importServiceSource).not.toContain("throw combineErrors(");
    expect(importServiceSource).not.toContain("throw toError(");
    expect(importServiceSource).not.toContain("throw cleanupCombinedError");
  });

  it("does not create DOM elements with native document APIs", async () => {
    const skillHubViewSource = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");
    const modalSource = await readFile(new URL("../src/ui/modals.ts", import.meta.url), "utf8");

    expect(skillHubViewSource).not.toMatch(/document\.createElement(?:NS)?/);
    expect(modalSource).not.toMatch(/document\.createElement(?:NS)?/);
  });

  it("uses specific text element helpers where review flags generic createEl spans", async () => {
    const skillHubViewSource = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");
    const modalSource = await readFile(new URL("../src/ui/modals.ts", import.meta.url), "utf8");

    expect(skillHubViewSource).not.toContain("createEl(\"span\"");
    expect(modalSource).not.toContain("createEl(\"span\"");
  });

  it("does not use CSS important overrides", async () => {
    const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

    expect(css).not.toContain("!important");
  });
});
