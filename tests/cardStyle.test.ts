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

    expect(css).toContain(".skillhub-existing-tag");
    expect(css).toContain("background-color: var(--skillhub-tag-color);");
    expect(css).toContain(".skillhub-edit-tag-button");
    expect(css).toContain(".skillhub-edit-tag:hover .skillhub-edit-tag-button");
    expect(css).toContain(".skillhub-edit-tag:focus-within .skillhub-edit-tag-button");
    expect(css).toContain(".skillhub-edit-tag:hover");
    expect(css).toContain("background-color: var(--background-secondary);");
  });
});
