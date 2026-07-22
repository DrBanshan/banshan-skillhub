import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { createSkillEvent } from "../events";
import type SkillHubPlugin from "../main";
import { collectTagColors } from "../registry";
import { deriveSkillBundles, type SkillBundle } from "../skillBundles";
import type { SkillCollection, SkillRecord } from "../types";
import {
  BundleDetailModal,
  BundleEditModal,
  BulkCollectionMembershipModal,
  BulkDeleteConfirmationModal,
  CollectionDeleteConfirmationModal,
  CollectionDetailModal,
  CollectionEditModal,
  CollectionManagerModal,
  DeleteConfirmationModal,
  GitHubUrlModal,
  InstallSelectionModal,
  NpxCommandModal,
  SkillDetailModal,
  SkillEditModal
} from "./modals";

export const VIEW_TYPE_SKILL_HUB = "banshan-skillhub-view";
export const SKILL_HUB_ICON_ID = "banshan-skillhub";
const FOLDER_DRAG_TYPE = "application/x-skillhub-folder-id";
type CardActionIcon = "install" | "pin" | "details" | "edit" | "delete";
type ToolbarIcon = "github" | "folder" | "node" | "collections" | "select" | "done" | "download";

export class SkillHubView extends ItemView {
  private readonly selectedSkillIds = new Set<string>();
  private readonly selectedCollectionIds = new Set<string>();
  private pendingCollectionDrag: { collectionId: string; skillId: string; handled: boolean } | undefined;
  private folderBoardResizeObserver: ResizeObserver | undefined;
  private expandedFolderId: string | undefined;
  private selectMode = false;
  private filterQuery = "";

  constructor(leaf: WorkspaceLeaf, private readonly plugin: SkillHubPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_SKILL_HUB;
  }

  getDisplayText(): string {
    return "Skill Hub";
  }

  getIcon(): string {
    return SKILL_HUB_ICON_ID;
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.folderBoardResizeObserver?.disconnect();
  }

  openGitHubImport(): void {
    new GitHubUrlModal(this.app, (url) => this.plugin.importFromGitHub(url)).open();
  }

  openLocalScan(): void {
    void this.plugin.pickAndImportLocalDirectory();
  }

  openNpxImport(): void {
    new NpxCommandModal(this.app, (command) => this.plugin.importFromNpx(command)).open();
  }

  installSelectedSkills(): void {
    const selected = this.getSelectedInstallSkills();
    if (selected.length > 0) {
      void this.plugin.installSkills(selected);
      return;
    }
    this.openInstallSelectionModal();
  }

  render(): void {
    this.removeMissingSelections();
    this.contentEl.empty();
    this.contentEl.addClass("skillhub-root");

    const toolbar = this.contentEl.createDiv({ cls: "skillhub-toolbar" });
    this.addToolbarButton(toolbar, "GitHub import", "github", () => this.openGitHubImport());
    this.addToolbarButton(toolbar, "Local scan", "folder", () => this.openLocalScan());
    this.addToolbarButton(toolbar, "npx import", "node", () => this.openNpxImport());
    this.addToolbarButton(toolbar, "Collections", "collections", () => this.openCollectionManager());
    this.addToolbarButton(toolbar, this.selectMode ? "Done" : "Select", this.selectMode ? "done" : "select", () => this.toggleSelectMode());
    this.addToolbarButton(toolbar, "Install", "download", () => this.installSelectedSkills());

    if (this.selectMode) {
      const bulkToolbar = this.contentEl.createDiv({ cls: "skillhub-toolbar skillhub-bulk-toolbar" });
      bulkToolbar.createSpan({ cls: "skillhub-selection-count", text: `${this.selectedSkillIds.size + this.selectedCollectionIds.size} selected` });
      this.addButton(bulkToolbar, "Update collections", () => this.openBulkCollections(), this.selectedSkillIds.size === 0);
      this.addButton(bulkToolbar, "Delete selected", () => this.openBulkDelete(), this.selectedSkillIds.size === 0);
    }

    const controls = this.contentEl.createDiv({ cls: "skillhub-controls" });
    const filter = controls.createEl("input", {
      type: "search",
      cls: "skillhub-filter",
      attr: { placeholder: "Filter skills", "aria-label": "Filter skills" }
    });
    filter.value = this.filterQuery;
    const sort = controls.createEl("select", { cls: "skillhub-sort", attr: { "aria-label": "Sort skills" } });
    this.addSortOption(sort, "nickname", "Nickname");
    this.addSortOption(sort, "originalName", "Original name");
    this.addSortOption(sort, "updatedAt", "Recently updated");
    this.addSortOption(sort, "custom", "Custom order");
    sort.value = this.plugin.data.settings.defaultSort;

    const results = this.contentEl.createDiv();
    filter.addEventListener("input", () => {
      this.filterQuery = filter.value;
      this.renderSkillGrid(results);
    });
    sort.addEventListener("change", () => {
      this.plugin.data.settings.defaultSort = sort.value as typeof this.plugin.data.settings.defaultSort;
      void this.plugin.saveSkillHubData();
      this.renderSkillGrid(results);
    });
    this.renderSkillGrid(results);
  }

  private renderSkillGrid(container: HTMLElement): void {
    this.folderBoardResizeObserver?.disconnect();
    this.folderBoardResizeObserver = undefined;
    container.empty();
    const visibleSkills = this.getVisibleSkills();
    const visibleSkillIds = new Set(visibleSkills.map((skill) => skill.id));
    const bundles = deriveSkillBundles(Object.values(this.plugin.registry.data.skills), this.plugin.registry.data.bundleMetadata);
    const bundledSkillIds = new Set(bundles.flatMap((bundle) => bundle.skills.map((skill) => skill.id)));
    const query = this.filterQuery.trim().toLocaleLowerCase();
    const visibleBundles = bundles.map((bundle) => ({
      bundle,
      skills: this.sortSkills(
        query && [bundle.name, bundle.sourceLabel, bundle.sourceValue].some((value) => value.toLocaleLowerCase().includes(query))
          ? bundle.skills
          : bundle.skills.filter((skill) => visibleSkillIds.has(skill.id))
      )
    })).filter(({ skills }) => skills.length > 0);
    const standaloneSkills = visibleSkills.filter((skill) => !bundledSkillIds.has(skill.id));
    const collections = Object.values(this.plugin.registry.data.collections)
      .sort((left, right) => left.name.localeCompare(right.name));

    if (standaloneSkills.length === 0 && visibleBundles.length === 0 && collections.length === 0) {
      container.createEl("p", {
        cls: "skillhub-empty",
        text: Object.keys(this.plugin.registry.data.skills).length === 0 ? "No skills installed yet." : "No skills match this filter."
      });
      return;
    }

    if (standaloneSkills.length > 0) {
      const grid = container.createDiv({ cls: "skillhub-grid" });
      for (const skill of standaloneSkills) this.renderCard(grid, skill);
    }
    this.renderFolderBoard(container, visibleBundles, collections);
  }

