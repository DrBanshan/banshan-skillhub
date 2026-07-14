# Task 4 Report: GitHub URL Parsing And Bounded Skill Download

## Status

DONE

## Files Changed

- `src/githubImport.ts` (committed): GitHub URL parser, injectable Contents API downloader, bounded recursive staging, and import errors.
- `tests/githubImport.test.ts` (committed): parser and downloader coverage, including direct skills paths, slash-containing refs, 404s, API listing limits, and path traversal rejection.
- `.superpowers/sdd/task-4-report.md` (uncommitted): this report, requested separately from the Task 4 commit.

## Commit

- `54d30a38b457847483c967e10e4d115cde65b074 feat: parse bounded GitHub skill imports`

## Tests Run

1. `npm run test -- tests/githubImport.test.ts` before implementation
   - Expected red result: failed to load `../src/githubImport` because the module did not exist.
2. `npm run test -- tests/githubImport.test.ts` after the initial implementation
   - Passed: `1` test file, `10` tests.
3. Added a traversal-path regression test and ran `npm run test -- tests/githubImport.test.ts`
   - Expected red result: downloader attempted to stage `skills/writer/../other/escaped.md` as `skills/other/escaped.md`.
4. `npm run test -- tests/githubImport.test.ts` after the traversal fix
   - Passed: `1` test file, `10` tests.
5. `npm run typecheck`
   - Passed: `tsc -noEmit -skipLibCheck` exited `0`.
6. `npm run test`
   - Passed: `4` test files, `21` tests.

## Self-Review

- `parseGitHubSkillUrl` requires `github.com`, owner, and repository; removes a `.git` suffix; handles root URLs, direct `skills` URLs, and injected slash-containing refs.
- `GitHubSkillDownloader` calls only the GitHub Contents API through injected dependencies. It does not use or fall back to a repository ZIP.
- Folder listing occurs only at `skillsPath`. Recursive downloads are restricted to the selected skill folder, with segment validation rejecting traversal and backslash paths before staging.
- Files are staged under `destination/skills/<skill-folder>/...`, then `discoverSkills(destination)` validates the staged result.
- A `404` at the required skills-root listing throws `MissingSkillsFolderError`; truncated or 1,000-entry listings throw `GitHubImportLimitError`.
- Production `requestUrl` wiring is intentionally not included because the Task 4 brief explicitly defers it.

## Review Fix: Normalize Missing Folder 404s

- Added a focused downloader regression test for a 404 while listing the selected skill folder.
- Updated all GitHub Contents listings to throw `MissingSkillsFolderError` for status 404, including recursive listings.

### Tests Run

1. `npm run test -- tests/githubImport.test.ts` after adding the regression test
   - Expected red result: `1 failed, 10 passed`; the selected-folder 404 was received as generic `Error: GitHub contents request failed with status 404`.
2. `npm run test -- tests/githubImport.test.ts`
   - Passed: `1` test file, `11` tests.
3. `npm run typecheck`
   - Passed: `tsc -noEmit -skipLibCheck` exited `0`.
