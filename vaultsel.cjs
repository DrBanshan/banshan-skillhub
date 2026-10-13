// Resolves the vault selector that the obsidian client needs as its first parameter, and finds the
// vault to test against, both out of Obsidian's own vault registry at
// %APPDATA%\obsidian\obsidian.json. The registry maps a vault id to the folder holding it, and the
// client accepts either the id or the vault name. The id is what this prints, because a name can
// collide with another vault.
//
//   node vaultsel.cjs <vault folder>   prints the selector for one folder, vault=<id> or
//                                      vault=<name> when the folder is not in the registry
//   node vaultsel.cjs --detect         prints two lines, the vault folder then its selector, picking
//                                      the registered vault that has this plugin installed, most
//                                      recently opened first. Guidance to standard error and exit 3
//                                      when nothing usable is registered
//   node vaultsel.cjs --list           lists every registered vault and marks which ones can be used
//
// test.cmd uses this so no vault path is baked into it.

const fs = require("node:fs");
const path = require("node:path");

const PLUGIN_FOLDER = "banshan-skillhub";

function normal(value) {
  return String(value || "").replace(/[\/\\]+$/, "").toLowerCase();
}

function registryFiles() {
  const appData = process.env.APPDATA || "";
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const out = [];
  if (appData) out.push(path.join(appData, "obsidian", "obsidian.json"));
  if (home) out.push(path.join(home, "AppData", "Roaming", "obsidian", "obsidian.json"));
  return out;
}

function readRegistry() {
  for (const file of registryFiles()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && parsed.vaults) return { file, vaults: parsed.vaults };
    } catch (error) {
      // a missing or unreadable registry just means there is nothing to look up
    }
  }
  return { file: "", vaults: {} };
}

function pluginInstalled(vaultPath) {
  const base = path.join(vaultPath, ".obsidian", "plugins", PLUGIN_FOLDER);
  try {
    // existsSync follows a link, and a linked plugin folder is how the development setup of this
    // very repository is arranged
    return fs.existsSync(path.join(base, "manifest.json")) || fs.existsSync(path.join(base, "main.js"));
  } catch (error) {
    return false;
  }
}

function usable(vaultPath) {
  try {
    return fs.existsSync(vaultPath) && fs.statSync(vaultPath).isDirectory();
  } catch (error) {
    return false;
  }
}

function selectorFor(vaultPath) {
  const base = String(vaultPath).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(vaultPath);
  // printed raw rather than quoted: the caller wraps it, and a quoted token read back through a
  // for /f loop would come apart at the space
  return "vault=" + base;
}

function selectorFromRegistry(vaults, vaultPath) {
  const wanted = normal(vaultPath);
  for (const [id, entry] of Object.entries(vaults || {})) {
    const listed = entry && entry.path;
    if (listed && normal(listed) === wanted) return "vault=" + id;
  }
  return selectorFor(vaultPath);
}

function entries(vaults) {
  return Object.entries(vaults || {}).map(([id, entry]) => ({
    id: id,
    path: String((entry && entry.path) || ""),
    ts: Number((entry && entry.ts) || 0)
  })).filter((entry) => entry.path.length > 0);
}

function newest(left, right) {
  return right.ts > left.ts ? right : left;
}

function listMode() {
  const registry = readRegistry();
  const all = entries(registry.vaults);
  if (all.length === 0) {
    process.stdout.write("no vaults are registered in " + (registry.file || "the Obsidian settings") + "\n");
    return 3;
  }
  process.stdout.write("vaults registered in " + registry.file + "\n\n");
  for (const entry of all.slice().sort(newest)) {
    const state = !usable(entry.path)
      ? "folder missing"
      : pluginInstalled(entry.path) ? "ready, " + PLUGIN_FOLDER + " is installed" : "usable, no " + PLUGIN_FOLDER;
    process.stdout.write("  " + entry.id + "  " + state + "\n      " + entry.path + "\n");
  }
  process.stdout.write("\nrun:  test.cmd vault=<folder>\n");
  return 0;
}

function detectMode() {
  const registry = readRegistry();
  const usableEntries = entries(registry.vaults).filter((entry) => usable(entry.path));
  if (usableEntries.length === 0) {
    process.stderr.write(
      "No vault in " + (registry.file || "the Obsidian settings") + " points at a folder that exists.\n" +
      "Open the vault in Obsidian, or pass one:  test.cmd vault=C:\\path\\to\\vault\n"
    );
    return 3;
  }

  const ready = usableEntries.filter((entry) => pluginInstalled(entry.path));
  const pool = ready.length > 0 ? ready : usableEntries.slice().sort(newest);
  const picked = pool.reduce(newest);

  if (ready.length === 0) {
    process.stderr.write(
      "None of the registered vaults has " + PLUGIN_FOLDER + " installed, so the run cannot reach the plugin.\n" +
      "Install and enable it in a vault, or pass one:  test.cmd vault=C:\\path\\to\\vault\n"
    );
  } else if (ready.length > 1) {
    const others = ready.filter((entry) => entry.id !== picked.id).map((entry) => entry.path).join(", ");
    process.stderr.write(
      "Several registered vaults have " + PLUGIN_FOLDER + " installed, so the most recently opened was taken:\n  " +
      picked.path + "\nOthers: " + others + "\nPass one to be sure:  test.cmd vault=C:\\path\\to\\vault\n"
    );
  }

  process.stdout.write(picked.path + "\n" + selectorFromRegistry(registry.vaults, picked.path) + "\n");
  return 0;
}

function singleMode(wanted) {
  const registry = readRegistry();
  process.stdout.write(selectorFromRegistry(registry.vaults, wanted) + "\n");
  return 0;
}

const args = process.argv.slice(2);
const first = (args[0] || "").toLowerCase().replace(/^-+/, "");

if (first === "list") {
  process.exit(listMode());
} else if (first === "detect") {
  process.exit(detectMode());
} else if (args.length === 0) {
  process.stderr.write(
    "usage: node vaultsel.cjs <vault folder>\n" +
    "       node vaultsel.cjs --detect\n" +
    "       node vaultsel.cjs --list\n"
  );
  process.exit(2);
} else {
  process.exit(singleMode(args[0]));
}