  private renderCard(grid: HTMLElement, skill: SkillRecord, collection?: SkillCollection): void {
    const selected = this.selectedSkillIds.has(skill.id);
    const card = grid.createDiv({ cls: `skillhub-card${selected ? " is-selected" : ""}` });
    if (this.selectMode) this.configureSelectableBlock(card, selected, () => this.toggleSkillSelection(skill.id));
    card.draggable = Boolean(collection) || this.isCustomSort() || this.hasCollections();
    if (card.draggable) {
      card.addClass("is-draggable");
      card.addEventListener("dragstart", (event) => {
        if (collection) {
          this.pendingCollectionDrag = { collectionId: collection.id, skillId: skill.id, handled: false };
          event.dataTransfer?.setData("application/x-skillhub-collection-skill-id", skill.id);
          event.dataTransfer?.setData("application/x-skillhub-collection-id", collection.id);
        }
        event.dataTransfer?.setData("text/plain", skill.id);
        event.dataTransfer?.setData("application/x-skillhub-skill-id", skill.id);
        event.dataTransfer?.setDragImage(card, 20, 20);
      });
      if (collection || this.isCustomSort()) {
        card.addEventListener("dragover", (event) => {
          event.preventDefault();
          if (collection) event.stopPropagation();
          card.addClass("is-drop-target");
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        });
        card.addEventListener("dragleave", () => card.removeClass("is-drop-target"));
        card.addEventListener("drop", (event) => {
          event.preventDefault();
          if (collection) event.stopPropagation();
          card.removeClass("is-drop-target");
          if (collection) {
            const draggedCollectionId = event.dataTransfer?.getData("application/x-skillhub-collection-id");
            const draggedCollectionSkillId = event.dataTransfer?.getData("application/x-skillhub-collection-skill-id");
            if (draggedCollectionId === collection.id && draggedCollectionSkillId) {
              this.markCollectionDragHandled();
              void this.reorderCollectionSkill(collection.id, draggedCollectionSkillId, skill.id, this.shouldDropAfter(card, event));
              return;
            }
            const droppedSkillId = event.dataTransfer?.getData("application/x-skillhub-skill-id");
            if (droppedSkillId) {
              this.markCollectionDragHandled();
              void this.handleCollectionDrop(droppedSkillId, collection.id);
            }
            return;
          }
          const draggedSkillId = event.dataTransfer?.getData("application/x-skillhub-skill-id") || event.dataTransfer?.getData("text/plain");
          if (draggedSkillId) void this.reorderSkill(draggedSkillId, skill.id, this.shouldDropAfter(card, event));
        });
      }
      if (collection) {
        card.addEventListener("dragend", () => {
          const pendingCollectionDrag = this.pendingCollectionDrag;
          if (pendingCollectionDrag?.collectionId === collection.id && pendingCollectionDrag.skillId === skill.id && !pendingCollectionDrag.handled) {
            void this.removeSkillFromCollection(skill.id, collection.id);
          }
          this.pendingCollectionDrag = undefined;
        });
      }
    }
    if (skill.color) card.style.setProperty("--skillhub-card-color", skill.color);
    card.createEl("strong", { text: `${skill.emoji ? `${skill.emoji} ` : ""}${skill.nickname}` });
    if (skill.originalName !== skill.nickname) card.createSpan({ cls: "skillhub-original-name", text: skill.originalName });
    const chips = card.createDiv({ cls: "skillhub-chips" });
    for (const tag of skill.tags) this.renderTagChip(chips, skill, tag);
    if (skill.warnings.length > 0) {
      chips.createSpan({ cls: "skillhub-chip is-warning", text: `${skill.warnings.length} warning${skill.warnings.length === 1 ? "" : "s"}` });
    }

    const actions = card.createDiv({ cls: "skillhub-card-actions" });
    this.addCardActionButton(actions, "Install", "install", () => this.installSkill(skill));
    this.addCardActionButton(actions, "Details", "details", () => this.openDetailModal(skill));
    this.addCardActionButton(actions, "Edit", "edit", () => this.openEditModal(skill));
    this.addCardActionButton(actions, "Delete", "delete", () => this.openDeleteModal(skill));
  }

