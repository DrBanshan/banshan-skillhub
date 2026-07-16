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

  it("keeps colors for existing tags that are not added to the edited skill", async () => {
    const source = await readFile(new URL("../src/ui/modals.ts", import.meta.url), "utf8");

    expect(source).toContain("tagColors: Object.fromEntries([...knownTags].filter((tag) => tagColors[tag])");
    expect(source).not.toContain("tagColors: Object.fromEntries(tags.filter((tag) => tagColors[tag])");
  });

  it("renders skill card actions as icon buttons with tooltips", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");

    expect(source).toContain("addCardActionButton");
    expect(source).toContain("skillhub-action-tooltip");
    expect(source).toContain("skillhub-delete-button");
    expect(source).toContain("skillhub-edit-button");
    expect(source).toContain("skillhub-details-button");
    expect(source).toContain("createSvgIcon");
  });

  it("renders the main toolbar as branded icon buttons", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");

    expect(source).toContain("addToolbarButton");
    expect(source).toContain("skillhub-toolbar-button");
    expect(source).toContain("skillhub-toolbar-icon");
    expect(source).toContain("\"github\"");
    expect(source).toContain("\"node\"");
    expect(source).toContain("\"download\"");
  });

  it("supports custom drag ordering from the sort dropdown", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");

    expect(source).toContain("addSortOption(sort, \"custom\", \"Custom order\")");
    expect(source).toContain("card.draggable = this.isCustomSort()");
    expect(source).toContain("dragstart");
    expect(source).toContain("drop");
    expect(source).toContain("reorderSkill");
    expect(source).toContain("skillOrder");
  });

  it("renders collection rows that accept dropped skills and expose icon actions", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");
    const modalSource = await readFile(new URL("../src/ui/modals.ts", import.meta.url), "utf8");

    expect(source).toContain("renderCollectionRows");
    expect(source).toContain("skillhub-collection-row");
    expect(source).toContain("handleCollectionDrop");
    expect(source).toContain("updateSkillCollections");
    expect(source).toContain("openCollectionDetailModal");
    expect(source).toContain("openCollectionEditModal");
    expect(source).toContain("deleteCollection");
    expect(modalSource).toContain("CollectionDetailModal");
  });
});
