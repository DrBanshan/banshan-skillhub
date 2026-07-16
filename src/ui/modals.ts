import { Modal, Notice, Setting } from "obsidian";
import type { InstallSummary } from "../exportService";
import { createCleanupOnce } from "../stagingCleanup";
import type { SkillCollection, SkillRecord } from "../types";

type SubmitHandler<T> = (value: T) => void | Promise<void>;
const SKILL_EMOJI_CANDIDATES = ["🧠", "🛠️", "✍️", "🔍", "📚", "🧪", "⚙️", "🚀", "💡", "📊", "🤖", "🧭"];
const DEFAULT_TAG_COLOR = "#7f8c8d";

export class TextInputModal extends Modal {
  private value = "";

  constructor(
    app: Modal["app"],
    private readonly title: string,
    private readonly placeholder: string,
    private readonly submitText: string,
    private readonly onSubmit: SubmitHandler<string>
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.title);
    new Setting(this.contentEl)
      .addText((text) => text.setPlaceholder(this.placeholder).onChange((value) => {
        this.value = value.trim();
      }))
      .addButton((button) => button.setButtonText(this.submitText).setCta().onClick(async () => {
        if (!this.value) return;
        await this.onSubmit(this.value);
        this.close();
      }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class GitHubUrlModal extends TextInputModal {
  constructor(app: Modal["app"], onSubmit: SubmitHandler<string>) {
    super(app, "Import skills from GitHub", "https://github.com/owner/repository", "Import", onSubmit);
  }
}

export class LocalDirectoryModal extends TextInputModal {
  constructor(app: Modal["app"], onSubmit: SubmitHandler<string>) {
    super(app, "Scan local skill directory", "/path/to/folder-or-skills", "Scan", onSubmit);
  }
}

export class NpxCommandModal extends TextInputModal {
  constructor(app: Modal["app"], onSubmit: SubmitHandler<string>) {
    super(app, "Import skills with npx", "npx skills add owner/repository", "Run import", onSubmit);
  }
}

export class ManualNpxFallbackModal extends Modal {
  constructor(
    app: Modal["app"],
    private readonly command: string,
    private readonly reason: string,
    private readonly onScan: SubmitHandler<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Run npx manually");
    this.contentEl.createEl("p", { text: this.reason });
    this.contentEl.createEl("code", { cls: "skillhub-command", text: this.command });
    this.contentEl.createEl("p", { text: "Run this command in a folder, then select that output folder for scanning." });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Scan output folder").setCta().onClick(async () => {
      await this.onScan(undefined);
      this.close();
    }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export interface SkillSelectionOption<T> {
  id: string;
  label: string;
  value: T;
}

export class SkillSelectionModal<T> extends Modal {
  private readonly selected = new Set<string>();
  private readonly cleanup: () => Promise<void>;
  private cleanupErrorShown = false;

  constructor(
    app: Modal["app"],
    private readonly options: SkillSelectionOption<T>[],
    private readonly onSubmit: SubmitHandler<T[]>,
    onCleanup: () => void | Promise<void> = () => undefined
  ) {
    super(app);
    this.cleanup = createCleanupOnce(onCleanup);
  }

  onOpen(): void {
    this.setTitle("Select skills");
    const selectAll = this.contentEl.createEl("input", { type: "checkbox" });
    const selectAllLabel = this.contentEl.createEl("label", { text: " Select all" });
    selectAllLabel.prepend(selectAll);

    const list = this.contentEl.createDiv({ cls: "skillhub-selection-list" });
    const checks = this.options.map((option) => {
      const label = list.createEl("label", { cls: "skillhub-selection-item" });
      const checkbox = label.createEl("input", { type: "checkbox" });
      label.appendText(` ${option.label}`);
      checkbox.addEventListener("change", () => {
        checkbox.checked ? this.selected.add(option.id) : this.selected.delete(option.id);
        selectAll.checked = this.selected.size === this.options.length;
      });
      return checkbox;
    });

    selectAll.addEventListener("change", () => {
      for (const option of this.options) {
        selectAll.checked ? this.selected.add(option.id) : this.selected.delete(option.id);
      }
      for (const checkbox of checks) checkbox.checked = selectAll.checked;
    });

    new Setting(this.contentEl).addButton((button) => button.setButtonText("Continue").setCta().onClick(async () => {
      try {
        await this.onSubmit(this.options.filter((option) => this.selected.has(option.id)).map((option) => option.value));
      } finally {
        try {
          await this.cleanupWithNotice();
        } finally {
          this.close();
        }
      }
    }));
  }

  onClose(): void {
    void this.cleanupWithNotice().catch(() => undefined);
    this.contentEl.empty();
  }

  private async cleanupWithNotice(): Promise<void> {
    try {
      await this.cleanup();
    } catch (error) {
      if (!this.cleanupErrorShown) {
        this.cleanupErrorShown = true;
        new Notice(`Failed to clean staging folder: ${error instanceof Error ? error.message : String(error)}`);
      }
      throw error;
    }
  }
}

export interface SkillEditValues {
  nickname: string;
  emoji: string;
  color: string;
  tags: string[];
  tagColors: Record<string, string>;
  collectionIds: string[];
}

export class SkillEditModal extends Modal {
  constructor(
    app: Modal["app"],
    private readonly skill: SkillRecord,
    private readonly collections: SkillCollection[],
    private readonly allTags: string[],
    private readonly sharedTagColors: Record<string, string>,
    private readonly onSubmit: SubmitHandler<SkillEditValues>
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(`Edit ${this.skill.nickname}`);
    let nickname = this.skill.nickname;
    let emoji = this.skill.emoji ?? "";
    let color = this.skill.color ?? "#7f8c8d";
    let tagDraft = "";
    const tags = [...this.skill.tags];
    const knownTags = new Set([...this.allTags, ...tags]);
    const tagColors = { ...this.sharedTagColors };
    const collectionIds = new Set(this.skill.collectionIds);
    let emojiInput: { setValue(value: string): unknown } | undefined;
    let tagInput: { setValue(value: string): unknown; inputEl: HTMLInputElement } | undefined;

    new Setting(this.contentEl).setName("Nickname").addText((text) => text.setValue(nickname).onChange((value) => { nickname = value; }));
    new Setting(this.contentEl).setName("Emoji").addText((text) => {
      emojiInput = text;
      text.setValue(emoji).setPlaceholder("Optional").onChange((value) => {
        emoji = value;
        renderEmojiCandidates();
      });
    });
    const emojiCandidatesEl = this.contentEl.createDiv({ cls: "skillhub-emoji-candidates" });
    new Setting(this.contentEl).setName("Color").addColorPicker((picker) => picker.setValue(color).onChange((value) => { color = value; }));
    new Setting(this.contentEl).setName("Tags").setDesc("Right click to change tag color").addText((text) => {
      tagInput = text;
      text.setPlaceholder("Add tag and press Enter").onChange((value) => { tagDraft = value; });
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          addTag(tagDraft);
        }
      });
    });
    const currentTagsSection = this.contentEl.createDiv({ cls: "skillhub-current-tags" });
    currentTagsSection.createEl("h3", { text: "Current skill tags" });
    const currentTagsEl = currentTagsSection.createDiv({ cls: "skillhub-edit-tags" });
    const existingTagsSection = this.contentEl.createDiv({ cls: "skillhub-existing-tags" });
    existingTagsSection.createEl("h3", { text: "Existing tags" });
    const existingTagsEl = existingTagsSection.createDiv({ cls: "skillhub-edit-tags" });

    const renderEmojiCandidates = (): void => {
      emojiCandidatesEl.empty();
      for (const candidate of SKILL_EMOJI_CANDIDATES) {
        const button = emojiCandidatesEl.createEl("button", { text: candidate, cls: "skillhub-emoji-choice" });
        if (emoji === candidate) button.addClass("is-selected");
        button.addEventListener("click", () => {
          emoji = candidate;
          emojiInput?.setValue(candidate);
          renderEmojiCandidates();
        });
      }
    };

    const addTag = (rawTag: string): void => {
      const tag = rawTag.trim();
      if (!tag || tags.includes(tag)) return;
      knownTags.add(tag);
      tags.push(tag);
      tagDraft = "";
      tagInput?.setValue("");
      renderTags();
    };

    const renderTags = (): void => {
      currentTagsEl.empty();
      for (const tag of tags) {
        const tagEl = currentTagsEl.createDiv({ cls: "skillhub-edit-tag" });
        const tagColor = tagColors[tag] ?? DEFAULT_TAG_COLOR;
        tagEl.style.setProperty("--skillhub-tag-color", tagColor);

        const colorInput = tagEl.createEl("input", { type: "color", cls: "skillhub-tag-color" });
        colorInput.value = tagColor;
        colorInput.addEventListener("input", () => {
          tagColors[tag] = colorInput.value;
          tagEl.style.setProperty("--skillhub-tag-color", colorInput.value);
        });

        const tagButton = tagEl.createEl("button", { cls: "skillhub-edit-tag-button", attr: { "aria-label": `Delete ${tag}` } });
        tagButton.createEl("span", { text: tag, cls: "skillhub-tag-text" });
        tagButton.createEl("span", { text: "×", cls: "skillhub-tag-delete-icon", attr: { "aria-hidden": "true" } });
        tagButton.addEventListener("click", () => {
          tags.splice(tags.indexOf(tag), 1);
          renderTags();
        });
        tagButton.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          colorInput.click();
        });
      }

      existingTagsEl.empty();
      for (const tag of [...knownTags].filter((candidate) => !tags.includes(candidate)).sort((left, right) => left.localeCompare(right))) {
        const button = existingTagsEl.createEl("button", { text: tag, cls: "skillhub-existing-tag" });
        const tagColor = tagColors[tag] ?? DEFAULT_TAG_COLOR;
        button.style.setProperty("--skillhub-tag-color", tagColor);
        button.addEventListener("click", () => addTag(tag));
      }
    };

