import type { CliData, CliFlags, CliHandler } from "obsidian";

/**
 * Headless command layer for the Obsidian command line interface.
 * This module owns argument parsing, gate checks, outcome rendering and registration only.
 * Every capability is delegated to a bridge implemented by the plugin, which keeps this file free of
 * Electron, folder pickers, modals and Notice usage so it stays safe for automation.
 */

export const CLI_COMMAND_PREFIX = "banshan-skillhub";
export const CLI_ERROR_PREFIX = "ERROR: ";
export const CLI_DISABLED_MESSAGE =
  "Skill Hub command line support is off. Enable it in Settings -> Community plugins -> Skill Hub -> Enable command line interface.";

export type CliFormat = "text" | "json" | "tsv";

export interface CliRow {
  [column: string]: string | number | boolean | null;
}

export interface CliOutcome {
  action: string;
  ok: boolean;
  message?: string;
  rows?: CliRow[];
  columns?: string[];
  data?: unknown;
}

export interface CliArgs {
  readonly raw: Readonly<Record<string, string | boolean>>;
  readonly format: CliFormat;
  readonly dryrun: boolean;
  readonly confirm: boolean;
  readonly vault: string | undefined;
  value(name: string): string | undefined;
  required(name: string): string;
  flag(name: string): boolean;
}

export interface CliCommandDefinition {
  /** Sub-command suffix; an empty string registers the bare plugin command as usage. */
  action: string;
  description: string;
  flags?: CliFlags;
  /** Allowed even while the cliEnabled gate is off, so agents can inspect why things are blocked. */
  readonlyGate?: boolean;
  /** Removes or overwrites anything, so confirm=1 is mandatory unless dryrun=1. */
  destructive?: boolean;
  /** Creates or changes anything, used only to keep usage output honest. */
  mutating?: boolean;
}

export interface SkillHubCliBridge {
  cliEnabled(): boolean;
  vaultBasePath(): string;
  rememberedInstallTargets(): string[];
  execute(action: string, args: CliArgs): Promise<CliOutcome> | CliOutcome;
}

export interface SkillHubCliHost {
  registerCliHandler(command: string, description: string, flags: CliFlags | null, handler: CliHandler): void;
}

const RESERVED_KEYS = ["vault", "json", "format", "dryrun", "confirm"];

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

function isTruthyParam(value: string | boolean | undefined): boolean {
  return value === true || value === "true" || value === "1" || value === "yes" || value === "on";
}

function normalizeFormat(raw: Readonly<Record<string, string | boolean>>): CliFormat {
  if (isTruthyParam(raw.json)) return "json";
  const declared = typeof raw.format === "string" ? raw.format.toLowerCase() : undefined;
  if (declared === "json" || declared === "tsv" || declared === "text") return declared;
  return "text";
}

function copyParams(params: CliData | Record<string, string | true | undefined>): Record<string, string | boolean> {
  const copied: Record<string, string | boolean> = {};
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (typeof value === "string") copied[key] = value;
    else if (value === true) copied[key] = true;
  }
  return copied;
}

export function parseCliArgs(params: CliData | Record<string, string | true | undefined>): CliArgs {
  const raw = copyParams(params);
  const args: CliArgs = {
    raw,
    format: normalizeFormat(raw),
    dryrun: isTruthyParam(raw.dryrun),
    confirm: isTruthyParam(raw.confirm),
    vault: typeof raw.vault === "string" ? raw.vault : undefined,
    value: (name: string) => (typeof raw[name] === "string" ? (raw[name] as string) : undefined),
    required: (name: string) => {
      const value = typeof raw[name] === "string" ? (raw[name] as string).trim() : "";
      if (value.length === 0) throw new CliError(`Missing required parameter ${name}=<value>.`);
      return value;
    },
    flag: (name: string) => isTruthyParam(raw[name])
  };
  return args;
}

function reservedNames(flags: CliFlags | undefined): string[] {
  const names: string[] = [];
  for (const flag of Object.keys(flags ?? {})) {
    if (RESERVED_KEYS.includes(flag)) names.push(flag);
  }
  return names;
}

function missingRequiredFlags(flags: CliFlags | undefined, args: CliArgs): string[] {
  const missing: string[] = [];
  for (const name of Object.keys(flags ?? {})) {
    if (flags?.[name]?.required !== true) continue;
    if (RESERVED_KEYS.includes(name)) {
      if (!args.flag(name) && args.value(name) === undefined) missing.push(name);
    } else if (args.value(name) === undefined) {
      missing.push(name);
    }
  }
  return missing;
}

function columnOrder(outcome: CliOutcome): string[] {
  if (outcome.columns && outcome.columns.length > 0) return outcome.columns.slice();
  const seen: string[] = [];
  for (const row of outcome.rows ?? []) {
    for (const key of Object.keys(row)) {
      if (!seen.includes(key)) seen.push(key);
    }
  }
  return seen;
}

