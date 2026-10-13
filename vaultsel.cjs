// Prints the vault selector token that the obsidian client needs as its first parameter,
// resolved from Obsidian's own vault registry so nothing has to be typed by hand.
//
//   node vaultsel.cjs <vault folder>
//
// The registry at %APPDATA%\obsidian\obsidian.json maps a vault id to its folder.
// The client accepts either the id or the vault name, per the official CLI docs,
// and the id is the safer of the two because it can not collide with another vault name.
// When the folder is not in the registry the vault name falls back to the folder name.

const fs = require("node:fs");
const path = require("node:path");

function normal(value) {
  return String(value || "").replace(/[\/]+$/, "").toLowerCase();
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
      if (parsed && parsed.vaults) return parsed.vaults;
    } catch (error) {
      // a missing or unreadable registry just means there is no id to look up
    }
  }
  return null;
}

const wanted = process.argv[2] || "";
if (!wanted) {
  process.stderr.write("usage: node vaultsel.cjs <vault folder>\n");
  process.exit(2);
}

const vaults = readRegistry();
let selector = "";

if (vaults) {
  for (const [id, entry] of Object.entries(vaults)) {
    const listed = entry && entry.path;
    if (normal(listed) && normal(listed) === normal(wanted)) {
      selector = "vault=" + id;
      break;
    }
  }
}

if (!selector) {
  // fall back to the vault name, which is the folder name for most vaults
  const base = wanted.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || wanted;
  selector = base.indexOf(" ") >= 0 ? 'vault="' + base + '"' : "vault=" + base;
}

process.stdout.write(selector + "\n");
