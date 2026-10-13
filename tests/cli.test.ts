import { describe, expect, it, vi } from "vitest";
import {
  CLI_COMMAND_PREFIX,
  CLI_DISABLED_MESSAGE,
  CLI_ERROR_PREFIX,
  CliError,
  commandName,
  createCliHandler,
  parseCliArgs,
  registerSkillHubCli,
  renderOutcome,
  usageText,
  rankSkillMatches,
  skillMatches,
  skillRecordRows,
  installTargetViolation,
  splitSkillSelector,
  SKILL_ROW_COLUMNS
} from "../src/cli";
import type { SkillRecord } from "../src/types";
import type { CliCommandDefinition, CliFlags, CliHandler, SkillHubCliBridge } from "../src/cli";

interface Registration {
  command: string;
  description: string;
  flags: CliFlags | null;
  handler: CliHandler;
}

function createHost() {
  const registrations: Registration[] = [];
  return {
    registrations,
    registerCliHandler(command: string, description: string, flags: CliFlags | null, handler: CliHandler): void {
      registrations.push({ command, description, flags, handler });
    }
  };
}

function createBridge(overrides: Partial<SkillHubCliBridge> = {}): SkillHubCliBridge & { calls: Array<{ action: string; dryrun: boolean; confirm: boolean }> } {
  const calls: Array<{ action: string; dryrun: boolean; confirm: boolean }> = [];
  return {
    calls,
    cliEnabled: () => true,
    vaultBasePath: () => "/vault",
    rememberedInstallTargets: () => ["/vault/../agents"],
    execute: (action, args) => {
      calls.push({ action, dryrun: args.dryrun, confirm: args.confirm });
      return { action, ok: true, message: `${action} done` };
    },
    ...overrides
  };
}

function createSkill(id: string, overrides: Partial<SkillRecord> = {}): SkillRecord {
  return {
    id,
    folderName: id,
    vaultPath: `Skill/${id}`,
    originalName: id,
    nickname: id,
    description: "",
    tags: [],
    collectionIds: [],
    source: { type: "local", path: `/tmp/${id}` },
    importMethod: "local",
    warnings: [],
    importedAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    installCount: 0,
    ...overrides
  };
}
const capability: CliCommandDefinition = { action: "list", description: "List skills" };
const gated: CliCommandDefinition = { action: "info", description: "Report environment", readonlyGate: true };
const destructive: CliCommandDefinition = { action: "uninstall", description: "Remove installed entries", destructive: true };

describe("cli argument parsing", () => {
  it("reads named key=value parameters and treats flag values as truthy", () => {
    const args = parseCliArgs({ skill: "writer", target: "C:/agents", json: "true", dryrun: "1", confirm: "yes" });
    expect(args.value("skill")).toBe("writer");
    expect(args.required("target")).toBe("C:/agents");
    expect(args.format).toBe("json");
    expect(args.dryrun).toBe(true);
    expect(args.confirm).toBe(true);
    expect(args.flag("missing")).toBe(false);
  });

  it("ignores positional style parameters instead of binding them", () => {
    const args = parseCliArgs({ "0": "list", "1": "writer", folder: "writer" });
    expect(args.value("0")).toBeUndefined();
    expect(args.value("1")).toBeUndefined();
    expect(Object.keys(args.raw)).toEqual(["folder"]);
    expect(args.value("folder")).toBe("writer");
  });

  it("drops undefined parameters and defaults to text output", () => {
    const args = parseCliArgs({ skill: "writer", empty: undefined });
    expect(Object.keys(args.raw)).toEqual(["skill"]);
    expect(args.format).toBe("text");
    expect(args.dryrun).toBe(false);
    expect(args.confirm).toBe(false);
  });

  it("honours an explicit format value and rejects unknown ones", () => {
    expect(parseCliArgs({ format: "tsv" }).format).toBe("tsv");
    expect(parseCliArgs({ format: "JSON" }).format).toBe("json");
    expect(parseCliArgs({ format: "yaml" }).format).toBe("text");
    expect(parseCliArgs({ json: "true", format: "tsv" }).format).toBe("json");
  });

  it("exposes the vault selector and throws a cli error for missing required values", () => {
    const args = parseCliArgs({ vault: "Personal", blank: "   " });
    expect(args.vault).toBe("Personal");
    expect(() => args.required("blank")).toThrow(CliError);
    expect(() => args.required("blank")).toThrow("Missing required parameter blank=<value>.");
    expect(() => args.required("vault")).not.toThrow();
  });
});

