# Skill Hub MVP Design

Date: 2026-07-15

## Scope

Build a desktop-first Obsidian plugin for importing, organizing, and installing local AI agent skills. The MVP focuses on the core library workflow:

- Import skills from GitHub, local folders, or optional `npx skills add ...` commands.
- Store imported skills inside the vault, defaulting to `Skill/` or a user-configured folder.
- Manage installed skills through a board UI with metadata, tags, and saved collections.
- Install selected vault skills into a target project's `.agents/skills` directory by symlink or copy.
- Record local-only event history for future analytics.

The MVP does not build the future skill graph or analytics dashboard, but the README should describe them as planned features.

## Assumptions

- The MVP is desktop-only because native directory selection, filesystem writes outside the vault, command execution, and symlink creation depend on Obsidian's Electron desktop runtime.
- Plugin metadata is authoritative and stored in Obsidian plugin data. Imported skill folders are not modified for Skill Hub metadata.
- A valid skill folder must contain `SKILL.md`. Frontmatter is parsed when available, but missing fields fall back to folder name and warnings.
- No external telemetry is collected. Event history is local-only.
- The plugin does not overwrite real user folders or files during install/export.

## Architecture

The plugin centers on a custom Obsidian view named Skill Hub.

### SkillDiscoveryService

Scans candidate directories for skills. It expects a `skills/` folder at the scan root unless the scan root itself is the `skills/` folder. A valid skill is any direct skill folder containing `SKILL.md`.

Responsibilities:

- Detect candidate skill folders.
- Parse `SKILL.md` frontmatter when present.
- Produce warnings for missing `name`, missing `description`, malformed frontmatter, or inaccessible files.
- Return a uniform discovery result used by GitHub, local folder, and `npx` imports.

### SkillImportService

Imports selected skills into the configured vault skill folder.

Responsibilities:

- Coordinate GitHub, local folder, and `npx` import paths.
- Stage downloaded or generated files in temporary folders.
- Copy selected skill folders into the vault.
- Preserve source folder contents as-is.
- Generate readable collision-safe folder names, such as `writing-plans`, `writing-plans-2`, and `writing-plans-3`.
- Clean up temporary files after successful imports and handled failures.

### SkillRegistryService

Owns Skill Hub metadata in plugin data.

Responsibilities:

- Store skill display metadata, source metadata, warnings, timestamps, counters, collections, and local event history.
- Keep metadata linked to the copied vault folder path.
- Provide update methods for board edits, saved collection membership, deletes, and install/export events.

### SkillExportService

Installs selected vault skills into target project directories.

Responsibilities:

- Ask the user to choose a target project directory.
- Create `<target>/.agents/skills` when permitted.
- Install selected skills by either directory symlink or folder copy, based on plugin settings.
- Detect conflicts before writing.
- Skip real folders and files.
- Replace existing symlinks only when the user chooses that bulk conflict behavior.
- Report installed, skipped, replaced, and failed results.

### SkillHubView

Provides the main user experience.

Responsibilities:

- Show installed skills as cards on a board.
- Provide import actions for GitHub URL, local scan, and `npx` command.
- Provide Select mode for bulk install, delete, and collection changes.
- Support filters and sorting.
- Open skill edit and detail modals.

### SettingsTab

Provides plugin configuration.

Settings:

- Vault skill folder path, default `Skill/`.
- Install method: `symlink` or `copy`.
- Whether `npx` command execution is enabled.
- Default conflict behavior for symlink installs.
- Optional board defaults, such as sort order.

## Import Flow

All import paths end with the same selection modal and copy behavior.

### GitHub URL Import

The user pastes a GitHub repo URL. The URL must point to a repository directory context that contains a `skills/` folder.

Accepted examples:

- Repo root URL requires `<repo>/skills/`.
- `tree/<ref>/<path>` URL requires `<repo>/<path>/skills/`.
- A URL pointing directly at `skills/` is accepted as the scan root.

Behavior:

