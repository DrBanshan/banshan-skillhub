import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { createSkillEvent } from "../events";
import type SkillHubPlugin from "../main";
import { collectTagColors } from "../registry";
import type { SkillCollection, SkillRecord } from "../types";
import {
  BulkCollectionMembershipModal,
  BulkDeleteConfirmationModal,
  CollectionManagerModal,
  DeleteConfirmationModal,
  GitHubUrlModal,
  NpxCommandModal,
  SkillDetailModal,
  SkillEditModal
} from "./modals";

export const VIEW_TYPE_SKILL_HUB = "banshan-skillhub-view";
type CardActionIcon = "details" | "edit" | "delete";
type ToolbarIcon = "github" | "folder" | "node" | "collections" | "select" | "done" | "download";

export class SkillHubView extends ItemView {
  private readonly selectedSkillIds = new Set<string>();
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

  async onOpen(): Promise<void> {
    this.render();
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
    const selected = this.getSelectedSkills();
    if (selected.length === 0) {
      new Notice("Select at least one skill to install.");
      return;
    }
    void this.plugin.installSkills(selected);
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
    this.addToolbarButton(toolbar, this.selectMode ? "Done" : "Select", this.selectMode ? "done" : "select", () => {
      this.selectMode = !this.selectMode;
      this.render();
    });
    this.addToolbarButton(toolbar, "Install", "download", () => this.installSelectedSkills(), this.selectedSkillIds.size === 0);

    if (this.selectMode) {
      const bulkToolbar = this.contentEl.createDiv({ cls: "skillhub-toolbar skillhub-bulk-toolbar" });
      bulkToolbar.createEl("span", { cls: "skillhub-selection-count", text: `${this.selectedSkillIds.size} selected` });
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
    container.empty();
    const skills = this.getVisibleSkills();
    if (skills.length === 0) {
      container.createEl("p", {
        cls: "skillhub-empty",
        text: Object.keys(this.plugin.registry.data.skills).length === 0 ? "No skills installed yet." : "No skills match this filter."
      });
      return;
    }

    const grid = container.createDiv({ cls: "skillhub-grid" });
    for (const skill of skills) this.renderCard(grid, skill);
  }

  private renderCard(grid: HTMLElement, skill: SkillRecord): void {
    const selected = this.selectedSkillIds.has(skill.id);
    const card = grid.createDiv({ cls: `skillhub-card${selected ? " is-selected" : ""}` });
    card.draggable = this.isCustomSort();
    if (card.draggable) {
      card.addClass("is-draggable");
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", skill.id);
        event.dataTransfer?.setData("application/x-skillhub-skill-id", skill.id);
        event.dataTransfer?.setDragImage(card, 20, 20);
      });
      card.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.dataTransfer!.dropEffect = "move";
      });
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        const draggedSkillId = event.dataTransfer?.getData("application/x-skillhub-skill-id") || event.dataTransfer?.getData("text/plain");
        if (draggedSkillId) void this.reorderSkill(draggedSkillId, skill.id, this.shouldDropAfter(card, event));
      });
    }
    if (skill.color) card.style.setProperty("--skillhub-card-color", skill.color);
    if (this.selectMode) {
      const checkbox = card.createEl("input", { type: "checkbox", cls: "skillhub-card-select" });
      checkbox.checked = selected;
      checkbox.addEventListener("change", () => {
        checkbox.checked ? this.selectedSkillIds.add(skill.id) : this.selectedSkillIds.delete(skill.id);
        this.render();
      });
    }
    card.createEl("strong", { text: `${skill.emoji ? `${skill.emoji} ` : ""}${skill.nickname}` });
    if (skill.originalName !== skill.nickname) card.createEl("span", { cls: "skillhub-original-name", text: skill.originalName });
    const chips = card.createDiv({ cls: "skillhub-chips" });
    for (const tag of skill.tags) this.renderTagChip(chips, skill, tag);
    if (skill.warnings.length > 0) {
      chips.createEl("span", { cls: "skillhub-chip is-warning", text: `${skill.warnings.length} warning${skill.warnings.length === 1 ? "" : "s"}` });
    }

    const actions = card.createDiv({ cls: "skillhub-card-actions" });
    this.addCardActionButton(actions, "Details", "details", () => this.openDetailModal(skill));
    this.addCardActionButton(actions, "Edit", "edit", () => this.openEditModal(skill));
    this.addCardActionButton(actions, "Delete", "delete", () => this.openDeleteModal(skill));
  }

  private openDetailModal(skill: SkillRecord): void {
    new SkillDetailModal(this.app, skill, Object.values(this.plugin.registry.data.collections)).open();
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
    const chip = chips.createEl("span", { cls: "skillhub-chip", text: tag });
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
      delete: async (collection) => {
        this.plugin.registry.deleteCollection(collection.id);
        this.plugin.registry.recordEvent(createSkillEvent("collection_deleted", undefined, { collectionId: collection.id }));
        await this.plugin.saveSkillHubData();
        this.render();
      }
    }).open();
  }

  private getSelectedSkills(): SkillRecord[] {
    return Object.values(this.plugin.registry.data.skills).filter((skill) => this.selectedSkillIds.has(skill.id));
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
    const sort = this.plugin.data.settings.defaultSort;
    if (sort === "custom") return this.sortByCustomOrder(visibleSkills);
    return visibleSkills.sort((left, right) => {
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

  private removeMissingSelections(): void {
    for (const id of this.selectedSkillIds) {
      if (!this.plugin.registry.data.skills[id]) this.selectedSkillIds.delete(id);
    }
  }

  private addSortOption(select: HTMLSelectElement, value: string, label: string): void {
    select.createEl("option", { text: label, value });
  }

  private addButton(container: HTMLElement, label: string, onClick: () => void, disabled = false): void {
    const button = container.createEl("button", { text: label });
    button.disabled = disabled;
    button.addEventListener("click", onClick);
  }

  private addToolbarButton(container: HTMLElement, label: string, icon: ToolbarIcon, onClick: () => void, disabled = false): void {
    const button = container.createEl("button", {
      cls: "skillhub-toolbar-button",
      attr: { "aria-label": label }
    });
    button.disabled = disabled;
    button.createSpan({ cls: "skillhub-toolbar-label", text: label });
    this.createToolbarIcon(button, icon);
    button.addEventListener("click", onClick);
  }

  private addCardActionButton(container: HTMLElement, label: string, icon: CardActionIcon, onClick: () => void): void {
    const actionClass = icon === "delete" ? "skillhub-delete-button" : icon === "edit" ? "skillhub-edit-button" : "skillhub-details-button";
    const button = container.createEl("button", {
      cls: `skillhub-card-action-button ${actionClass}`,
      attr: { "aria-label": label }
    });
    button.createSpan({ cls: "skillhub-action-tooltip", text: label });
    this.createSvgIcon(button, icon);
    button.addEventListener("click", onClick);
  }

  private createSvgIcon(container: HTMLElement, icon: CardActionIcon): void {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", icon === "delete" ? "skillhub-action-svg bin" : "skillhub-action-svg");
    container.appendChild(svg);

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
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    svg.appendChild(element);
  }

  private createToolbarIcon(container: HTMLElement, icon: ToolbarIcon): void {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
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