    const collectionsEl = this.contentEl.createDiv({ cls: "skillhub-collections" });
    collectionsEl.createEl("h3", { text: "Collections" });
    for (const collection of this.collections) {
      const label = collectionsEl.createEl("label", { cls: "skillhub-selection-item" });
      const checkbox = label.createEl("input", { type: "checkbox" });
      checkbox.checked = collectionIds.has(collection.id);
      label.appendText(` ${collection.name}`);
      checkbox.addEventListener("change", () => {
        checkbox.checked ? collectionIds.add(collection.id) : collectionIds.delete(collection.id);
      });
    }

    new Setting(this.contentEl).addButton((button) => button.setButtonText("Save").setCta().onClick(async () => {
      addTag(tagDraft);
      await this.onSubmit({
        nickname: nickname.trim() || this.skill.nickname,
        emoji: emoji.trim(),
        color,
        tags,
        tagColors: Object.fromEntries([...knownTags].filter((tag) => tagColors[tag]).map((tag) => [tag, tagColors[tag]])),
        collectionIds: [...collectionIds]
      });
      this.close();
    }));

    renderEmojiCandidates();
    renderTags();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class DeleteConfirmationModal extends Modal {
  constructor(app: Modal["app"], skill: SkillRecord, private readonly onConfirm: () => void | Promise<void>) {
    super(app);
    this.skill = skill;
  }

  private readonly skill: SkillRecord;

  onOpen(): void {
    this.setTitle("Delete skill");
    this.contentEl.createEl("p", {
      text: `Delete ${this.skill.nickname}? Copied vault folder "${this.skill.vaultPath}" and Skill Hub plugin metadata will be permanently deleted.`
    });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Delete").setWarning().onClick(async () => {
      await this.onConfirm();
      this.close();
    }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class BulkDeleteConfirmationModal extends Modal {
  constructor(app: Modal["app"], private readonly skills: SkillRecord[], private readonly onConfirm: SubmitHandler<void>) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Delete selected skills");
    this.contentEl.createEl("p", {
      text: `Delete ${this.skills.length} selected skills? Copied vault folders ${this.skills.map((skill) => `"${skill.vaultPath}"`).join(", ")} and Skill Hub plugin metadata will be permanently deleted.`
    });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Delete all").setWarning().onClick(async () => {
      await this.onConfirm(undefined);
      this.close();
    }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class SkillDetailModal extends Modal {
  constructor(app: Modal["app"], private readonly skill: SkillRecord, private readonly collections: SkillCollection[]) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.skill.nickname);
    this.addDetail("Original name", this.skill.originalName);
    this.addDetail("Description", this.skill.description || "No description provided.");
    this.addDetail("Vault path", this.skill.vaultPath);
    this.addDetail("Source", formatSkillSource(this.skill));
    this.addDetail("Tags", this.skill.tags.join(", ") || "None");
    this.addDetail(
      "Collections",
      this.collections.filter((collection) => this.skill.collectionIds.includes(collection.id)).map((collection) => collection.name).join(", ") || "None"
    );
    this.addDetail("Install count", String(this.skill.installCount));
    this.addDetail("Warnings", this.skill.warnings.join("; ") || "None");
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private addDetail(label: string, value: string): void {
    const row = this.contentEl.createDiv({ cls: "skillhub-detail-row" });
    row.createEl("strong", { text: label });
    row.createEl("span", { text: value });
  }
}

export class CollectionDetailModal extends Modal {
  constructor(app: Modal["app"], private readonly collection: SkillCollection, private readonly skills: SkillRecord[]) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.collection.name);
    this.addDetail("Description", this.collection.description || "No description provided.");
    this.addDetail("Skills", this.skills.map((skill) => skill.nickname).join(", ") || "None");
    this.addDetail("Skill count", String(this.skills.length));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private addDetail(label: string, value: string): void {
    const row = this.contentEl.createDiv({ cls: "skillhub-detail-row" });
    row.createEl("strong", { text: label });
    row.createEl("span", { text: value });
  }
}

