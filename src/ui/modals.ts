import { Modal, Setting } from "obsidian";
import type { InstallSummary } from "../exportService";
import type { SkillCollection, SkillRecord } from "../types";

type SubmitHandler<T> = (value: T) => void | Promise<void>;
type EditableSkillRecord = SkillRecord & { emoji?: string; color?: string };

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

export interface SkillSelectionOption<T> {
  id: string;
  label: string;
  value: T;
}

export class SkillSelectionModal<T> extends Modal {
  private readonly selected = new Set<string>();

  constructor(
    app: Modal["app"],
    private readonly options: SkillSelectionOption<T>[],
    private readonly onSubmit: SubmitHandler<T[]>
  ) {
    super(app);
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
      await this.onSubmit(this.options.filter((option) => this.selected.has(option.id)).map((option) => option.value));
      this.close();
    }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export interface SkillEditValues {
  nickname: string;
  emoji: string;
  color: string;
  tags: string[];
  collectionIds: string[];
}

export class SkillEditModal extends Modal {
  constructor(
    app: Modal["app"],
    private readonly skill: EditableSkillRecord,
    private readonly collections: SkillCollection[],
    private readonly onSubmit: SubmitHandler<SkillEditValues>
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(`Edit ${this.skill.nickname}`);
    let nickname = this.skill.nickname;
    let emoji = this.skill.emoji ?? "";
    let color = this.skill.color ?? "#7f8c8d";
    let tags = this.skill.tags.join(", ");
    const collectionIds = new Set(this.skill.collectionIds);

    new Setting(this.contentEl).setName("Nickname").addText((text) => text.setValue(nickname).onChange((value) => { nickname = value; }));
    new Setting(this.contentEl).setName("Emoji").addText((text) => text.setValue(emoji).setPlaceholder("Optional").onChange((value) => { emoji = value; }));
    new Setting(this.contentEl).setName("Color").addColorPicker((picker) => picker.setValue(color).onChange((value) => { color = value; }));
    new Setting(this.contentEl).setName("Tags").addText((text) => text.setValue(tags).setPlaceholder("comma-separated").onChange((value) => { tags = value; }));

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
      await this.onSubmit({
        nickname: nickname.trim() || this.skill.nickname,
        emoji: emoji.trim(),
        color,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        collectionIds: [...collectionIds]
      });
      this.close();
    }));
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
    this.contentEl.createEl("p", { text: `Remove ${this.skill.nickname} from Skill Hub?` });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Delete").setWarning().onClick(async () => {
      await this.onConfirm();
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