- Parse owner, repo, optional branch/tag/ref, and optional path.
- Honor non-default branch, tag, or path information from the URL.
- Use GitHub APIs to list only the relevant `skills/` subtree.
- Download only files under selected skill folders into a temporary staging directory.
- Do not download the entire repository ZIP.
- Do not fall back to full repository downloads.
- Fail clearly if the required `skills/` folder is missing, inaccessible, too large for the supported API flow, or requires unsupported authentication.
- Clean up staged files after successful import and handled failures.

Private repository token support is out of scope for the MVP.

### Local Directory Import

The user clicks a scan button and chooses a directory with the native folder picker.

Behavior:

- If the chosen folder is named `skills`, scan it directly.
- Otherwise require a `skills/` folder under the chosen directory.
- List valid skill folders in a modal.
- Let the user select some or all skills to import.
- Apply the same validation and warning behavior as GitHub import.

### `npx skills add ...` Import

The user pastes an `npx skills add ...` command.

Behavior:

- Validate that the command starts with `npx skills add`.
- Check whether `npx` is installed before attempting execution.
- Run the command only when command execution is enabled in settings.
- Run the command inside a temporary import folder.
- Scan the resulting temporary folder with the same discovery rules.
- If `npx` is missing or execution is disabled, show the validated command as a manual fallback and ask the user to scan the resulting local folder after running it themselves.
- Clean up temporary files after successful import and handled failures.

## Import Storage Behavior

Selected skills are copied into the configured vault skill folder.

Rules:

- Preserve imported skill folder contents as-is.
- Use readable folder names based on source names.
- On name collision, append a suffix such as `-2` or `-3`.
- Do not write Skill Hub metadata into the imported skill folders.
- Record source URL or path, import method, import timestamp, warnings, and original parsed metadata in plugin data.
- Record local `skill_imported`, `skill_import_failed`, and related events.

## Skill Board And Management

The Skill Hub view displays installed skills as cards.

Card content:

- Emoji.
- Nickname.
- Original skill name.
- Short description.
- Tags.
- Source indicator.
- User-selected color.
- Warning or broken-folder indicators.

Board controls:

- Import from GitHub URL.
- Import from local folder.
- Import from `npx` command.
- Select mode for bulk operations.
- Filters by tag, saved collection, source, and warning status.
- Sort by nickname, import date, recently installed/exported, or source.

Skill editing:

- Users can edit nickname, emoji, color, tags, and saved collection membership.
- Edits update plugin data only.
- A skill can belong to multiple saved collections.

Saved collections:

- Collections represent workflow groups, such as `Writing Workflow` or `Research Stack`.
- Users can create, rename, and delete collections.
- Collections can have a name, color, description, and member skill ids.
- Deleting a collection does not delete skills.

Deletion:

- Single delete opens a confirmation modal.
- Bulk delete is available from Select mode.
- Confirmation states that deletion removes the copied vault skill folder and Skill Hub metadata.
- Deletion records local `skill_deleted` events.
- If file deletion fails, leave metadata intact and report the failed skill.

Skill detail modal:

- Parsed `SKILL.md` metadata.
- Vault folder path.
- Source URL or path.
- Import method.
- Import time.
- Warnings.
- Local event history.
- Saved collections.

## Install To `.agents/skills`

The board provides an Install action for one skill or selected skills.

Install method is controlled by plugin settings:

- `symlink`: create directory symlinks from vault skill folders into `<target>/.agents/skills`.
- `copy`: copy selected skill folders into `<target>/.agents/skills`.

Recommended default: `symlink`, because updates to vault-managed skills are reflected in target projects. Copy mode is available for self-contained target projects and environments where symlink creation fails.

Flow:

1. User clicks Install on one skill or selects multiple skills.
2. Plugin opens the native directory picker.
3. User chooses the target project directory.
4. Plugin creates `<target>/.agents/skills` if it does not exist and permissions allow it.
5. Plugin installs each selected skill with the configured method.
6. Plugin summarizes installed, skipped, replaced, and failed items.

Conflict handling:

- If destination does not exist, install.
- If destination is an existing symlink in symlink mode, skip or replace based on the user-selected bulk conflict behavior.
- If destination is an existing symlink in copy mode, skip in the MVP.
- If destination is a real folder or file, skip and report. Never overwrite real folders or files in the MVP.

