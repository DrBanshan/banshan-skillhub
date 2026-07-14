import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type SkillHubPlugin from "../main";
import type { SkillRecord } from "../types";
import { DeleteConfirmationModal, GitHubUrlModal, LocalDirectoryModal, NpxCommandModal, SkillEditModal } from "./modals";

export const VIEW_TYPE_SKILL_HUB = "banshan-skillhub-view";

export class SkillHubView extends ItemView {
  private readonly selectedSkillIds = new Set<string>();
  private selectMode = false;

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
    new LocalDirectoryModal(this.app, (path) => this.plugin.importFromLocalDirectory(path)).open();
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
    this.plugin.installSkills(selected);
  }

  render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("skillhub-root");

    const toolbar = this.contentEl.createDiv({ cls: "skillhub-toolbar" });
    this.addButton(toolbar, "GitHub Import", () => this.openGitHubImport());
    this.addButton(toolbar, "Local Scan", () => this.openLocalScan());
    this.addButton(toolbar, "NPX Import", () => this.openNpxImport());
    this.addButton(toolbar, this.selectMode ? "Done" : "Select", () => {
      this.selectMode = !this.selectMode;
      this.render();
    });
    this.addButton(toolbar, "Install", () => this.installSelectedSkills(), this.selectedSkillIds.size === 0);

    const skills = Object.values(this.plugin.registry.data.skills).sort((left, right) => left.nickname.localeCompare(right.nickname));
    if (skills.length === 0) {
      this.contentEl.createEl("p", { cls: "skillhub-empty", text: "No skills installed yet." });
      return;
    }

    const grid = this.contentEl.createDiv({ cls: "skillhub-grid" });
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
    if (skill.warnings.length > 0) chips.createEl("span", { cls: "skillhub-chip is-warning", text: `${skill.warnings.length} warning${skill.warnings.length === 1 ? "" : "s"}` });

    const actions = card.createDiv({ cls: "skillhub-card-actions" });
    this.addButton(actions, "Edit", () => this.openEditModal(skill));
    this.addButton(actions, "Delete", () => this.openDeleteModal(skill));
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

  private getSelectedSkills(): SkillRecord[] {
    return Object.values(this.plugin.registry.data.skills).filter((skill) => this.selectedSkillIds.has(skill.id));
  }

  private addButton(container: HTMLElement, label: string, onClick: () => void, disabled = false): void {
    const button = container.createEl("button", { text: label });
    button.disabled = disabled;
    button.addEventListener("click", onClick);
  }
}
