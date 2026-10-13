import { readFile } from "fs/promises";
import { describe, expect, it } from "vitest";

async function sourceOf(file: string): Promise<string> {
  return await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
}

function moduleLines(source: string, moduleName: string): string[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("import") || line.startsWith("export"))
    .filter((line) => line.includes(`"${moduleName}"`));
}

describe("command line layer stays headless", () => {
  it("only reaches Obsidian through type-only imports", async () => {
    const cliSource = await sourceOf("cli.ts");
    const obsidianModules = moduleLines(cliSource, "obsidian");
    expect(obsidianModules.length).toBeGreaterThan(0);
    for (const line of obsidianModules) {
      expect(line.startsWith("import type") || line.startsWith("export type")).toBe(true);
    }
  });

  it("never reaches Electron, the folder picker or any modal surface", async () => {
    const cliSource = await sourceOf("cli.ts");
    expect(moduleLines(cliSource, "electron")).toEqual([]);
    expect(moduleLines(cliSource, "./folderPicker")).toEqual([]);
    expect(moduleLines(cliSource, "./ui/modals")).toEqual([]);
    expect(moduleLines(cliSource, "./ui/SkillHubView")).toEqual([]);
    expect(cliSource).not.toContain("new Notice(");
    expect(cliSource).not.toContain(".open()");
    expect(cliSource).not.toContain("document.createElement");
    expect(cliSource).not.toContain("window.");
    expect(cliSource).not.toContain("require(");
  });

  it("keeps the plugin side as the single owner of state and services", async () => {
    const cliSource = await sourceOf("cli.ts");
    expect(moduleLines(cliSource, "./main")).toEqual([]);
    expect(moduleLines(cliSource, "./registry")).toEqual([]);
    expect(moduleLines(cliSource, "./exportService")).toEqual([]);
    expect(moduleLines(cliSource, "./importService")).toEqual([]);
    expect(moduleLines(cliSource, "./skillDiscovery")).toEqual([]);
  });

  it("routes registration through the guarded entry point only", async () => {
    const mainSource = await sourceOf("main.ts");
    expect(mainSource).toContain("this.registerCommandLine();");
    expect(mainSource).toContain("registerSkillHubCli(");
    expect(mainSource).not.toMatch(/this\.registerCliHandler\(/);
    expect(mainSource).not.toMatch(/manifest\.id\s*\+\s*"/);
  });

  it("builds every command id from the plugin prefix instead of hard coding it", async () => {
    const mainSource = await sourceOf("main.ts");
    const cliSource = await sourceOf("cli.ts");

    expect(cliSource).toContain("CLI_COMMAND_PREFIX");
    expect(cliSource).toContain("export function commandName(");
    expect(mainSource).not.toContain("\"banshan-skillhub:");

    const actions = [...mainSource.matchAll(/action:\s*"([^"]*)"/g) ?? []].map((match) => String(match[1]));
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action).not.toContain(":");
      expect(action).not.toContain(" ");
    }
  });

  it("keeps the gate and the confirm rule inside the command layer", async () => {
    const cliSource = await sourceOf("cli.ts");
    const mainSource = await sourceOf("main.ts");
    expect(cliSource).toContain("CLI_DISABLED_MESSAGE");
    expect(cliSource).toContain("readonlyGate");
    expect(cliSource).toContain("confirm=1");
    expect(mainSource).toContain("cliEnabled: () =>");
  });
});