Permission and platform behavior:

- Creating `<target>/.agents/skills` can fail if the target path is protected or outside permissions granted by the native picker.
- Creating symlinks can fail on Windows without Developer Mode or elevated permissions.
- Copy mode can still fail on permission errors, locked files, or invalid paths.
- The plugin shows explicit permission or platform messages.
- The plugin does not silently fall back from symlink to copy. The user chooses the method in settings.

Events:

- Record `skill_installed` with method `symlink` or `copy`.
- Record skipped conflicts and permission failures.
- Increment per-skill install counters for future analytics.

## Plugin Data Model

The exact TypeScript interfaces can evolve during implementation, but the MVP should use these concepts.

```ts
type InstallMethod = "symlink" | "copy";

interface SkillHubSettings {
  skillFolder: string;
  installMethod: InstallMethod;
  npxExecutionEnabled: boolean;
  defaultSymlinkConflictBehavior: "skip" | "replace-symlinks";
  defaultSort: "nickname" | "importedAt" | "recentlyInstalled" | "source";
}

interface SkillRecord {
  id: string;
  folderName: string;
  vaultPath: string;
  originalName: string;
  nickname: string;
  description: string;
  emoji?: string;
  color?: string;
  tags: string[];
  collectionIds: string[];
  source: SkillSource;
  importMethod: "github" | "local" | "npx";
  warnings: string[];
  importedAt: string;
  updatedAt: string;
  installCount: number;
  lastInstalledAt?: string;
}

interface SkillSource {
  type: "github" | "local" | "npx";
  url?: string;
  ref?: string;
  path?: string;
  command?: string;
}

interface SkillCollection {
  id: string;
  name: string;
  color?: string;
  description?: string;
  skillIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface SkillEvent {
  id: string;
  skillId?: string;
  type:
    | "skill_imported"
    | "skill_import_failed"
    | "skill_deleted"
    | "skill_installed"
    | "skill_install_skipped"
    | "skill_install_failed"
    | "npx_command_attempted"
    | "npx_command_failed";
  at: string;
  details: Record<string, unknown>;
}
```

## README Roadmap

The README should describe the following planned features as future work, not MVP scope:

- Skill graph for coverage, workflow inclusion, relationships, and duplicate detection.
- Suggestions for developing new skills or combining existing skill components for new capabilities.
- Usage stats dashboard showing frequency, install counts, install history, and per-skill relation views.
- Optional sidecar metadata export for users who want portable metadata.
- Private GitHub repository support through user-provided tokens.
- Richer update workflow for previously imported skills.

## Error Handling

Expected errors should be reported through modals or notices with enough detail for the user to recover.

Primary cases:

- Invalid GitHub URL.
- Missing required `skills/` folder.
- GitHub API access, rate, size, or auth failure.
- No valid folders containing `SKILL.md`.
- Malformed `SKILL.md` frontmatter.
- Missing `npx`.
- Disabled command execution.
- `npx` command failure.
- Vault copy failure.
- Target permission failure.
- Symlink creation failure.
- Install destination conflict.
- Delete failure.

The plugin should keep already completed operations when a later item in a batch fails, then report the mixed result.

## Verification Criteria

The MVP is complete when these checks pass:

- GitHub import downloads only files under the required `skills/` subtree.
- GitHub import fails when the required `skills/` folder is missing.
- GitHub import honors branch, tag, ref, and path information in supported URLs.
- Local directory import and `npx` import use the same scanner rules.
- Valid skills require `SKILL.md`, with missing metadata recorded as warnings.
- Imported skill folders preserve source contents.
- Folder name collisions produce readable suffixed names.
- Board edits update plugin metadata without modifying imported skill files.
- Saved collections support many-to-many skill membership.
- Delete confirmation removes copied vault folders and metadata only after approval.
- Install/export creates `.agents/skills` when permissions allow it.
- Install/export respects the configured symlink or copy method.
- Existing real folders and files are never overwritten.
- Local event history records import, delete, install, skipped conflict, failure, and `npx` attempt events.
- README lists graph and analytics as future features rather than MVP deliverables.