  private renderFolderBoard(
    container: HTMLElement,
    bundles: Array<{ bundle: SkillBundle; skills: SkillRecord[] }>,
    collections: SkillCollection[]
  ): void {
    if (bundles.length === 0 && collections.length === 0) return;
    const board = container.createDiv({ cls: "skillhub-folder-board" });
    const folders = [
      ...bundles.map(({ bundle, skills }) => ({
        id: bundle.id,
        name: bundle.name,
        renderFolder: () => this.renderBundleFolder(board, bundle),
        renderExpansion: () => this.renderBundleExpansion(board, bundle, skills)
      })),
      ...collections.map((collection) => ({
        id: this.getCollectionFolderId(collection.id),
        name: collection.name,
        renderFolder: () => this.renderCollectionFolder(board, collection),
        renderExpansion: () => this.renderCollectionExpansion(board, collection)
      }))
    ];
    const orderIndex = new Map(this.plugin.registry.data.folderOrder.map((id, index) => [id, index]));
    folders.sort((left, right) => {
      const pinOrder = Number(this.isFolderPinned(right.id)) - Number(this.isFolderPinned(left.id));
      const customOrder = (orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER);
      return pinOrder || customOrder || left.name.localeCompare(right.name);
    });
    for (const folder of folders) folder.renderFolder();

    const expandedFolderIndex = folders.findIndex((folder) => folder.id === this.expandedFolderId);
    if (expandedFolderIndex === -1) return;
    const expansion = folders[expandedFolderIndex].renderExpansion();
    const positionExpansion = (): void => {
      if (!board.isConnected) return;
      const columns = window.getComputedStyle(board).gridTemplateColumns.split(" ").filter((column) => column && column !== "none");
      const columnCount = Math.max(1, columns.length);
      expansion.style.gridRow = String(Math.floor(expandedFolderIndex / columnCount) + 2);
    };
    positionExpansion();
    this.folderBoardResizeObserver = new ResizeObserver(positionExpansion);
    this.folderBoardResizeObserver.observe(board);
  }

  private renderBundleFolder(board: HTMLElement, bundle: SkillBundle): void {
    const selected = bundle.skills.every((skill) => this.selectedSkillIds.has(skill.id));
    const folder = this.createFolderTile(board, {
      id: bundle.id,
      title: bundle.name,
      count: bundle.skills.length,
      selected,
      onToggle: () => this.toggleExpandedFolder(bundle.id),
      onSelect: () => this.toggleBundleSelection(bundle),
      renderActions: (actions) => {
        this.addCardActionButton(actions, "Install", "install", () => this.installBundle(bundle));
        this.addCardActionButton(actions, this.isFolderPinned(bundle.id) ? "Unpin" : "Pin", "pin", () => void this.toggleFolderPin(bundle.id), this.isFolderPinned(bundle.id));
        this.addCardActionButton(actions, "Details", "details", () => this.openBundleDetailModal(bundle));
        this.addCardActionButton(actions, "Edit", "edit", () => this.openBundleEditModal(bundle));
        this.addCardActionButton(actions, "Delete", "delete", () => this.openBundleDeleteModal(bundle));
      }
    });
    folder.addClass("is-bundle");
    if (bundle.color) folder.style.setProperty("--skillhub-folder-color", bundle.color);
  }

  private renderBundleExpansion(board: HTMLElement, bundle: SkillBundle, visibleSkills: SkillRecord[]): HTMLElement {
    const expansion = board.createDiv({ cls: "skillhub-folder-expansion is-bundle" });
    if (bundle.color) expansion.style.setProperty("--skillhub-folder-color", bundle.color);
    const header = expansion.createDiv({ cls: "skillhub-folder-expansion-header" });
    header.createEl("strong", { text: bundle.name });
    header.createSpan({ text: bundle.sourceLabel });
    if (bundle.description) expansion.createEl("p", { cls: "skillhub-collection-description", text: bundle.description });
    const grid = expansion.createDiv({ cls: "skillhub-grid skillhub-folder-expanded-grid" });
    for (const skill of visibleSkills) this.renderCard(grid, skill);
    return expansion;
  }

  private renderCollectionFolder(board: HTMLElement, collection: SkillCollection): void {
    const selected = this.selectedCollectionIds.has(collection.id);
    const folderId = this.getCollectionFolderId(collection.id);
    const folder = this.createFolderTile(board, {
      id: folderId,
      title: collection.name,
      count: collection.skillIds.length,
      selected,
      onToggle: () => this.toggleExpandedFolder(folderId),
      onSelect: () => this.toggleCollectionSelection(collection.id),
      renderActions: (actions) => {
        this.addCardActionButton(actions, "Install", "install", () => this.installCollection(collection));
        this.addCardActionButton(actions, this.isFolderPinned(folderId) ? "Unpin" : "Pin", "pin", () => void this.toggleFolderPin(folderId), this.isFolderPinned(folderId));
        this.addCardActionButton(actions, "Details", "details", () => this.openCollectionDetailModal(collection));
        this.addCardActionButton(actions, "Edit", "edit", () => this.openCollectionEditModal(collection));
        this.addCardActionButton(actions, "Delete", "delete", () => this.openCollectionDeleteModal(collection));
      }
    });
    folder.addClass("is-collection");
    if (collection.color) folder.style.setProperty("--skillhub-folder-color", collection.color);
    this.configureCollectionDropTarget(folder, collection.id);
  }

  private renderCollectionExpansion(board: HTMLElement, collection: SkillCollection): HTMLElement {
    const expansion = board.createDiv({ cls: "skillhub-folder-expansion is-collection" });
    if (collection.color) expansion.style.setProperty("--skillhub-collection-color", collection.color);
    this.configureCollectionDropTarget(expansion, collection.id);
    const header = expansion.createDiv({ cls: "skillhub-folder-expansion-header" });
    header.createEl("strong", { text: collection.name });
    header.createSpan({ text: `${collection.skillIds.length} skill${collection.skillIds.length === 1 ? "" : "s"}` });
    if (collection.description) expansion.createEl("p", { cls: "skillhub-collection-description", text: collection.description });
    const memberSkills = this.getCollectionSkills(collection);
    if (memberSkills.length === 0) {
      expansion.createSpan({ cls: "skillhub-collection-empty", text: "Drop skills here" });
    } else {
      const grid = expansion.createDiv({ cls: "skillhub-grid skillhub-folder-expanded-grid" });
      for (const skill of memberSkills) this.renderCard(grid, skill, collection);
    }
    return expansion;
  }