describe("cli handler gate", () => {
  it("refuses capability commands while the gate is off and never reaches the bridge", async () => {
    const bridge = createBridge({ cliEnabled: () => false });
    const output = await createCliHandler(capability, bridge)({});
    expect(output).toBe(`${CLI_ERROR_PREFIX}${CLI_DISABLED_MESSAGE}`);
    expect(bridge.calls).toEqual([]);
  });

  it("still runs gate-reporting commands while the gate is off", async () => {
    const bridge = createBridge({ cliEnabled: () => false });
    const output = await createCliHandler(gated, bridge)({});
    expect(output).toBe("info done");
    expect(bridge.calls).toEqual([{ action: "info", dryrun: false, confirm: false }]);
  });

  it("flipping the gate on mid session takes effect without re-registration", async () => {
    let enabled = false;
    const bridge = createBridge({ cliEnabled: () => enabled });
    expect((await createCliHandler(capability, bridge)({})).startsWith(CLI_ERROR_PREFIX)).toBe(true);
    enabled = true;
    expect(await createCliHandler(capability, bridge)({})).toBe("list done");
  });
});

describe("cli handler validation", () => {
  it("reports missing required parameters before delegating", async () => {
    const bridge = createBridge();
    const definition: CliCommandDefinition = {
      action: "install",
      description: "Install skills",
      mutating: true,
      flags: { target: { value: "<path>", description: "Target directory", required: true } }
    };
    const output = await createCliHandler(definition, bridge)({});
    expect(output).toBe(`${CLI_ERROR_PREFIX}Missing required parameter: target=<value>.`);
    expect(bridge.calls).toEqual([]);
    expect(await createCliHandler(definition, bridge)({ target: "/agents" })).toBe("install done");
  });

  it("rejects command flags that shadow reserved parameter names", async () => {
    const bridge = createBridge();
    const definition: CliCommandDefinition = {
      action: "scan",
      description: "Scan a directory",
      flags: { json: { description: "Machine readable output" } }
    };
    expect(await createCliHandler(definition, bridge)({})).toBe(`${CLI_ERROR_PREFIX}Parameter name json reserved by the command layer.`);
    expect(bridge.calls).toEqual([]);
  });

  it("hard errors on destructive actions without confirm and accepts confirm or dryrun", async () => {
    const bridge = createBridge();
    const withoutConfirm = await createCliHandler(destructive, bridge)({ target: "/agents" });
    expect(withoutConfirm.startsWith(CLI_ERROR_PREFIX)).toBe(true);
    expect(withoutConfirm).toContain("confirm=1");
    expect(bridge.calls).toEqual([]);

    expect(await createCliHandler(destructive, bridge)({ target: "/agents", confirm: "1" })).toBe("uninstall done");
    expect(await createCliHandler(destructive, bridge)({ target: "/agents", dryrun: "1" })).toBe("uninstall done");
    expect(bridge.calls).toEqual([
      { action: "uninstall", dryrun: false, confirm: true },
      { action: "uninstall", dryrun: true, confirm: false }
    ]);
  });

  it("never throws out of a handler, rendering failures as an error line or json", async () => {
    const syncBridge = createBridge({ execute: () => { throw new Error("disk exploded"); } });
    expect(await createCliHandler(capability, syncBridge)({})).toBe(`${CLI_ERROR_PREFIX}disk exploded`);

    const asyncBridge = createBridge({ execute: async () => { throw new Error("async exploded"); } });
    expect(await createCliHandler(capability, asyncBridge)({})).toBe(`${CLI_ERROR_PREFIX}async exploded`);

    const nonObject = createBridge({ execute: () => undefined as never });
    expect(await createCliHandler(capability, nonObject)({})).toContain("produced no result");

    const jsonBridge = createBridge({ execute: () => { throw new Error("disk exploded"); } });
    const payload = JSON.parse(await createCliHandler(capability, jsonBridge)({ json: "true" }));
    expect(payload).toEqual({ action: "banshan-skillhub:list", ok: false, message: "disk exploded", rows: undefined });
  });

  it("accepts a bridge that resolves later", async () => {
    const bridge = createBridge({
      execute: async (action) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { action, ok: true, message: "slow ok" };
      }
    });
    expect(await createCliHandler(capability, bridge)({})).toBe("slow ok");
  });
});

