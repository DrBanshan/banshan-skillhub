import { dirname, isAbsolute, resolve } from "path";

type ElectronFile = File & { path?: string };

export function extractNativeFolderPath(files: ArrayLike<File>): string {
  let selectedFile: ElectronFile | undefined;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index] as ElectronFile;
    if (file.path && isAbsolute(file.path)) {
      selectedFile = file;
      break;
    }
  }
  if (!selectedFile?.path) {
    throw new Error("Native folder selection could not provide an absolute folder path because Electron File.path is unavailable.");
  }

  const relativeSegments = selectedFile.webkitRelativePath.split("/").filter(Boolean);
  if (relativeSegments.length < 2) return dirname(selectedFile.path);
  return resolve(selectedFile.path, ...Array(relativeSegments.length - 1).fill(".."));
}

export async function pickNativeFolder(): Promise<string | undefined> {
  const input = document.createElement("input");
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
        resolveSelection(files ? extractNativeFolderPath(files) : undefined);
      } catch (error) {
        rejectSelection(error);
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
      rejectSelection(error);
    }
  });
}
