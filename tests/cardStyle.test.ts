import { readFile } from "fs/promises";
import { describe, expect, it } from "vitest";

describe("skill card color styling", () => {
  it("uses the chosen color across the full card instead of a left stripe", async () => {
    const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

    expect(css).not.toContain("border-left:");
    expect(css).toContain("background: color-mix(in srgb, var(--skillhub-card-color");
    expect(css).toContain("border-color: color-mix(in srgb, var(--skillhub-card-color");
  });

  it("enlarges cards on hover and reveals card actions only on interaction", async () => {
    const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

    expect(css).toContain(".skillhub-card:hover");
    expect(css).toContain("transform: scale(1.02);");
    expect(css).toContain("opacity: 0;");
    expect(css).toContain(".skillhub-card:hover .skillhub-card-actions");
    expect(css).toContain(".skillhub-card:focus-within .skillhub-card-actions");
    expect(css).toContain("opacity: 1;");
  });

  it("shows the tag delete control only when interacting with the tag", async () => {
    const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

    expect(css).toContain(".skillhub-tag-delete-icon");
    expect(css).toContain(".skillhub-edit-tag:hover .skillhub-tag-delete-icon");
    expect(css).toContain(".skillhub-edit-tag-button:focus-visible .skillhub-tag-delete-icon");
    expect(css).toContain("transform: translateX(100%);");
    expect(css).toContain("transform: translateX(0);");
    expect(css).toContain("color: var(--text-error);");
  });

  it("shows edit tag colors except while hovering current skill tags", async () => {
    const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

    expect(css).toContain("button.skillhub-existing-tag");
    expect(css).toContain(".skillhub-edit-tag button.skillhub-edit-tag-button");
    expect(css).toContain("background: var(--skillhub-tag-color) !important;");
    expect(css).toContain("border-color: transparent !important;");
    expect(css).toContain("box-shadow: none !important;");
    expect(css).toContain(".skillhub-edit-tag:hover button.skillhub-edit-tag-button");
    expect(css).toContain(".skillhub-edit-tag:focus-within button.skillhub-edit-tag-button");
    expect(css).toContain("background: var(--background-secondary) !important;");
  });

  it("styles skill card actions as tooltip icon buttons", async () => {
    const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

    expect(css).toContain(".skillhub-card-action-button");
    expect(css).toContain("width: 40px;");
    expect(css).toContain("height: 40px;");
    expect(css).toContain(".skillhub-details-button:hover");
    expect(css).toContain("background-color: var(--interactive-accent) !important;");
    expect(css).toContain(".skillhub-delete-button:hover");
    expect(css).toContain("background-color: rgb(237, 56, 56) !important;");
    expect(css).toContain(".skillhub-edit-button:hover");
    expect(css).toContain("background-color: var(--interactive-accent) !important;");
    expect(css).toContain(".skillhub-card-action-button:hover .skillhub-action-tooltip");
    expect(css).toContain(".skillhub-card-action-button:active");
    expect(css).toContain("transform: scale(0.98);");
  });

  it("styles main toolbar actions as sliding icon buttons", async () => {
    const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

    expect(css).toContain(".skillhub-toolbar-button");
    expect(css).toContain("min-width: 132px;");
    expect(css).toContain("width: max-content;");
    expect(css).toContain("background-color: var(--interactive-accent) !important;");
    expect(css).toContain("height: 40px;");
    expect(css).toContain("box-shadow: 5px 5px 0 color-mix(in srgb, var(--interactive-accent) 70%, black);");
    expect(css).toContain(".skillhub-toolbar-button:hover");
    expect(css).toContain("color: transparent !important;");
    expect(css).toContain(".skillhub-toolbar-button:hover .skillhub-toolbar-icon");
    expect(css).toContain("width: 19.5px;");
    expect(css).toContain("left: 50%;");
    expect(css).toContain("right: auto;");
    expect(css).toContain("transform: translateX(-50%);");
    expect(css).toContain(".skillhub-toolbar-button:active");
    expect(css).toContain("transform: translate(3px, 3px);");
  });

  it("styles collection rows as full-width drop targets", async () => {
    const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

    expect(css).toContain(".skillhub-collections-board");
    expect(css).toContain(".skillhub-collection-row");
    expect(css).toContain("grid-column: 1 / -1;");
    expect(css).toContain(".skillhub-collection-row.is-drop-target");
    expect(css).toContain("border-color: var(--interactive-accent);");
    expect(css).toContain(".skillhub-collection-actions");
  });

  it("styles collection skills as neutral reorderable blocks", async () => {
    const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

    expect(css).toContain(".skillhub-collection-skill-block");
    expect(css).toContain("background: var(--background-primary);");
    expect(css).toContain("cursor: grab;");
    expect(css).toContain(".skillhub-collection-skill-block.is-drop-target");
    expect(css).toContain("border-color: var(--interactive-accent);");
  });

  it("reveals collection actions and edit removal controls only on interaction", async () => {
    const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

    expect(css).toContain(".skillhub-collection-actions");
    expect(css).toContain(".skillhub-collection-row:hover .skillhub-collection-actions");
    expect(css).toContain(".skillhub-collection-row:focus-within .skillhub-collection-actions");
    expect(css).toContain(".skillhub-collection-edit-skill-remove");
    expect(css).toContain(".skillhub-collection-edit-skill:hover .skillhub-collection-edit-skill-remove");
    expect(css).toContain(".skillhub-collection-edit-skill:focus-within .skillhub-collection-edit-skill-remove");
  });
});
