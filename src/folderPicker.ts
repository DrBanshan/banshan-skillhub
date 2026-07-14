interface FolderDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface FolderDialog {
  showOpenDialog(options: { properties: string[] }): Promise<FolderDialogResult>;
}

interface ElectronModule {
  remote?: { dialog?: FolderDialog };
}

export async function pickNativeFolder(dialog: FolderDialog = getElectronFolderDialog()): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? undefined : result.filePaths[0];
}

function getElectronFolderDialog(): FolderDialog {
  const desktopWindow = window as typeof window & { require?: (moduleName: string) => ElectronModule };
  const dialog = desktopWindow.require?.("electron").remote?.dialog;
  if (!dialog) throw new Error("Native folder selection is unavailable.");
  return dialog;
}
