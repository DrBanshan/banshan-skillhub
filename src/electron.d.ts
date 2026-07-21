declare module "electron" {
  export const remote: {
    dialog?: {
      showOpenDialog(options: {
        title: string;
        properties: Array<"openDirectory" | "createDirectory">;
      }): Promise<{
        canceled: boolean;
        filePaths: string[];
      }>;
    };
  } | undefined;
}
