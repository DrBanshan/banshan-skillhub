import type { CliData, CliFlags, CliHandler } from "obsidian";
import { isAbsolute, parse, relative, resolve } from "path";
import type { SkillRecord } from "./types";

export type { CliData, CliFlags, CliHandler } from "obsidian";

/**
 * Headless command layer for the Obsidian command line interface.
 * This module owns argument parsing, gate checks, outcome rendering and registration only.
 * Every capability is delegated to a bridge implemented by the plugin, which keeps this file free of
 * Electron, folder pickers, modals and Notice usage so it stays safe for automation.
 */

export const CLI_COMMAND_PREFIX = "banshan-skillhub";
export const CLI_ERROR_PREFIX = "ERROR: ";
export const CLI_DISABLED_MESSAGE =
  "Skill Hub command line support is off. Enable it in Settings -> Community plugins -> Skill Hub -> Enable Skill Hub command line actions.";

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
  const declared = declaredFormat(raw);
  if (declared) return declared;
  if (isTruthyParam(raw.json)) return "json";
  const plain = typeof raw.format === "string" ? raw.format.toLowerCase() : undefined;
  if (plain === "json" || plain === "tsv" || plain === "text") return plain;
  return "text";
}

// The Obsidian command line documents its output format as a flag, so a request can arrive spelled as
// --format=json, --json, or, where the token keeps its dashes, with the value folded into the key itself.
// Recognising every shape keeps one spelling working whichever way the command line hands it over.
function declaredFormat(raw: Readonly<Record<string, string | boolean>>): CliFormat | undefined {
  for (const key of Object.keys(raw)) {
    const name = key.replace(/^-+/, "").toLowerCase();
    const split = name.indexOf("=");
    const head = split >= 0 ? name.slice(0, split) : name;
    const carried = split >= 0 ? name.slice(split + 1) : undefined;
    if (head === "json") return "json";
    if (head !== "format") continue;
    const wanted = String(carried ?? (typeof raw[key] === "string" ? raw[key] : "")).toLowerCase();
    if (wanted === "json" || wanted === "tsv" || wanted === "text") return wanted;
  }
  return undefined;
}

function isPositionalKey(key: string): boolean {
  return /^[0-9]+$/.test(key);
}

function copyParams(params: CliData | Record<string, string | true | undefined>): Record<string, string | boolean> {
  const copied: Record<string, string | boolean> = {};
  for (const key of Object.keys(params)) {
    if (isPositionalKey(key)) continue;
    const value = params[key];
    for (const name of parameterNames(key)) {
      if (typeof value === "string") {
        if (copied[name] === undefined) copied[name] = value;
        continue;
      }
      if (value !== true) continue;
      const folded = foldInlineValue(name);
      if (folded) {
        if (copied[folded[0]] === undefined) copied[folded[0]] = folded[1];
      } else if (copied[name] === undefined) {
        copied[name] = true;
      }
    }
  }
  return copied;
}

// A parameter can reach the plugin as `name=value`, as `--name=value`, or as one token that kept both its
// dashes and its value. Every spelling has to land under the plain name the action reads, so the aliases are
// registered side by side instead of guessing at one form.
function parameterNames(key: string): string[] {
  const stripped = key.replace(/^-+/, "");
  return stripped === key ? [key] : [key, stripped];
}

