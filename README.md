# Banshan Skill Hub

Banshan Skill Hub is a desktop plugin for importing, organizing, and installing AI agent skills from a vault-managed library.

Use it when you collect reusable agent skills from GitHub, local folders, or `npx skills add ...`, and want a visual place to manage them before installing selected skills into an agent workspace.

## Who It Is For

- People who maintain a personal or team library of AI agent skills.
- Codex and agent users who frequently install skills into `.agents/skills`.
- Skill authors who want to test, group, and reuse skill folders across projects.
- Workflow builders who want curated collections of skills for coding, research, writing, debugging, or other recurring tasks.

## What It Can Do

### Import Skills

Skill Hub can import skills from three sources:

- **GitHub import:** Enter a GitHub URL that points to a directory containing a `skills/` folder. Skill Hub lists the skills it finds there and lets you choose which ones to import. It does not fall back to downloading a full repository ZIP.
- **Local scan:** Choose a local folder and scan for either `skills/` or `.agents/skills/`. If neither exists, Skill Hub shows a notice instead of guessing.
- **npx import:** Paste a command such as:

```bash
npx skills add https://github.com/vercel-labs/skills --skill find-skills
```

Automatic `npx` execution is controlled by plugin settings. When execution is disabled or unavailable, Skill Hub can still show the command path so you can run it yourself.

Imported skills are copied into the vault skill folder, which defaults to `Skill/` and can be changed in settings. If a folder name already exists, Skill Hub creates a collision-safe name instead of overwriting existing files.

### Manage Skills

The Skill Hub view presents imported skills as visual blocks. You can:

- Rename skills with a local nickname.
- Choose an emoji.
- Assign tags and tag colors.
- Pick a block color.
- View details, history, warnings, and source information.
- Delete skills with confirmation.
- Select multiple skills with a purple glow state instead of checkboxes.

### Organize Collections

Collections are workflow groups for related skills. You can:

- Create named collections with descriptions and colors.
- Drag skills into collections.
- Reorder skills inside a collection for workflow order.
- Remove skills from a collection by dragging them out or from the collection edit window.
- Install, edit, view, or delete collections from the collection block actions.
- Include collections in bulk selection and install flows.

### Install Skills Into Agent Workspaces

Skill Hub installs selected skills into a target workspace under:

```text
.agents/skills/
```

When needed, it creates `.agents/skills` in the chosen target directory.

You can install by:

- Clicking the install action on one skill.
- Clicking the install action on one collection.
- Selecting multiple skills and collections.
- Clicking install with no active selection, then choosing from a checklist.

The install method is configurable:

- **Copy:** Copies skill folders into `.agents/skills`.
- **Symlink:** Links installed skills back to the vault copy, so updates in the vault are reflected in the target workspace.

Symlink creation depends on OS permissions. On Windows, Developer Mode or elevated permissions may be required. When a machine refuses the symlink, Skill Hub falls back to a Windows junction, which needs no elevated privileges and points at the vault copy the same way.

### Command Line Interface

Turn on **Enable Skill Hub command line actions** in the Skill Hub settings (it ships switched off), with Obsidian's own **Settings -> General -> Command line interface** already enabled on the 1.12.7 or newer installer. The plugin then publishes its actions to the Obsidian command line, and every one of them runs without opening a view or a modal, which is what scripts, CI jobs, and agent CLIs need.

```bash
obsidian banshan-skillhub
obsidian vault=MyVault banshan-skillhub:info
obsidian banshan-skillhub:list tag=writer sort=updated limit=20
obsidian banshan-skillhub:show skill=find-skills format=json
obsidian banshan-skillhub:search query=frontmatter
obsidian banshan-skillhub:scan path=C:\work\skills
obsidian banshan-skillhub:install skill=find-skills target=C:\work\agent method=symlink
obsidian banshan-skillhub:install skill=all collection=research target=C:\work\agent
obsidian banshan-skillhub:link skill=find-skills target=C:\work\agent
obsidian banshan-skillhub:uninstall target=C:\work\agent confirm=1
obsidian banshan-skillhub:import path=C:\work\skills
obsidian banshan-skillhub:order list=find-skills,writer confirm=1
obsidian banshan-skillhub:settings key=defaultSort value=updatedAt confirm=1
obsidian banshan-skillhub:refresh
```

The bare command prints the full action list with every flag.

