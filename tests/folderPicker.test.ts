import { beforeEach, describe, expect, it, vi } from "vitest";

import { extractNativeFolderPath, resolveElectronWebUtils } from "../src/folderPicker";

describe("extractNativeFolderPath", () => {
  const getPathForFile = vi.fn<(file: File) => string>();
  const webUtils = { getPathForFile };

  beforeEach(() => {
    getPathForFile.mockReset();
  });

  it("derives the selected directory from Electron webUtils file paths", () => {
    const files = [{
      webkitRelativePath: "writer/docs/guide.md"
    }] as File[];
    getPathForFile.mockReturnValue("/tmp/skills/writer/docs/guide.md");

    expect(extractNativeFolderPath(files, webUtils)).toBe("/tmp/skills/writer");
  });

  it("falls back to the selected file's parent when no relative path is exposed", () => {
    const files = [{ webkitRelativePath: "" }] as File[];
    getPathForFile.mockReturnValue("/tmp/skills/SKILL.md");

    expect(extractNativeFolderPath(files, webUtils)).toBe("/tmp/skills");
  });

  it("fails clearly when an empty directory provides no files", () => {
    expect(() => extractNativeFolderPath([], webUtils)).toThrow("non-empty directory");
  });

  it("fails clearly when Electron webUtils returns an empty file path", () => {
    const files = [{ webkitRelativePath: "writer/SKILL.md" }] as File[];
    getPathForFile.mockReturnValue("");

    expect(() => extractNativeFolderPath(files, webUtils)).toThrow("absolute folder path");
  });

  it("fails clearly when Electron webUtils is unavailable", () => {
    const files = [{ webkitRelativePath: "writer/SKILL.md" }] as File[];

    expect(() => extractNativeFolderPath(files)).toThrow("webUtils.getPathForFile is unavailable");
  });
});

describe("resolveElectronWebUtils", () => {
  it("reads webUtils from Electron's CommonJS default export", () => {
    const webUtils = { getPathForFile: vi.fn<(file: File) => string>() };

    expect(resolveElectronWebUtils({ default: { webUtils } })).toBe(webUtils);
  });

  it("keeps supporting Electron's named export shape", () => {
    const webUtils = { getPathForFile: vi.fn<(file: File) => string>() };

    expect(resolveElectronWebUtils({ webUtils })).toBe(webUtils);
  });
});
