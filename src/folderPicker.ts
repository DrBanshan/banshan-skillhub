import { remote } from "electron";
import { selectNativeFolder } from "./folderDialog";

export async function pickNativeFolder(): Promise<string | undefined> {
  return selectNativeFolder(remote?.dialog);
}