describe("cli rendering", () => {
  it("emits stable json records", async () => {
    const payload = JSON.parse(renderOutcome({
      action: "banshan-skillhub:list",
      ok: true,
      message: "2 skills",
      data: { installMethod: "symlink" },
      rows: [{ name: "writer", installed: true }, { name: "reader", installed: false }]
    }, "json"));
    expect(payload.action).toBe("banshan-skillhub:list");
    expect(payload.ok).toBe(true);
    expect(payload.data).toEqual({ installMethod: "symlink" });
    expect(payload.rows).toHaveLength(2);
  });

  it("aligns text columns and keeps header order stable", () => {
    const text = renderOutcome({
      action: "list",
      ok: true,
      message: "2 skills",
      rows: [{ name: "writer", note: "ok" }, { name: "a longer name", note: "skipped" }]
    }, "text");
    const lines = text.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("2 skills");
    expect(lines[1].startsWith("name")).toBe(true);
    expect(lines[1].length).toBe(lines[2].length);
    expect(lines[2]).toContain("writer");
    expect(lines[3]).toContain("a longer name");
  });

  it("emits tab separated rows for tsv and falls back to a terse status", () => {
    const tsv = renderOutcome({ action: "list", ok: true, columns: ["name", "source"], rows: [{ source: "local", name: "writer" }] }, "tsv");
    expect(tsv).toBe("name\tsource\nwriter\tlocal");
    expect(renderOutcome({ action: "refresh", ok: true }, "text")).toBe("refresh: ok");
    expect(renderOutcome({ action: "refresh", ok: false }, "text")).toBe("refresh: failed");
  });
});

describe("cli registration", () => {
  it("registers each command once with the plugin id prefix", () => {
    const host = createHost();
    const bridge = createBridge();
    const definitions: CliCommandDefinition[] = [capability, gated, destructive, { action: "", description: "Show usage" }];

    expect(registerSkillHubCli(host, bridge, definitions)).toBe(true);
    expect(registerSkillHubCli(host, bridge, definitions)).toBe(false);
    expect(host.registrations).toHaveLength(4);
    for (const registration of host.registrations) {
      expect(registration.command.startsWith(CLI_COMMAND_PREFIX)).toBe(true);
      expect(registration.command).toBe(commandName(registration.command.split(":")[1] ?? ""));
      expect(registration.description).toMatch(/^[A-Z]/);
    }
    expect(host.registrations.map((entry) => entry.command)).toEqual([
      CLI_COMMAND_PREFIX,
      "banshan-skillhub:info",
      "banshan-skillhub:list",
      "banshan-skillhub:uninstall"
    ]);
  });

  it("keeps registration isolated per plugin instance", () => {
    const first = createHost();
    const second = createHost();
    const bridge = createBridge();
    expect(registerSkillHubCli(first, bridge, [capability])).toBe(true);
    expect(registerSkillHubCli(second, bridge, [capability])).toBe(true);
    expect(first.registrations).toHaveLength(1);
    expect(second.registrations).toHaveLength(1);
  });

  it("prints usage for the bare command and marks mutating actions", async () => {
    const bridge = createBridge();
    const definitions: CliCommandDefinition[] = [{ action: "", description: "Show usage" }, capability, destructive];
    const output = await createCliHandler(definitions[0], bridge, definitions)({});
    expect(output).toContain(`Usage: obsidian [vault=<name|id>] ${CLI_COMMAND_PREFIX}[:<action>]`);
    expect(output).toContain("banshan-skillhub:list");
    expect(output).toContain("[destructive]");
    expect(output).not.toContain("[mutating]");
    expect(bridge.calls).toEqual([]);
  });

  it("reports when no actions exist yet", () => {
    expect(usageText([{ action: "", description: "Show usage" }])).toContain("(none registered yet)");
  });

  it("passes declared flags through untouched and null when absent", () => {
    const host = createHost();
    const bridge = createBridge();
    const flags: CliFlags = { skill: { value: "<name>", description: "Skill folder name", required: true } };
    registerSkillHubCli(host, bridge, [{ action: "show", description: "Show one skill", flags }]);
    expect(host.registrations[0].flags).toEqual(flags);
    expect(host.registrations[0].flags?.skill?.required).toBe(true);
    registerSkillHubCli(createHost(), bridge, []);
    const empty = createHost();
    registerSkillHubCli(empty, bridge, [{ action: "refresh", description: "Refresh the view" }]);
    expect(empty.registrations[0].flags).toBeNull();
  });
});

