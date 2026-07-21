import { dirname, isAbsolute, resolve } from "path";

export interface ElectronWebUtils {
  getPathForFile(file: File): string;
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
