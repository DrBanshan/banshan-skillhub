import { describe, expect, it } from "vitest";
import { pickNativeFolder } from "../src/folderPicker";

describe("pickNativeFolder", () => {
  it("returns the selected native directory", async () => {
    await expect(pickNativeFolder({
      showOpenDialog: async () => ({ canceled: false, filePaths: ["/tmp/skills"] })
    })).resolves.toBe("/tmp/skills");
  });

  it("returns undefined when selection is canceled", async () => {
    await expect(pickNativeFolder({
      showOpenDialog: async () => ({ canceled: true, filePaths: [] })
    })).resolves.toBeUndefined();
  });
});