describe("cli skill helpers", () => {
  const writer = createSkill("writer", { tags: ["docs", "writing"], description: "Drafts documents", installCount: 3 });
  const reviewer = createSkill("reviewer", { nickname: "code reviewer", originalName: "ReviewBot", installCount: 7, source: { type: "github", url: "https://gitlab.example/acme/reviewer" }, importMethod: "github" });
  const planner = createSkill("planner", { tags: ["docs"], installCount: 7, source: { type: "npx", command: "npx skills add acme/planner" }, importMethod: "npx" });
  const all = [writer, reviewer, planner];

  it("matches across nickname, tags, description and the recorded import source", () => {
    expect(skillMatches(reviewer, "review", "")).toBe(true);
    expect(skillMatches(reviewer, "reviewbot", "")).toBe(true);
    expect(skillMatches(writer, "drafts", "")).toBe(true);
    expect(skillMatches(writer, "writing", "")).toBe(true);
    expect(skillMatches(planner, "acme/planner", "")).toBe(true);
    expect(skillMatches(writer, "REVIEW", "")).toBe(false);
    expect(skillMatches(writer, "", "")).toBe(true);
  });

  it("narrows results by import source without regard to letter case", () => {
    expect(all.filter((record) => skillMatches(record, "", "github")).map((record) => record.id)).toEqual(["reviewer"]);
    expect(all.filter((record) => skillMatches(record, "docs", "NPX")).map((record) => record.id)).toEqual(["planner"]);
    expect(all.filter((record) => skillMatches(record, "", "missing-source"))).toEqual([]);
  });

  it("ranks exact nicknames first, then install count, then name", () => {
    const docs = createSkill("docs", { tags: ["documentation"] });
    const pool = [writer, reviewer, planner, docs];
    const docsMatches = pool.filter((record) => skillMatches(record, "docs", ""));
    expect(docsMatches.map((record) => record.id)).toEqual(["writer", "planner", "docs"]);
    expect(rankSkillMatches(docsMatches, "docs").map((record) => record.id)).toEqual(["docs", "planner", "writer"]);
    expect(rankSkillMatches(pool.filter((record) => skillMatches(record, "code reviewer", "")), "code reviewer").map((record) => record.id)).toEqual(["reviewer"]);
    expect(rankSkillMatches(pool, "").map((record) => record.id)).toEqual(["reviewer", "planner", "writer", "docs"]);
    expect(rankSkillMatches(pool, "")).not.toBe(pool);
  });

  it("shapes rows in the shared column order", () => {
    const rows = skillRecordRows([reviewer]);
    expect(Object.keys(rows[0])).toEqual(SKILL_ROW_COLUMNS.slice());
    expect(rows[0]).toMatchObject({ name: "code reviewer", original: "ReviewBot", source: "github", imported: "github", installs: 7 });
    expect(skillRecordRows([])).toEqual([]);
  });
});

describe("cli install guards", () => {
  const vault = "/home/agent/notes";
  const home = "/home/agent";

  it("rejects filesystem roots and the home directory", () => {
    expect(installTargetViolation("/", vault, home)).toContain("filesystem root");
    expect(installTargetViolation("/home/agent", vault, home)).toContain("home directory");
    expect(installTargetViolation("/home/agent/", vault, home)).toContain("home directory");
    expect(installTargetViolation("/home/AGENT", vault, home)).toContain("home directory");
  });

  it("rejects a target at or below the vault", () => {
    expect(installTargetViolation(vault, vault, home)).toContain("inside the vault");
    expect(installTargetViolation("/home/agent/notes/Skill/writer", vault, home)).toContain("inside the vault");
    expect(installTargetViolation("/home/agent/notes/../notes", vault, home)).toContain("inside the vault");
  });

  it("accepts an outside directory that only has to exist for the caller to check", () => {
    expect(installTargetViolation("/home/agent/.agents", vault, home)).toBeUndefined();
    expect(installTargetViolation("/../shared/agents", vault, home)).toBeUndefined();
    expect(installTargetViolation("/home/agents-daemon", vault, home)).toBeUndefined();
  });

  it("splits skill selectors and understands the wildcard spellings", () => {
    expect(splitSkillSelector("")).toBe("all");
    expect(splitSkillSelector("*")).toBe("all");
    expect(splitSkillSelector(" ALL ")).toBe("all");
    expect(splitSkillSelector("writer, reviewer")).toEqual(["writer", "reviewer"]);
    expect(splitSkillSelector(" writer , , writer ")).toEqual(["writer", "writer"]);
    expect(splitSkillSelector("writer")).toEqual(["writer"]);
  });
});

describe("cli module purity", () => {
  it("is usable without touching the Obsidian runtime", async () => {
    const cliModule = await vi.importActual<typeof import("../src/cli")>("../src/cli");
    expect(Object.keys(cliModule).sort()).toEqual([
      "CLI_COMMAND_PREFIX",
      "CLI_DISABLED_MESSAGE",
      "CLI_ERROR_PREFIX",
      "CliError",
      "SKILL_ROW_COLUMNS",
      "commandName",
      "createCliHandler",
      "installTargetViolation",
      "parseCliArgs",
      "rankSkillMatches",
      "registerSkillHubCli",
      "renderOutcome",
      "skillMatches",
      "skillRecordRows",
      "splitSkillSelector",
      "usageText"
    ]);
  });
});