  private createFolderTile(
    board: HTMLElement,
    options: {
      id: string;
      title: string;
      count: number;
      selected: boolean;
      onToggle: () => void;
      onSelect: () => void;
      renderActions: (actions: HTMLElement) => void;
    }
  ): HTMLElement {
    const expanded = this.expandedFolderId === options.id;
    const folder = board.createDiv({ cls: `skillhub-folder${expanded ? " is-expanded" : ""}${options.selected ? " is-selected" : ""}` });
    folder.setAttribute("role", "button");
    folder.setAttribute("tabindex", "0");
    folder.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (this.selectMode) {
      this.configureSelectableBlock(folder, options.selected, options.onSelect);
    } else {
      folder.draggable = true;
      folder.addClass("is-draggable");
      folder.addEventListener("dragstart", (event) => {
        if (this.isInteractiveSelectionTarget(event.target)) {
          event.preventDefault();
          return;
        }
        event.dataTransfer?.setData(FOLDER_DRAG_TYPE, options.id);
        event.dataTransfer?.setDragImage(folder, 20, 20);
      });
      folder.addEventListener("dragover", (event) => {
        if (!this.hasDataTransferType(event, FOLDER_DRAG_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        const dropAfter = this.shouldDropAfter(folder, event);
        folder.removeClass(dropAfter ? "is-folder-drop-before" : "is-folder-drop-after");
        folder.addClass(dropAfter ? "is-folder-drop-after" : "is-folder-drop-before");
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      });
      folder.addEventListener("dragleave", () => this.clearFolderDropIndicator(folder));
      folder.addEventListener("drop", (event) => {
        const draggedFolderId = event.dataTransfer?.getData(FOLDER_DRAG_TYPE);
        if (!draggedFolderId) return;
        event.preventDefault();
        event.stopPropagation();
        const dropAfter = this.shouldDropAfter(folder, event);
        this.clearFolderDropIndicator(folder);
        void this.reorderFolder(draggedFolderId, options.id, dropAfter);
      });
      folder.addEventListener("click", (event) => {
        if (this.isInteractiveSelectionTarget(event.target)) return;
        options.onToggle();
      });
      folder.addEventListener("keydown", (event) => {
        if (this.isInteractiveSelectionTarget(event.target)) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        options.onToggle();
      });
    }

    const shape = folder.createDiv({ cls: "skillhub-folder__shape" });
    shape.createDiv({ cls: "skillhub-folder__back" });
    const papers = shape.createDiv({ cls: "skillhub-folder__papers" });
    papers.createSpan({ cls: "skillhub-folder__paper skillhub-folder__paper--1" });
    papers.createSpan({ cls: "skillhub-folder__paper skillhub-folder__paper--2" });
    papers.createSpan({ cls: "skillhub-folder__paper skillhub-folder__paper--3" });
    shape.createDiv({ cls: "skillhub-folder__front" });
    const meta = folder.createDiv({ cls: "skillhub-folder__meta" });
    const titleEl = meta.createSpan({ cls: "skillhub-folder__title", text: options.title });
    const countEl = meta.createSpan({ cls: "skillhub-folder__count", text: `${options.count} skill${options.count === 1 ? "" : "s"}` });
    const labelId = `skillhub-folder-${encodeURIComponent(options.id)}`;
    titleEl.id = `${labelId}-title`;
    countEl.id = `${labelId}-count`;
    folder.setAttribute("aria-labelledby", `${titleEl.id} ${countEl.id}`);
    const actions = folder.createDiv({ cls: "skillhub-folder-actions" });
    options.renderActions(actions);
    return folder;
  }

  private configureCollectionDropTarget(element: HTMLElement, collectionId: string): void {
    element.addEventListener("dragover", (event) => {
      if (!this.hasDataTransferType(event, "application/x-skillhub-skill-id")) return;
      event.preventDefault();
      element.addClass("is-drop-target");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    element.addEventListener("dragleave", () => element.removeClass("is-drop-target"));
    element.addEventListener("drop", (event) => {
      if (!this.hasDataTransferType(event, "application/x-skillhub-skill-id")) return;
      event.preventDefault();
      element.removeClass("is-drop-target");
      const skillId = event.dataTransfer?.getData("application/x-skillhub-skill-id") || event.dataTransfer?.getData("text/plain");
      if (skillId) {
        this.markCollectionDragHandled();
        void this.handleCollectionDrop(skillId, collectionId);
      }
    });
  }

  private openDetailModal(skill: SkillRecord): void {
    new SkillDetailModal(this.app, skill, Object.values(this.plugin.registry.data.collections)).open();
  }

  private installSkill(skill: SkillRecord): void {
    void this.plugin.installSkills([skill]);
  }

  private installBundle(bundle: SkillBundle): void {
    void this.plugin.installSkills(bundle.skills);
  }

  private installCollection(collection: SkillCollection): void {
    const skills = this.getCollectionSkills(collection);
    if (skills.length === 0) {
      new Notice("Collection has no skills to install.");
      return;
    }
    void this.plugin.installSkills(skills);
  }

  private openEditModal(skill: SkillRecord): void {
    this.plugin.registry.data.tagColors = collectTagColors(this.plugin.registry.data);
    new SkillEditModal(this.app, skill, Object.values(this.plugin.registry.data.collections), this.getAllTags(), this.plugin.registry.data.tagColors, async (values) => {
      skill.nickname = values.nickname;
      skill.emoji = values.emoji;
      skill.color = values.color;
      skill.tags = values.tags;
      delete skill.tagColors;
      this.plugin.registry.data.tagColors = values.tagColors;
      this.plugin.registry.updateSkillCollections(skill.id, values.collectionIds);
      skill.updatedAt = new Date().toISOString();
      await this.plugin.saveSkillHubData();
      this.render();
    }).open();
  }

  private renderTagChip(chips: HTMLElement, skill: SkillRecord, tag: string): void {
    const chip = chips.createSpan({ cls: "skillhub-chip", text: tag });
    const tagColor = this.plugin.registry.data.tagColors[tag];
    if (tagColor) {
      chip.addClass("has-color");
      chip.style.setProperty("--skillhub-tag-color", tagColor);
    }
  }

  private getAllTags(): string[] {
    const tags = new Set(Object.keys(this.plugin.registry.data.tagColors));
    for (const skill of Object.values(this.plugin.registry.data.skills)) {
      for (const tag of skill.tags) tags.add(tag);
    }
    return [...tags].sort((left, right) => left.localeCompare(right));
  }

  private openDeleteModal(skill: SkillRecord): void {
    new DeleteConfirmationModal(this.app, skill, async () => {
      try {
        await this.plugin.deleteSkill(skill);
        this.selectedSkillIds.delete(skill.id);
        this.render();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  private openBundleDetailModal(bundle: SkillBundle): void {
    new BundleDetailModal(this.app, bundle).open();
  }

  private openBundleEditModal(bundle: SkillBundle): void {
    new BundleEditModal(this.app, bundle, async (values) => {
      const previous = this.plugin.registry.data.bundleMetadata[bundle.id];
      const retainedSkillIds = new Set(values.skillIds);
      const excludedSkillIds = new Set(previous?.excludedSkillIds ?? []);
      for (const skill of bundle.skills) {
        if (!retainedSkillIds.has(skill.id)) excludedSkillIds.add(skill.id);
      }
      this.plugin.registry.data.bundleMetadata[bundle.id] = {
        name: values.name,
        description: values.description,
        color: values.color,
        excludedSkillIds: [...excludedSkillIds]
      };
      await this.plugin.saveSkillHubData();
      this.render();
    }).open();
  }

  private openBundleDeleteModal(bundle: SkillBundle): void {
    new BulkDeleteConfirmationModal(this.app, bundle.skills, async () => {
      try {
        await this.plugin.deleteSkills(bundle.skills);
        delete this.plugin.registry.data.bundleMetadata[bundle.id];
        this.removeFolderPin(bundle.id);
        this.removeFolderOrder(bundle.id);
        for (const skill of bundle.skills) this.selectedSkillIds.delete(skill.id);
        if (this.expandedFolderId === bundle.id) this.expandedFolderId = undefined;
        await this.plugin.saveSkillHubData();
        this.render();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  private openCollectionDetailModal(collection: SkillCollection): void {
    new CollectionDetailModal(this.app, collection, this.getCollectionSkills(collection)).open();
  }

  private openCollectionEditModal(collection: SkillCollection): void {
    new CollectionEditModal(this.app, collection, async (values) => {
      this.plugin.registry.saveCollection({ ...collection, ...values, skillIds: values.skillIds ?? collection.skillIds });
      if (values.skillIds) this.applyCollectionSkillIds(collection.id, values.skillIds);
      this.plugin.registry.recordEvent(createSkillEvent("collection_saved", undefined, { collectionId: collection.id }));
      await this.plugin.saveSkillHubData();
      this.render();
    }, this.getCollectionSkills(collection)).open();
  }

  private openCollectionDeleteModal(collection: SkillCollection): void {
    new CollectionDeleteConfirmationModal(this.app, collection, () => this.deleteCollection(collection)).open();
  }

  private async deleteCollection(collection: SkillCollection): Promise<void> {
    this.plugin.registry.deleteCollection(collection.id);
    const folderId = this.getCollectionFolderId(collection.id);
    this.removeFolderPin(folderId);
    this.removeFolderOrder(folderId);
    if (this.expandedFolderId === folderId) this.expandedFolderId = undefined;
    this.plugin.registry.recordEvent(createSkillEvent("collection_deleted", undefined, { collectionId: collection.id }));
    await this.plugin.saveSkillHubData();
    this.render();
  }

  private async handleCollectionDrop(skillId: string, collectionId: string): Promise<void> {
    const skill = this.plugin.registry.data.skills[skillId];
    const collection = this.plugin.registry.data.collections[collectionId];
    if (!skill || !collection || skill.collectionIds.includes(collectionId)) return;

    this.plugin.registry.updateSkillCollections(skillId, [...skill.collectionIds, collectionId]);
    skill.updatedAt = new Date().toISOString();
    this.plugin.registry.recordEvent(createSkillEvent("collection_saved", undefined, { collectionId, skillId }));
    await this.plugin.saveSkillHubData();
    this.render();
  }

  private async removeSkillFromCollection(skillId: string, collectionId: string): Promise<void> {
    const skill = this.plugin.registry.data.skills[skillId];
    if (!skill?.collectionIds.includes(collectionId)) return;

    this.plugin.registry.updateSkillCollections(skillId, skill.collectionIds.filter((id) => id !== collectionId));
    skill.updatedAt = new Date().toISOString();
    this.plugin.registry.recordEvent(createSkillEvent("collection_saved", undefined, { collectionId, skillId }));
    await this.plugin.saveSkillHubData();
    this.render();
  }

  private applyCollectionSkillIds(collectionId: string, skillIds: string[]): void {
    const collection = this.plugin.registry.data.collections[collectionId];
    if (!collection) return;

    const validSkillIds = [...new Set(skillIds)].filter((skillId) => Boolean(this.plugin.registry.data.skills[skillId]));
    const selectedSkillIds = new Set(validSkillIds);
    collection.skillIds = validSkillIds;
    for (const skill of Object.values(this.plugin.registry.data.skills)) {
      if (selectedSkillIds.has(skill.id)) {
        if (!skill.collectionIds.includes(collectionId)) skill.collectionIds.push(collectionId);
      } else {
        skill.collectionIds = skill.collectionIds.filter((id) => id !== collectionId);
      }
      skill.updatedAt = new Date().toISOString();
    }
  }

  private async reorderCollectionSkill(collectionId: string, draggedSkillId: string, targetSkillId: string, afterTarget: boolean): Promise<void> {
    const collection = this.plugin.registry.data.collections[collectionId];
    if (!collection || draggedSkillId === targetSkillId || !collection.skillIds.includes(draggedSkillId) || !collection.skillIds.includes(targetSkillId)) return;

    const reorderedSkillIds = collection.skillIds.filter((skillId) => skillId !== draggedSkillId);
    const targetIndex = reorderedSkillIds.indexOf(targetSkillId);
    if (targetIndex === -1) return;

    reorderedSkillIds.splice(targetIndex + (afterTarget ? 1 : 0), 0, draggedSkillId);
    collection.skillIds = reorderedSkillIds;
    this.plugin.registry.recordEvent(createSkillEvent("collection_saved", undefined, { collectionId, skillId: draggedSkillId }));
    await this.plugin.saveSkillHubData();
    this.render();
  }

  private markCollectionDragHandled(): void {
    if (this.pendingCollectionDrag) this.pendingCollectionDrag.handled = true;
  }

  private configureSelectableBlock(element: HTMLElement, selected: boolean, onToggle: () => void): void {
    element.addClass("is-selectable");
    element.setAttribute("role", "button");
    element.setAttribute("tabindex", "0");
    element.setAttribute("aria-pressed", selected ? "true" : "false");
    element.addEventListener("click", (event) => {
      if (this.isInteractiveSelectionTarget(event.target)) return;
      onToggle();
    });
    element.addEventListener("keydown", (event) => {
      if (this.isInteractiveSelectionTarget(event.target)) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onToggle();
    });
  }

  private isInteractiveSelectionTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && Boolean(target.closest("button, input, select, textarea, a"));
  }

  private toggleSkillSelection(skillId: string): void {
    this.selectedSkillIds.has(skillId) ? this.selectedSkillIds.delete(skillId) : this.selectedSkillIds.add(skillId);
    this.render();
  }

  private toggleSelectMode(): void {
    this.selectMode = !this.selectMode;
    if (!this.selectMode) {
      this.selectedSkillIds.clear();
      this.selectedCollectionIds.clear();
    }
    this.render();
  }

  private toggleBundleSelection(bundle: SkillBundle): void {
    const allSelected = bundle.skills.every((skill) => this.selectedSkillIds.has(skill.id));
    for (const skill of bundle.skills) {
      allSelected ? this.selectedSkillIds.delete(skill.id) : this.selectedSkillIds.add(skill.id);
    }
    this.render();
  }

  private toggleCollectionSelection(collectionId: string): void {
    this.selectedCollectionIds.has(collectionId) ? this.selectedCollectionIds.delete(collectionId) : this.selectedCollectionIds.add(collectionId);
    this.render();
  }

  private toggleExpandedFolder(folderId: string): void {
    this.expandedFolderId = this.expandedFolderId === folderId ? undefined : folderId;
    this.render();
  }

  private getCollectionFolderId(collectionId: string): string {
    return `collection:${collectionId}`;
  }

  private hasDataTransferType(event: DragEvent, type: string): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes(type);
  }

  private clearFolderDropIndicator(folder: HTMLElement): void {
    folder.removeClass("is-folder-drop-before");
    folder.removeClass("is-folder-drop-after");
  }

  private isFolderPinned(folderId: string): boolean {
    return this.plugin.registry.data.pinnedFolderIds.includes(folderId);
  }

  private async toggleFolderPin(folderId: string): Promise<void> {
    if (this.isFolderPinned(folderId)) {
      this.removeFolderPin(folderId);
    } else {
      this.plugin.registry.data.pinnedFolderIds.push(folderId);
    }
    await this.plugin.saveSkillHubData();
    this.render();
  }

  private removeFolderPin(folderId: string): void {
    this.plugin.registry.data.pinnedFolderIds = this.plugin.registry.data.pinnedFolderIds.filter((id) => id !== folderId);
  }

  private async reorderFolder(draggedFolderId: string, targetFolderId: string, afterTarget: boolean): Promise<void> {
    if (draggedFolderId === targetFolderId) return;
    const bundleIds = deriveSkillBundles(
      Object.values(this.plugin.registry.data.skills),
      this.plugin.registry.data.bundleMetadata
    ).map((bundle) => bundle.id);
    const collectionIds = Object.values(this.plugin.registry.data.collections)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((collection) => this.getCollectionFolderId(collection.id));
    const knownFolderIds = new Set([...bundleIds, ...collectionIds]);
    if (!knownFolderIds.has(draggedFolderId) || !knownFolderIds.has(targetFolderId)) return;
    const orderedFolderIds = [
      ...this.plugin.registry.data.folderOrder.filter((id) => knownFolderIds.has(id)),
      ...[...bundleIds, ...collectionIds].filter((id) => !this.plugin.registry.data.folderOrder.includes(id))
    ].filter((id) => id !== draggedFolderId);
    const targetIndex = orderedFolderIds.indexOf(targetFolderId);
    if (targetIndex === -1) return;
    orderedFolderIds.splice(targetIndex + (afterTarget ? 1 : 0), 0, draggedFolderId);
    this.plugin.registry.data.folderOrder = orderedFolderIds;
    await this.plugin.saveSkillHubData();
    this.render();
  }

  private removeFolderOrder(folderId: string): void {
    this.plugin.registry.data.folderOrder = this.plugin.registry.data.folderOrder.filter((id) => id !== folderId);
  }

  private openBulkDelete(): void {
    const records = this.getSelectedSkills();
    new BulkDeleteConfirmationModal(this.app, records, async () => {
      try {
        await this.plugin.deleteSkills(records);
        this.selectedSkillIds.clear();
        this.render();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  private openBulkCollections(): void {
    const records = this.getSelectedSkills();
    const collections = Object.values(this.plugin.registry.data.collections);
    if (collections.length === 0) {
      new Notice("Create a collection first.");
      return;
    }
    new BulkCollectionMembershipModal(this.app, collections, async ({ action, collectionIds }) => {
      for (const record of records) {
        const memberships = new Set(record.collectionIds);
        for (const collectionId of collectionIds) action === "add" ? memberships.add(collectionId) : memberships.delete(collectionId);
        this.plugin.registry.updateSkillCollections(record.id, [...memberships]);
        record.updatedAt = new Date().toISOString();
      }
      await this.plugin.saveSkillHubData();
      this.render();
    }).open();
  }

  private openInstallSelectionModal(): void {
    new InstallSelectionModal(
      this.app,
      Object.values(this.plugin.registry.data.skills),
      Object.values(this.plugin.registry.data.collections),
      async ({ skillIds, collectionIds }) => {
        const records = this.resolveInstallSkills(skillIds, collectionIds);
        if (records.length === 0) {
          new Notice("Select at least one skill or collection to install.");
          return;
        }
        await this.plugin.installSkills(records);
      }
    ).open();
  }

  private openCollectionManager(): void {
    new CollectionManagerModal(this.app, () => Object.values(this.plugin.registry.data.collections), {
      create: async (values) => {
        const collection: SkillCollection = {
          id: `collection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          ...values,
          skillIds: []
        };
        this.plugin.registry.saveCollection(collection);
        this.plugin.registry.recordEvent(createSkillEvent("collection_saved", undefined, { collectionId: collection.id }));
        await this.plugin.saveSkillHubData();
        this.render();
      },
      update: async (collection, values) => {
        this.plugin.registry.saveCollection({ ...collection, ...values });
        this.plugin.registry.recordEvent(createSkillEvent("collection_saved", undefined, { collectionId: collection.id }));
        await this.plugin.saveSkillHubData();
        this.render();
      },
      delete: (collection) => this.deleteCollection(collection)
    }).open();
  }

  private getSelectedSkills(): SkillRecord[] {
    return Object.values(this.plugin.registry.data.skills).filter((skill) => this.selectedSkillIds.has(skill.id));
  }

  private getSelectedInstallSkills(): SkillRecord[] {
    return this.resolveInstallSkills([...this.selectedSkillIds], [...this.selectedCollectionIds]);
  }

  private resolveInstallSkills(skillIds: string[], collectionIds: string[]): SkillRecord[] {
    const resolvedSkillIds = new Set<string>();
    for (const skillId of skillIds) {
      if (this.plugin.registry.data.skills[skillId]) resolvedSkillIds.add(skillId);
    }
    for (const collectionId of collectionIds) {
      const collection = this.plugin.registry.data.collections[collectionId];
      if (!collection) continue;
      for (const skillId of collection.skillIds) {
        if (this.plugin.registry.data.skills[skillId]) resolvedSkillIds.add(skillId);
      }
    }
    return [...resolvedSkillIds].map((skillId) => this.plugin.registry.data.skills[skillId]);
  }

  private getVisibleSkills(): SkillRecord[] {
    const query = this.filterQuery.trim().toLocaleLowerCase();
    const collections = this.plugin.registry.data.collections;
    const visibleSkills = Object.values(this.plugin.registry.data.skills)
      .filter((skill) => {
        if (!query) return true;
        const collectionNames = skill.collectionIds.map((id) => collections[id]?.name ?? "");
        return [skill.nickname, skill.originalName, skill.description, ...skill.tags, ...collectionNames]
          .some((value) => value.toLocaleLowerCase().includes(query));
      });
    return this.sortSkills(visibleSkills);
  }

  private sortSkills(skills: SkillRecord[]): SkillRecord[] {
    const sort = this.plugin.data.settings.defaultSort;
    if (sort === "custom") return this.sortByCustomOrder(skills);
    return [...skills].sort((left, right) => {
      if (sort === "updatedAt") return right.updatedAt.localeCompare(left.updatedAt);
      return left[sort].localeCompare(right[sort]);
    });
  }

  private sortByCustomOrder(skills: SkillRecord[]): SkillRecord[] {
    const orderIndex = new Map(this.plugin.data.settings.skillOrder.map((id, index) => [id, index]));
    return [...skills].sort((left, right) => {
      const leftIndex = orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return left.nickname.localeCompare(right.nickname);
    });
  }

  private async reorderSkill(draggedSkillId: string, targetSkillId: string, afterTarget: boolean): Promise<void> {
    if (draggedSkillId === targetSkillId || !this.plugin.registry.data.skills[draggedSkillId] || !this.plugin.registry.data.skills[targetSkillId]) return;
    const knownSkillIds = new Set(Object.keys(this.plugin.registry.data.skills));
    const orderedIds = [
      ...this.plugin.data.settings.skillOrder.filter((id) => knownSkillIds.has(id)),
      ...Object.keys(this.plugin.registry.data.skills).filter((id) => !this.plugin.data.settings.skillOrder.includes(id))
    ];
    const withoutDragged = orderedIds.filter((id) => id !== draggedSkillId);
    const targetIndex = withoutDragged.indexOf(targetSkillId);
    if (targetIndex === -1) return;
    withoutDragged.splice(targetIndex + (afterTarget ? 1 : 0), 0, draggedSkillId);
    this.plugin.data.settings.skillOrder = withoutDragged;
    await this.plugin.saveSkillHubData();
    this.render();
  }

  private shouldDropAfter(card: HTMLElement, event: DragEvent): boolean {
    const rect = card.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2 || (
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom &&
      event.clientX > rect.left + rect.width / 2
    );
  }

  private isCustomSort(): boolean {
    return this.plugin.data.settings.defaultSort === "custom";
  }

  private hasCollections(): boolean {
    return Object.keys(this.plugin.registry.data.collections).length > 0;
  }

  private getCollectionSkills(collection: SkillCollection): SkillRecord[] {
    return collection.skillIds
      .map((skillId) => this.plugin.registry.data.skills[skillId])
      .filter((skill): skill is SkillRecord => Boolean(skill));
  }

  private removeMissingSelections(): void {
    for (const id of this.selectedSkillIds) {
      if (!this.plugin.registry.data.skills[id]) this.selectedSkillIds.delete(id);
    }
    for (const id of this.selectedCollectionIds) {
      if (!this.plugin.registry.data.collections[id]) this.selectedCollectionIds.delete(id);
    }
  }

  private addSortOption(select: HTMLSelectElement, value: string, label: string): void {
    select.createEl("option", { text: label, value });
  }

  private addButton(container: HTMLElement, label: string, onClick: () => void, disabled = false): void {
    const button = container.createEl("button", { text: label });
    button.disabled = disabled;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
  }

  private addToolbarButton(container: HTMLElement, label: string, icon: ToolbarIcon, onClick: () => void, disabled = false): void {
    const button = container.createEl("button", {
      cls: "skillhub-toolbar-button",
      attr: { "aria-label": label }
    });
    button.disabled = disabled;
    button.createSpan({ cls: "skillhub-toolbar-label", text: label });
    this.createToolbarIcon(button, icon);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
  }

  private addCardActionButton(container: HTMLElement, label: string, icon: CardActionIcon, onClick: () => void, active = false): void {
    const actionClass = icon === "delete" ? "skillhub-delete-button" : icon === "edit" ? "skillhub-edit-button" : icon === "install" ? "skillhub-install-button" : icon === "pin" ? "skillhub-pin-button" : "skillhub-details-button";
    const button = container.createEl("button", {
      cls: `skillhub-card-action-button ${actionClass}${active ? " is-active" : ""}`,
      attr: { type: "button", ...(icon === "pin" ? { "aria-pressed": String(active) } : {}) }
    });
    button.createSpan({ cls: "skillhub-action-tooltip", text: label });
    this.createSvgIcon(button, icon);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
  }

  private createSvgIcon(container: HTMLElement, icon: CardActionIcon): void {
    const svg = createSvg("svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", icon === "delete" ? "skillhub-action-svg bin" : "skillhub-action-svg");
    container.appendChild(svg);

    if (icon === "install") {
      this.appendSvgElement(svg, "path", { d: "M12 4v10" });
      this.appendSvgElement(svg, "path", { d: "m7 10 5 5 5-5" });
      this.appendSvgElement(svg, "path", { d: "M5 20h14" });
      return;
    }

    if (icon === "pin") {
      this.appendSvgElement(svg, "path", { d: "M12 17v5" });
      this.appendSvgElement(svg, "path", { d: "M5 10l2-2V4h10v4l2 2v2H5v-2Z" });
      return;
    }

    if (icon === "details") {
      this.appendSvgElement(svg, "circle", { cx: "12", cy: "12", r: "8.5" });
      this.appendSvgElement(svg, "path", { d: "M12 10.5v5.5" });
      this.appendSvgElement(svg, "path", { d: "M12 7.5h.01" });
      return;
    }

    if (icon === "edit") {
      this.appendSvgElement(svg, "path", { d: "M5 19h4.2L18.4 9.8a2.1 2.1 0 0 0 0-3L17.2 5.6a2.1 2.1 0 0 0-3 0L5 14.8V19Z" });
      this.appendSvgElement(svg, "path", { d: "M13.5 6.5l4 4" });
      return;
    }

    this.appendSvgElement(svg, "path", { d: "M8 8h8l-.6 10.2A2 2 0 0 1 13.4 20h-2.8a2 2 0 0 1-2-1.8L8 8Z" });
    this.appendSvgElement(svg, "path", { d: "M6 8h12" });
    this.appendSvgElement(svg, "path", { d: "M9.5 8V6.5A1.5 1.5 0 0 1 11 5h2a1.5 1.5 0 0 1 1.5 1.5V8" });
    this.appendSvgElement(svg, "path", { d: "M10.5 11v5" });
    this.appendSvgElement(svg, "path", { d: "M13.5 11v5" });
  }

  private appendSvgElement(svg: SVGElement, tag: "circle" | "path", attrs: Record<string, string>): void {
    const element = createSvg(tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    svg.appendChild(element);
  }

  private createToolbarIcon(container: HTMLElement, icon: ToolbarIcon): void {
    const svg = createSvg("svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", "skillhub-toolbar-icon");
    container.appendChild(svg);

    if (icon === "github") {
      this.appendSvgElement(svg, "path", { d: "M12 2.5a9.5 9.5 0 0 0-3 18c.48.09.65-.2.65-.46v-1.7c-2.64.58-3.2-1.12-3.2-1.12-.43-1.1-1.05-1.4-1.05-1.4-.86-.58.06-.57.06-.57.95.07 1.45.98 1.45.98.84 1.44 2.2 1.02 2.74.78.08-.61.33-1.02.6-1.26-2.1-.24-4.32-1.05-4.32-4.68 0-1.03.37-1.88.98-2.54-.1-.24-.42-1.2.09-2.5 0 0 .8-.26 2.62.97A9.1 9.1 0 0 1 12 6.68c.81 0 1.62.11 2.38.32 1.82-1.23 2.62-.97 2.62-.97.51 1.3.19 2.26.09 2.5.61.66.98 1.51.98 2.54 0 3.64-2.22 4.43-4.33 4.67.34.3.64.87.64 1.76v2.54c0 .26.17.56.66.46a9.5 9.5 0 0 0-3.04-18Z" });
      return;
    }

    if (icon === "folder") {
      this.appendSvgElement(svg, "path", { d: "M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2.5h7.5A2.5 2.5 0 0 1 21 9v7.5A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-10Z" });
      this.appendSvgElement(svg, "path", { d: "m15.5 14.5 2 2" });
      this.appendSvgElement(svg, "circle", { cx: "13", cy: "12", r: "3" });
      return;
    }

    if (icon === "node") {
      this.appendSvgElement(svg, "path", { d: "M12 2.7 20 7.2v9.6l-8 4.5-8-4.5V7.2l8-4.5Z" });
      this.appendSvgElement(svg, "path", { d: "M9.2 15.3c.5.7 1.4 1 2.5 1 1.5 0 2.4-.7 2.4-1.8 0-.9-.5-1.4-1.9-1.7l-1-.2c-.7-.2-1-.4-1-.8 0-.5.5-.8 1.2-.8.8 0 1.3.3 1.6.8" });
      return;
    }

    if (icon === "collections") {
      this.appendSvgElement(svg, "path", { d: "M7 4h11v11H7z" });
      this.appendSvgElement(svg, "path", { d: "M4 7h11v11H4z" });
      this.appendSvgElement(svg, "path", { d: "M10 10h5" });
      return;
    }

    if (icon === "select") {
      this.appendSvgElement(svg, "path", { d: "M5 7h14" });
      this.appendSvgElement(svg, "path", { d: "M5 12h14" });
      this.appendSvgElement(svg, "path", { d: "M5 17h14" });
      return;
    }

    if (icon === "done") {
      this.appendSvgElement(svg, "path", { d: "m5 12 4 4L19 6" });
      return;
    }

    this.appendSvgElement(svg, "path", { d: "M12 4v10" });
    this.appendSvgElement(svg, "path", { d: "m7 10 5 5 5-5" });
    this.appendSvgElement(svg, "path", { d: "M5 20h14" });
  }
}
