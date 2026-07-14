import { describe, expect, it } from "vitest";
import { extractNativeFolderPath } from "../src/folderPicker";

describe("extractNativeFolderPath", () => {
  it("derives the selected directory from Electron's absolute file path", () => {
    const files = [{
      path: "/tmp/skills/writer/docs/guide.md",
      webkitRelativePath: "writer/docs/guide.md"
    }] as Array<File & { path: string }>;

    expect(extractNativeFolderPath(files)).toBe("/tmp/skills/writer");
  });

  it("falls back to the selected file's parent when no relative path is exposed", () => {
    const files = [{ path: "/tmp/skills/SKILL.md", webkitRelativePath: "" }] as Array<File & { path: string }>;

    expect(extractNativeFolderPath(files)).toBe("/tmp/skills");
  });

  it("fails clearly when a selected directory exposes no file paths", () => {
    expect(() => extractNativeFolderPath([])).toThrow("absolute folder path");
  });

  it("fails clearly when Electron does not expose an absolute file path", () => {
    const files = [{ webkitRelativePath: "writer/SKILL.md" }] as File[];

    expect(() => extractNativeFolderPath(files)).toThrow("absolute folder path");
  });
});
