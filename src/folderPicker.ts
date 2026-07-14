import { dirname, isAbsolute, resolve } from "path";

interface ElectronWebUtils {
  getPathForFile(file: File): string;
}

interface ElectronModule {
  webUtils?: ElectronWebUtils;
}

export function extractNativeFolderPath(files: ArrayLike<File>, webUtils: ElectronWebUtils | undefined = getElectronWebUtils()): string {
  if (files.length === 0) {
    throw new Error("Native folder selection cannot select an empty directory because the folder picker did not provide a file. Select a non-empty directory.");
  }

  if (!webUtils) {
    throw new Error("Native folder selection is unavailable because Electron webUtils.getPathForFile is unavailable.");
  }

  let selectedFile: File | undefined;
  let selectedPath: string | undefined;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const path = webUtils.getPathForFile(file);
    if (path && isAbsolute(path)) {
      selectedFile = file;
      selectedPath = path;
      break;
    }
  }
  if (!selectedFile || !selectedPath) {
    throw new Error("Native folder selection could not provide an absolute folder path through Electron webUtils.getPathForFile.");
  }

  const relativeSegments = selectedFile.webkitRelativePath.split("/").filter(Boolean);
  if (relativeSegments.length < 2) return dirname(selectedPath);
  return resolve(selectedPath, ...Array(relativeSegments.length - 1).fill(".."));
}

function getElectronWebUtils(): ElectronWebUtils | undefined {
  try {
    return (require("electron") as ElectronModule).webUtils;
  } catch {
    return undefined;
  }
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
