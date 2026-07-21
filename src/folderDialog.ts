import { isAbsolute } from "path";

interface NativeFolderDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface NativeFolderDialogOptions {
  title: string;
  properties: Array<"openDirectory" | "createDirectory">;
}

export interface NativeFolderDialog {
  showOpenDialog(options: NativeFolderDialogOptions): Promise<NativeFolderDialogResult>;
}

export async function selectNativeFolder(dialog?: NativeFolderDialog): Promise<string | undefined> {
  if (!dialog) {
    throw new Error("Native folder selection is unavailable because the Electron native folder dialog is unavailable.");
  }

  const result = await dialog.showOpenDialog({
    title: "Choose a folder",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled) return undefined;

  const selectedPath = result.filePaths[0];
  if (!selectedPath || !isAbsolute(selectedPath)) {
    throw new Error("Native folder selection did not return an absolute folder path.");
  }
  return selectedPath;
}