| Action | Purpose |
| --- | --- |
| `info` | Reports the plugin version, vault, counts, and settings state, including whether the interface is switched on |
| `list` | Lists skills, optionally narrowed by `filter=` against the name, tags or description, and by `source=local`, `source=github` or `source=npx` |
| `show` | Prints one skill: files, metadata, tags, collections, source, install count |
| `search` | Ranks matches across name, description, tags, and nickname |
| `scan` | Discovers skills in a directory, with the `skills/` fallback, without importing anything |
| `install` | Installs `skill=a,b`, a whole collection with `skill=all collection=<name>`, or everything with `skill=all`, into `<target>\.agents\skills` using `method=symlink` or `method=copy` |
| `link` | Links one skill, with a junction fallback, and `force=1` replaces an existing link |
| `uninstall` | Removes installs the activity log proves Skill Hub made: links are unlinked, copies are deleted |
| `import` | Discovers and imports skills from a local directory |
| `order` | Reads the curated ordering, or sets it with `list=a,b,c` |
| `settings` | Reads any setting, and writes ordinary ones with the same validation the settings tab applies |
| `refresh` | Redraws every open Skill Hub view |
| `probe` | Echoes the parameters that reached the plugin, for diagnosing how a command line is being handed over |

A few rules hold across the whole interface:

- Arguments are always `key=value` pairs, so a value that begins with a dash is never mistaken for an option. A `vault=` selector, if you need one, has to come before the command: `obsidian vault=MyVault banshan-skillhub:list`.
- `--format=json`, or the shorter `--json`, prints one machine readable object instead of the aligned tables, and `dryrun=1` reports what an action would do while leaving the filesystem alone.
- Actions that delete or rewrite shared state (`uninstall`, `order`, `settings`) refuse to run until you add `confirm=1`, both here and in the user interface.
- `uninstall` only touches what an install recorded: a link is removed without disturbing the vault copy it pointed at, and a copied folder is deleted only when the record shows it arrived as a copy. Anything else is reported and left alone.
- A target that is a drive root, your home directory, or anywhere inside the vault is refused, so an install can never nest `.agents` inside the vault.
- `Enable Skill Hub command line actions` and `Enable npx execution` cannot be changed from the command line; they are switched on in settings so a person always grants those permissions.
- A refused command prints a line starting with `ERROR:`; under `format=json` the object carries `ok: false` and a `message`.

## How To Use

1. Install and enable Banshan Skill Hub.
2. Open the Skill Hub view from the ribbon or command palette.
3. Import skills from GitHub, a local folder, or an `npx skills add ...` command.
4. Edit skill names, colors, emojis, and tags as needed.
5. Create collections for workflows or skill types.
6. Select skills or collections, then click **Install**.
7. Choose the target project folder in the native folder picker.
8. Skill Hub installs the chosen skills into `.agents/skills`.
9. With the command line interface switched on, drive the same flows from a shell: `obsidian banshan-skillhub:list`, `install`, `link`, `uninstall`, `import`.

## Settings

Skill Hub settings include:

- **Skill folder:** Vault folder used for imported skill copies. Default: `Skill/`.
- **Install method:** Copy or symlink.
- **Default sort:** Nickname, original name, recently updated, or custom drag order.
- **Enable npx execution:** Controls whether Skill Hub can run `npx skills add ...` directly.
- **Enable Skill Hub command line actions:** Publishes the `banshan-skillhub` command so scripts and agent CLIs can import, install, and inspect without opening a window. Off by default, and never switched on from the command line itself.
- **Symlink conflict behavior:** Skip or overwrite existing symlinks.

## Notes And Limitations

- Skill Hub is desktop-only because it uses local filesystem access and native folder picking.
- GitHub import expects a `skills/` folder at the directory pointed to by the URL.
- Local scan expects either `skills/` or `.agents/skills/` under the chosen directory.
- Empty folders may not be selectable through the native folder picker because the browser-style directory input needs at least one file to expose a path.
- The target workspace must allow Skill Hub to create `.agents/skills` and copy or link skill files.
- The command line interface needs the Obsidian command line interface, which arrived with version 1.12 and is a desktop feature.
- Deleting an installed skill clears its links in agent workspaces, because a link points back into the vault.

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Build the plugin:

```bash
npm run build
```

The build writes the plugin to:

```text
.obsidian/plugins/banshan-skillhub/
```

It also syncs the root `main.js` bundle for release tracking.

## Roadmap

Planned future directions:

- **Skill graph:** Visualize skill coverage, relationships, workflow inclusion, and duplicates.
- **Analytics dashboard:** Track skill usage, install frequency, and per-skill history.
- **Capability suggestions:** Suggest missing skills or combinations of existing skills for new workflows.
- **Skill update workflow:** Detect and apply upstream changes safely.
- **Private GitHub support:** Use tokens for private repositories when needed.
- **Sidecar metadata:** Store richer metadata alongside imported skills.
- **Collection templates:** Share reusable workflow bundles across vaults or projects.
