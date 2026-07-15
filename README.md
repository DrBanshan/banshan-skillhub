# Banshan Skill Hub

Banshan Skill Hub is an Obsidian plugin for discovering, importing, organizing, and installing local AI agent skills. Imported skills are copied into your vault's `Skill/` folder, where the plugin can track them and install selected skills into an agent workspace.

## MVP behavior

This plugin is desktop-only. It uses local filesystem access to import skill folders and create agent workspace installs, so it is not supported on Obsidian mobile.

### Development build

Run `npm run build` to compile the plugin into `.obsidian/plugins/banshan-skillhub/`. The build writes `main.js`, `manifest.json`, and `styles.css` there, and also syncs the root `main.js` bundle for release tracking.

### Import skills

Use the Skill Hub view to choose an import source, then select the discovered skills to add to your vault.

- **GitHub:** Provide a GitHub URL that points to a directory containing `skills/`. The plugin does not download full repository ZIP archives.
- **Local folder:** Choose a non-empty local folder containing `skills/`, with one skill folder per skill and a `SKILL.md` file in each skill folder. The native folder picker cannot select an empty directory because Obsidian does not expose its path without a selected file.
- **npx:** Run a permitted `npx skills add owner/repo` command when npx execution is enabled in the plugin settings. Automatic execution is always project-scoped, ensures a `codex` agent target at `.agents/skills/`, selects all skills unless `--skill` or `--all` is supplied, confirms non-interactively, uses copy mode, and disables telemetry. Global (`--global` or `-g`) and list-only commands are rejected.

Imported skill folders are copied into `Skill/<folder>` in the vault. If a folder name already exists, Skill Hub creates a collision-safe name such as `writer-2` rather than replacing existing files.

### Install skills

Choose one or more imported skills and an agent workspace. Skill Hub creates `.agents/skills/` in that workspace when needed, then installs each selected skill using the chosen mode:

- **Symlink:** Creates `.agents/skills/<folder>` as a symbolic link to the vault copy. Changes to the vault skill are immediately available to the agent workspace.
- **Copy:** Copies the skill folder into `.agents/skills/<folder>`. The installed copy is independent from later vault changes.

The selected workspace must allow Obsidian to create `.agents/skills/`. On Windows, symlink creation can require Developer Mode or elevated permissions; use copy mode when symlink permissions are unavailable.

## Roadmap

- Skill graph
- Suggestions
- Analytics
- Sidecar metadata
- Private GitHub token support
- Update workflow
