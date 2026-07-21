import { describe, expect, it, vi } from "vitest";

import { selectNativeFolder, type NativeFolderDialog } from "../src/folderDialog";

describe("selectNativeFolder", () => {
  it("returns an empty directory selected by the native dialog", async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ["/tmp/empty-install-target"]
    });

    await expect(selectNativeFolder({ showOpenDialog })).resolves.toBe("/tmp/empty-install-target");
    expect(showOpenDialog).toHaveBeenCalledWith({
      title: "Choose a folder",
      properties: ["openDirectory", "createDirectory"]
    });
  });

  it("returns undefined when folder selection is canceled", async () => {
    const dialog: NativeFolderDialog = {
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })
    };

    await expect(selectNativeFolder(dialog)).resolves.toBeUndefined();
  });

  it("fails clearly when the native dialog is unavailable", async () => {
    await expect(selectNativeFolder()).rejects.toThrow("native folder dialog is unavailable");
  });

  it("rejects a non-absolute path returned by the native dialog", async () => {
    const dialog: NativeFolderDialog = {
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ["relative/path"] })
    };

    await expect(selectNativeFolder(dialog)).rejects.toThrow("absolute folder path");
  });
});
