import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { createSkillEvent } from "../events";
import type SkillHubPlugin from "../main";
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
    this.addButton(toolbar, "GitHub import", () => this.openGitHubImport());
    this.addButton(toolbar, "Local scan", () => this.openLocalScan());
    this.addButton(toolbar, "npx import", () => this.openNpxImport());
    this.addButton(toolbar, "Collections", () => this.openCollectionManager());
    this.addButton(toolbar, this.selectMode ? "Done" : "Select", () => {
      this.selectMode = !this.selectMode;
      this.render();
    });
    this.addButton(toolbar, "Install", () => this.installSelectedSkills(), this.selectedSkillIds.size === 0);

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
    card.createEl("p", { text: skill.description || "No description provided." });
    const chips = card.createDiv({ cls: "skillhub-chips" });
    chips.createEl("span", { cls: "skillhub-chip", text: skill.source.type });
    for (const tag of skill.tags) chips.createEl("span", { cls: "skillhub-chip", text: tag });
    if (skill.warnings.length > 0) {
      chips.createEl("span", { cls: "skillhub-chip is-warning", text: `${skill.warnings.length} warning${skill.warnings.length === 1 ? "" : "s"}` });
    }

    const actions = card.createDiv({ cls: "skillhub-card-actions" });
    this.addButton(actions, "Details", () => this.openDetailModal(skill));
    this.addButton(actions, "Edit", () => this.openEditModal(skill));
    this.addButton(actions, "Delete", () => this.openDeleteModal(skill));
  }

  private openDetailModal(skill: SkillRecord): void {
    new SkillDetailModal(this.app, skill, Object.values(this.plugin.registry.data.collections)).open();
  }

  private openEditModal(skill: SkillRecord): void {
    new SkillEditModal(this.app, skill, Object.values(this.plugin.registry.data.collections), async (values) => {
      skill.nickname = values.nickname;
      skill.emoji = values.emoji;
      skill.color = values.color;
      skill.tags = values.tags;
      this.plugin.registry.updateSkillCollections(skill.id, values.collectionIds);
      skill.updatedAt = new Date().toISOString();
      await this.plugin.saveSkillHubData();
      this.render();
    }).open();
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
    new BulkDeleteConfirmationModal(this.app, records.length, async () => {
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
    return Object.values(this.plugin.registry.data.skills)
      .filter((skill) => {
        if (!query) return true;
        const collectionNames = skill.collectionIds.map((id) => collections[id]?.name ?? "");
        return [skill.nickname, skill.originalName, skill.description, ...skill.tags, ...collectionNames]
          .some((value) => value.toLocaleLowerCase().includes(query));
      })
      .sort((left, right) => {
        const sort = this.plugin.data.settings.defaultSort;
        if (sort === "updatedAt") return right.updatedAt.localeCompare(left.updatedAt);
        return left[sort].localeCompare(right[sort]);
      });
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
}
