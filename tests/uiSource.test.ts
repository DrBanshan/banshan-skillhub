import { readFile } from "fs/promises";
import { describe, expect, it } from "vitest";

describe("skill hub UI source", () => {
  it("does not render skill descriptions on skill cards", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");

    expect(source).not.toContain("No description provided.");
    expect(source).not.toContain("card.createEl(\"p\"");
  });

  it("offers skill-related emoji candidates in the edit modal", async () => {
    const source = await readFile(new URL("../src/ui/modals.ts", import.meta.url), "utf8");

    expect(source).toContain("SKILL_EMOJI_CANDIDATES");
    expect(source).toContain("skillhub-emoji-candidates");
  });

  it("supports enter-to-add editable tag chips with colors and delete controls", async () => {
    const source = await readFile(new URL("../src/ui/modals.ts", import.meta.url), "utf8");

    expect(source).toContain("event.key === \"Enter\"");
    expect(source).toContain("skillhub-edit-tags");
    expect(source).toContain("skillhub-tag-delete");
    expect(source).toContain("tagColors");
  });
});