export interface CollectionEditValues {
  name: string;
  description: string;
  color: string;
  skillIds?: string[];
}

export class CollectionEditModal extends Modal {
  constructor(
    app: Modal["app"],
    private readonly collection: SkillCollection | undefined,
    private readonly onSubmit: SubmitHandler<CollectionEditValues>,
    private readonly collectionSkills?: SkillRecord[]
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.collection ? "Edit collection" : "New collection");
    let name = this.collection?.name ?? "";
    let description = this.collection?.description ?? "";
    let color = this.collection?.color ?? "#7f8c8d";
    let skillIds = this.collectionSkills?.map((skill) => skill.id) ?? [];
    new Setting(this.contentEl).setName("Name").addText((text) => text.setValue(name).onChange((value) => { name = value; }));
    new Setting(this.contentEl).setName("Description").addText((text) => text.setValue(description).onChange((value) => { description = value; }));
    new Setting(this.contentEl).setName("Color").addColorPicker((picker) => picker.setValue(color).onChange((value) => { color = value; }));
    const skillsEl = this.collectionSkills ? this.contentEl.createDiv({ cls: "skillhub-collection-edit-skills" }) : undefined;

    const renderSkills = (): void => {
      if (!skillsEl || !this.collectionSkills) return;
      skillsEl.empty();
      skillsEl.createEl("h3", { text: "Skills" });
      const visibleSkills = this.collectionSkills.filter((skill) => skillIds.includes(skill.id));
      if (visibleSkills.length === 0) {
        skillsEl.createEl("span", { cls: "skillhub-collection-empty", text: "No skills in this collection." });
        return;
      }

      for (const skill of visibleSkills) {
        const row = skillsEl.createDiv({ cls: "skillhub-collection-edit-skill" });
        row.createEl("span", { text: `${skill.emoji ? `${skill.emoji} ` : ""}${skill.nickname}` });
        const removeButton = row.createEl("button", {
          cls: "skillhub-collection-edit-skill-remove",
          text: "×",
          attr: { "aria-label": `Remove ${skill.nickname}` }
        });
        removeButton.addEventListener("click", () => {
          skillIds = skillIds.filter((skillId) => skillId !== skill.id);
          renderSkills();
        });
      }
    };

