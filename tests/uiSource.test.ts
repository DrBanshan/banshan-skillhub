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
    expect(source).toContain("card.draggable = Boolean(collection) || this.isCustomSort()");
    expect(source).toContain("dragstart");
    expect(source).toContain("drop");
    expect(source).toContain("reorderSkill");
    expect(source).toContain("skillOrder");
  });

  it("renders source bundles and collections as expandable, pinnable folder tiles", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");
    const modalSource = await readFile(new URL("../src/ui/modals.ts", import.meta.url), "utf8");

    expect(source).toContain("deriveSkillBundles");
    expect(source).toContain("renderFolderBoard");
    expect(source).toContain("renderBundleFolder");
    expect(source).toContain("renderCollectionFolder");
    expect(source).toContain("skillhub-folder");
    expect(source).toContain("skillhub-folder-expansion");
    expect(source).toContain("toggleFolderPin");
    expect(source).toContain("pinnedFolderIds");
    expect(source).toContain("folderOrder");
    expect(source).toContain("reorderFolder");
    expect(source).toContain("application/x-skillhub-folder-id");
    expect(source).toContain("renderBundleExpansion");
    expect(source).toContain("renderCollectionExpansion");
    expect(source).toContain("gridTemplateColumns");
    expect(source).toContain("ResizeObserver");
    expect(source).toContain("is-folder-drop-before");
    expect(source).toContain("is-folder-drop-after");
    expect(source).toContain('"Pin", "pin"');
    expect(source).toContain("handleCollectionDrop");
    expect(source).toContain("updateSkillCollections");
    expect(source).toContain("openCollectionDetailModal");
    expect(source).toContain("openCollectionEditModal");
    expect(source).toContain("deleteCollection");
    expect(modalSource).toContain("CollectionDetailModal");
    expect(modalSource).toContain("BundleDetailModal");
    expect(modalSource).toContain("BundleEditModal");
    expect(modalSource).toContain("BundleEditValues");
    expect(source).toContain("bundleMetadata");
  });

  it("uses one custom tooltip for card actions", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");
    const actionButtonMethod = source.slice(source.indexOf("private addCardActionButton"), source.indexOf("private createSvgIcon"));

    expect(actionButtonMethod).toContain("skillhub-action-tooltip");
    expect(actionButtonMethod).not.toContain('"aria-label"');
  });

  it("renders collection skills as full reorderable skill cards", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");

    expect(source).toContain("this.renderCard(grid, skill, collection)");
    expect(source).toContain("skillhub-chips");
    expect(source).toContain("skillhub-card-actions");
    expect(source).toContain("application/x-skillhub-collection-skill-id");
    expect(source).toContain("reorderCollectionSkill");
    expect(source).toContain("collection.skillIds = reorderedSkillIds");
  });

  it("labels folders without triggering Obsidian's native aria-label tooltip", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");
    const folderMethod = source.slice(source.indexOf("private createFolderTile"), source.indexOf("private configureCollectionDropTarget"));

    expect(folderMethod).toContain("aria-labelledby");
    expect(folderMethod).not.toContain('setAttribute("aria-label",');
  });

  it("removes collection skills by drag-out and from the collection edit modal", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");
    const modalSource = await readFile(new URL("../src/ui/modals.ts", import.meta.url), "utf8");

    expect(source).toContain("pendingCollectionDrag");
    expect(source).toContain("dragend");
    expect(source).toContain("removeSkillFromCollection");
    expect(source).toContain("applyCollectionSkillIds");
    expect(modalSource).toContain("skillhub-collection-edit-skills");
    expect(modalSource).toContain("skillhub-collection-edit-skill-remove");
    expect(modalSource).toContain("skillIds");
  });

  it("installs individual skills and collections from action icons", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");

    expect(source).toContain("type CardActionIcon = \"install\" | \"pin\" | \"details\" | \"edit\" | \"delete\"");
    expect(source).toContain("openInstallSelectionModal");
    expect(source).toContain("installSkill(skill)");
    expect(source).toContain("installCollection(collection)");
    expect(source).toContain("this.addCardActionButton(actions, \"Install\", \"install\"");
  });

  it("includes collections in select mode and resolves selected collections for install", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");

    expect(source).toContain("selectedCollectionIds");
    expect(source).toContain("toggleCollectionSelection");
    expect(source).toContain("toggleSkillSelection");
    expect(source).not.toContain("skillhub-collection-select");
    expect(source).not.toContain("skillhub-card-select");
    expect(source).toContain("getSelectedInstallSkills");
    expect(source).toContain("resolveInstallSkills");
    expect(source).toContain("this.addToolbarButton(toolbar, \"Install\", \"download\", () => this.installSelectedSkills())");
  });

  it("offers an install picker when nothing is selected", async () => {
    const source = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");
    const modalSource = await readFile(new URL("../src/ui/modals.ts", import.meta.url), "utf8");

    expect(source).toContain("InstallSelectionModal");
    expect(source).toContain("openInstallSelectionModal");
    expect(modalSource).toContain("InstallSelectionModal");
    expect(modalSource).toContain("skillhub-install-selection");
    expect(modalSource).toContain("collectionIds");
  });

  it("registers a custom skill hub icon for the ribbon and tab", async () => {
    const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    const viewSource = await readFile(new URL("../src/ui/SkillHubView.ts", import.meta.url), "utf8");

    expect(mainSource).toContain("addIcon");
    expect(mainSource).toContain("SKILL_HUB_ICON_ID");
    expect(mainSource).toContain("this.addRibbonIcon(SKILL_HUB_ICON_ID");
    expect(mainSource).toContain("currentColor");
    expect(viewSource).toContain("getIcon(): string");
    expect(viewSource).toContain("return SKILL_HUB_ICON_ID");
  });
});