function foldInlineValue(name: string): [string, string] | undefined {
  const split = name.indexOf("=");
  if (split <= 0) return undefined;
  return [name.slice(0, split), name.slice(split + 1)];
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

export const SKILL_ROW_COLUMNS = ["name", "original", "folder", "tags", "source", "imported", "installs", "updatedAt"];

function skillHaystack(record: SkillRecord): string {
  return [
    record.nickname,
    record.originalName,
    record.folderName,
    record.description,
    record.tags.join(" "),
    record.source.path ?? "",
    record.source.url ?? "",
    record.source.command ?? ""
  ].join(" ").toLowerCase();
}

/** Case-insensitive substring match over the fields an agent would type; an empty filter matches everything. */
export function skillMatches(record: SkillRecord, filter: string, source: string): boolean {
  const wantedSource = source.trim().toLowerCase();
  if (wantedSource.length > 0 && record.source.type !== wantedSource) return false;
  const wanted = filter.trim().toLowerCase();
  if (wanted.length === 0) return true;
  return skillHaystack(record).includes(wanted);
}

/** Exact nickname hits first, then the most installed, then alphabetical so output stays stable between runs. */
export function rankSkillMatches(records: readonly SkillRecord[], query: string): SkillRecord[] {
  const wanted = query.trim().toLowerCase();
  return records.slice().sort((left, right) => {
    const leftExact = left.nickname.toLowerCase() === wanted ? 0 : 1;
    const rightExact = right.nickname.toLowerCase() === wanted ? 0 : 1;
    if (leftExact !== rightExact) return leftExact - rightExact;
    if (right.installCount !== left.installCount) return right.installCount - left.installCount;
    return left.nickname.localeCompare(right.nickname);
  });
}

export function skillRecordRows(records: readonly SkillRecord[]): CliRow[] {
  return records.map((record) => ({
    name: record.nickname,
    original: record.originalName,
    folder: record.folderName,
    tags: record.tags.join(", "),
    source: record.source.type,
    imported: record.importMethod,
    installs: record.installCount,
    updatedAt: record.updatedAt
  }));
}

function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

/**
 * Explains why a path is unsafe to install into, or returns nothing when the non filesystem checks pass.
 * Roots and the home directory would bury a whole .agents tree, and installing inside the vault would hand
 * Obsidian link or dot paths it does not index, leaving registry entries the user interface cannot see.
 */
export function installTargetViolation(target: string, vaultPath: string, homePath: string): string | undefined {
  const resolved = resolve(target);
  const normalised = trimTrailingSeparators(resolved);
  const root = trimTrailingSeparators(parse(resolved).root);
  if (normalised.length === 0 || normalised === root) {
    return `Refusing ${target} as an install target because it is a filesystem root.`;
  }
  const home = homePath.trim().length > 0 ? trimTrailingSeparators(resolve(homePath)) : "";
  if (home.length > 0 && normalised.toLowerCase() === home.toLowerCase()) {
    return `Refusing ${target} as an install target because it is the home directory. Point at the directory holding your agents instead.`;
  }
  const relation = relative(resolve(vaultPath), resolved);
  if (relation.length === 0 || (!relation.startsWith("..") && !isAbsolute(relation))) {
    return `Install target ${target} is inside the vault. Install outside the vault so Obsidian does not index the installed links.`;
  }
  return undefined;
}

/** Splits a skill selector into distinct names, or reports that the whole registry was asked for. */
export function splitSkillSelector(selector: string): string[] | "all" {
  const trimmed = selector.trim();
  if (trimmed.length === 0 || trimmed === "*" || trimmed.toLowerCase() === "all") return "all";
  const names = trimmed.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  return names.length > 0 ? names : "all";
}

/**
 * Decides what may be removed at an install destination.
 * Links are always safe because removing one never disturbs the vault side source. Anything real is only
 * removed when the install record proves Skill Hub created it as a copy, so a directory that predates the
 * install is never swept away.
 */
export function uninstallDecision(entry: { state: string; method: string; proven: boolean }): { decision: "removable" | "missing" | "blocked"; reason: string } {
  if (entry.state === "missing") return { decision: "missing", reason: "nothing is installed there" };
  if (entry.state === "symlink") return { decision: "removable", reason: "removes the link only, the skill stays in the vault" };
  if (entry.state === "real") {
    if (entry.proven && entry.method === "copy") return { decision: "removable", reason: "removes the copy Skill Hub created here" };
    return { decision: "blocked", reason: "the install record does not prove Skill Hub created this path, so it is left alone" };
  }
  return { decision: "blocked", reason: `unsupported destination state ${entry.state}` };
}

export function renderOutcome(outcome: CliOutcome, format: CliFormat): string {
  if (format === "json") {
    // Indented so the result stays readable when Obsidian prints it, and so a long payload does not
    // collapse into one enormous line that the console can clip away entirely.
    return JSON.stringify(
      {
        action: outcome.action,
        ok: outcome.ok,
        message: outcome.message ?? undefined,
        data: outcome.data ?? undefined,
        rows: outcome.rows ?? undefined
      },
      null,
      2
    );
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

// Reads of an action must never be gated; only the write half of one is. The wording follows what the
// Obsidian command line documentation uses for its own write commands so scripted callers can match one
// message shape across the tool.
export function writeConfirmationMessage(command: string): string {
  return `${command} removes or overwrites entries. Re-run with confirm=1 to apply, or dryrun=1 to preview what would change.`;
}

export function needsWriteConfirmation(changing: boolean, confirmed: boolean): boolean {
  return changing && !confirmed;
}

export interface UninstallCandidate {
  key: string;
  label: string;
  destination: string;
  method: string;
  proven: boolean;
}

export interface UninstallRemoval {
  key: string;
  label: string;
  destination: string;
  decision: "removable" | "missing" | "blocked" | "failed";
  reason: string;
  mechanism: string;
}

export interface UninstallPlan {
  rows: UninstallRemoval[];
  removable: number;
  removed: number;
  missing: number;
  blocked: number;
  failed: number;
}

// Walks the uninstall candidates through the same decision the command line uses and only ever hands a
// candidate to removeEntry once it has been judged removable. With apply set to false it computes the plan
// alone, which is what dryrun reports and what the tests pin down.
export async function applyUninstallPlan(
  candidates: readonly UninstallCandidate[],
  inspectState: (destination: string) => Promise<string>,
  removeEntry: (candidate: UninstallCandidate) => Promise<void>,
  apply: boolean = true
): Promise<UninstallPlan> {
  const rows: UninstallRemoval[] = [];
  const plan: UninstallPlan = { rows, removable: 0, removed: 0, missing: 0, blocked: 0, failed: 0 };
  for (const candidate of candidates) {
    const state = await inspectState(candidate.destination);
    const verdict = uninstallDecision({ state, method: candidate.method, proven: candidate.proven });
    const row: UninstallRemoval = {
      key: candidate.key,
      label: candidate.label,
      destination: candidate.destination,
      decision: verdict.decision,
      reason: verdict.reason,
      mechanism: candidate.method
    };
    rows.push(row);
    if (verdict.decision === "missing") {
      plan.missing += 1;
      continue;
    }
    if (verdict.decision === "blocked") {
      plan.blocked += 1;
      continue;
    }
    plan.removable += 1;
    if (!apply) continue;
    try {
      await removeEntry(candidate);
      plan.removed += 1;
    } catch (error) {
      row.decision = "failed";
      row.reason = error instanceof Error ? error.message : String(error);
      plan.failed += 1;
    }
  }
  return plan;
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