export function renderOutcome(outcome: CliOutcome, format: CliFormat): string {
  if (format === "json") {
    return JSON.stringify({
      action: outcome.action,
      ok: outcome.ok,
      message: outcome.message ?? undefined,
      data: outcome.data ?? undefined,
      rows: outcome.rows ?? undefined
    });
  }

  const lines: string[] = [];
  if (outcome.message) lines.push(outcome.message);
  const rows = outcome.rows ?? [];
  if (rows.length > 0) {
    const columns = columnOrder(outcome);
    if (format === "tsv") {
      lines.push(columns.join("\t"));
      for (const row of rows) lines.push(columns.map((column) => String(row[column] ?? "")).join("\t"));
    } else {
      const widths: number[] = columns.map((column) => column.length);
      const cells = rows.map((row) => columns.map((column, index) => {
        const text = String(row[column] ?? "");
        widths[index] = Math.max(widths[index], text.length);
        return text;
      }));
      lines.push(columns.map((column, index) => column.padEnd(widths[index], " ")).join("  "));
      for (const cell of cells) lines.push(cell.map((text, index) => text.padEnd(widths[index], " ")).join("  "));
    }
  }
  if (lines.length === 0) return outcome.ok ? `${outcome.action}: ok` : `${outcome.action}: failed`;
  return lines.join("\n");
}

export function commandName(action: string): string {
  return action.length === 0 ? CLI_COMMAND_PREFIX : `${CLI_COMMAND_PREFIX}:${action}`;
}

export function usageText(commands: readonly CliCommandDefinition[]): string {
  const lines: string[] = [`Usage: obsidian [vault=<name|id>] ${CLI_COMMAND_PREFIX}[:<action>] [key=value ...] [flag]`, "", "Actions:"];
  const usable = commands.filter((command) => command.action.length > 0);
  if (usable.length === 0) {
    lines.push("  (none registered yet)");
    return lines.join("\n");
  }
  const width = usable.reduce((widest, command) => Math.max(widest, commandName(command.action).length), 0);
  for (const command of usable) {
    const marker = command.destructive ? " [destructive]" : command.mutating ? " [mutating]" : "";
    lines.push(`  ${commandName(command.action).padEnd(width, " ")}  ${command.description}${marker}`);
  }
  lines.push("");
  lines.push("Common flags: vault=<name|id>  json  format=text|json|tsv  dryrun=1  confirm=1");
  lines.push("Destructive actions refuse to run without confirm=1; dryrun=1 reports the plan without touching disk.");
  return lines.join("\n");
}

export function createCliHandler(
  definition: CliCommandDefinition,
  bridge: SkillHubCliBridge,
  commands?: readonly CliCommandDefinition[]
): CliHandler {
  return async (params: CliData) => {
    try {
      const args = parseCliArgs(params);

      if (!bridge.cliEnabled() && definition.readonlyGate !== true) {
        throw new CliError(CLI_DISABLED_MESSAGE);
      }
      if (definition.action.length === 0) return usageText(commands ?? [definition]);

      const missing = missingRequiredFlags(definition.flags, args);
      if (missing.length > 0) throw new CliError(`Missing required parameter${missing.length === 1 ? "" : "s"}: ${missing.map((name) => `${name}=<value>`).join(", ")}.`);
      const shadowed = reservedNames(definition.flags);
      if (shadowed.length > 0) throw new CliError(`Parameter name${shadowed.length === 1 ? "" : "s"} ${shadowed.join(", ")} reserved by the command layer.`);
      if (definition.destructive === true && !args.dryrun && !args.confirm) {
        throw new CliError(`${commandName(definition.action)} removes or overwrites entries. Re-run with confirm=1 to apply, or dryrun=1 to preview.`);
      }

      const outcome = await bridge.execute(definition.action, args);
      if (!outcome || typeof outcome.action !== "string") throw new CliError(`${commandName(definition.action)} produced no result.`);
      return renderOutcome({ ...outcome, action: outcome.action || definition.action }, args.format);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const args = safeParse(params);
      if (args.format === "json") {
        return JSON.stringify({ action: commandName(definition.action), ok: false, message: detail, rows: undefined });
      }
      return `${CLI_ERROR_PREFIX}${detail}`;
    }
  };
}

function safeParse(params: CliData): CliArgs {
  try {
    return parseCliArgs(params);
  } catch {
    return parseCliArgs({});
  }
}

/**
 * Registers every command exactly once per plugin instance.
 * The command line interface throws on duplicate command ids, so hot reloads must not re-register.
 */
export function registerSkillHubCli(host: SkillHubCliHost, bridge: SkillHubCliBridge, commands: readonly CliCommandDefinition[]): boolean {
  const guard = host as SkillHubCliHost & { skillHubCliRegistered?: boolean };
  if (guard.skillHubCliRegistered === true) return false;
  const declared = commands.slice().sort((left, right) => left.action.localeCompare(right.action));
  for (const definition of declared) {
    host.registerCliHandler(commandName(definition.action), definition.description, definition.flags ?? null, createCliHandler(definition, bridge, declared));
  }
  guard.skillHubCliRegistered = true;
  return true;
}
