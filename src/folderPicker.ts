import { dirname, isAbsolute, resolve } from "path";

interface ElectronWebUtils {
  getPathForFile(file: File): string;
}

interface ElectronModule {
  webUtils?: ElectronWebUtils;
}

interface ElectronImport extends ElectronModule {
  default?: ElectronModule;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function extractNativeFolderPath(files: ArrayLike<File>, webUtils?: ElectronWebUtils): string {
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
  const parentSegments: string[] = [];
  for (let index = 1; index < relativeSegments.length; index += 1) parentSegments.push("..");
  return resolve(selectedPath, ...parentSegments);
}

export function resolveElectronWebUtils(electron: ElectronImport): ElectronWebUtils | undefined {
  return electron.webUtils ?? electron.default?.webUtils;
}

async function getElectronWebUtils(): Promise<ElectronWebUtils | undefined> {
  try {
    const electron = await import("electron") as ElectronImport;
    return resolveElectronWebUtils(electron);
  } catch {
    return undefined;
  }
}

export async function pickNativeFolder(): Promise<string | undefined> {
  const webUtils = await getElectronWebUtils();
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
