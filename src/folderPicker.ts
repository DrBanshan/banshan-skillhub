import { webUtils } from "electron";
import { extractNativeFolderPath } from "./folderPath";

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function pickNativeFolder(): Promise<string | undefined> {
  const input = createEl("input", { type: "file" });
  input.type = "file";
  input.multiple = true;
  input.hidden = true;
  input.setAttribute("webkitdirectory", "");

  return new Promise<string | undefined>((resolveSelection, rejectSelection) => {
    let settled = false;
    const finish = (files?: FileList | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      try {
        resolveSelection(files ? extractNativeFolderPath(files, webUtils) : undefined);
      } catch (error) {
        rejectSelection(toError(error));
      }
    };

    input.addEventListener("change", () => finish(input.files), { once: true });
    input.addEventListener("cancel", () => finish(), { once: true });
    try {
      document.body.appendChild(input);
      input.click();
    } catch (error) {
      settled = true;
      input.remove();
      rejectSelection(toError(error));
    }
  });
}
