import { readFile } from "fs/promises";
import { describe, expect, it } from "vitest";

describe("skill hub UI source", () => {
  it("does not render skill descriptions on skill cards", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");

    expect(source).not.toContain("No description provided.");
    expect(source).not.toContain("card.createEl(\"p\"");
  });

  it("does not render import sources as skill card tags", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");

    expect(source).not.toContain("skill.source.type");
  });

  it("offers skill-related emoji candidates in the edit modal", async () => {
    const source = await readFile(new URL("../src/ui/modals.ts", import.meta.url), "utf8");

    expect(source).toContain("SKILL_EMOJI_CANDIDATES");
    expect(source).toContain("skillhub-emoji-candidates");
  });

  it("supports enter-to-add editable tag chips with colors and delete controls", async () => {
    const source = await readFile(new URL("../src/ui/modals.ts", import.meta.url), "utf8");

    expect(source).toContain("event.key === \"Enter\"");
    expect(source).toContain("skillhub-current-tags");
    expect(source).toContain("skillhub-existing-tags");
    expect(source).toContain("Right click to change tag color");
    expect(source).toContain("skillhub-tag-delete-icon");
    expect(source).toContain("contextmenu");
    expect(source).toContain("tagColors");
  });

  it("renders tag colors from shared plugin data", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");

    expect(source).toContain("this.plugin.registry.data.tagColors");
    expect(source).toContain("collectTagColors(this.plugin.registry.data)");
    expect(source).not.toContain("skill.tagColors?.[tag]");
  });
});