    new Setting(this.contentEl).addButton((button) => button.setButtonText("Save").setCta().onClick(async () => {
      if (!name.trim()) return;
      await this.onSubmit({
        name: name.trim(),
        description: description.trim(),
        color,
        skillIds: this.collectionSkills ? skillIds : undefined
      });
      this.close();
    }));
    renderSkills();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export interface CollectionManagerActions {
  create(values: CollectionEditValues): void | Promise<void>;
  update(collection: SkillCollection, values: CollectionEditValues): void | Promise<void>;
  delete(collection: SkillCollection): void | Promise<void>;
}

export class CollectionManagerModal extends Modal {
  constructor(
    app: Modal["app"],
    private readonly getCollections: () => SkillCollection[],
    private readonly actions: CollectionManagerActions
  ) {
    super(app);
  }

  onOpen(): void {
    this.renderCollections();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderCollections(): void {
    this.contentEl.empty();
    this.setTitle("Collections");
    new Setting(this.contentEl).addButton((button) => button.setButtonText("New collection").setCta().onClick(() => {
      new CollectionEditModal(this.app, undefined, async (values) => {
        await this.actions.create(values);
        this.renderCollections();
      }).open();
    }));

    for (const collection of this.getCollections()) {
      new Setting(this.contentEl)
        .setName(collection.name)
        .setDesc(collection.description || `${collection.skillIds.length} skills`)
        .addButton((button) => button.setButtonText("Edit").onClick(() => {
          new CollectionEditModal(this.app, collection, async (values) => {
            await this.actions.update(collection, values);
            this.renderCollections();
          }).open();
        }))
        .addButton((button) => button.setButtonText("Delete").setWarning().onClick(async () => {
          await this.actions.delete(collection);
          this.renderCollections();
        }));
    }
  }
}

export type BulkCollectionAction = "add" | "remove";

export class BulkCollectionMembershipModal extends Modal {
  constructor(
    app: Modal["app"],
    private readonly collections: SkillCollection[],
    private readonly onSubmit: SubmitHandler<{ action: BulkCollectionAction; collectionIds: string[] }>
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Update selected collections");
    let action: BulkCollectionAction = "add";
    const collectionIds = new Set<string>();
    new Setting(this.contentEl).setName("Action").addDropdown((dropdown) => dropdown
      .addOption("add", "Add membership")
      .addOption("remove", "Remove membership")
      .onChange((value) => { action = value as BulkCollectionAction; }));
    for (const collection of this.collections) {
      new Setting(this.contentEl).setName(collection.name).addToggle((toggle) => toggle.onChange((selected) => {
        selected ? collectionIds.add(collection.id) : collectionIds.delete(collection.id);
      }));
    }
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Apply").setCta().onClick(async () => {
      if (collectionIds.size === 0) return;
      await this.onSubmit({ action, collectionIds: [...collectionIds] });
      this.close();
    }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class InstallResultModal extends Modal {
  constructor(app: Modal["app"], private readonly summary: InstallSummary) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Install results");
    this.contentEl.createEl("p", { text: `Installed: ${this.summary.installed.length}` });
    this.contentEl.createEl("p", { text: `Replaced: ${this.summary.replaced.length}` });
    this.contentEl.createEl("p", { text: `Skipped: ${this.summary.skipped.length}` });
    this.contentEl.createEl("p", { text: `Failed: ${this.summary.failed.length}` });
    for (const failure of this.summary.failed) this.contentEl.createEl("p", { text: failure.reason, cls: "skillhub-error" });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function formatSkillSource(skill: SkillRecord): string {
  if (skill.source.type === "github") return skill.source.url ?? "GitHub";
  if (skill.source.type === "npx") return skill.source.command ?? "npx";
  return skill.source.path ?? "Local folder";
}
