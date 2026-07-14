import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GitHubImportLimitError,
  GitHubSkillDownloader,
  InvalidGitHubUrlError,
  MissingSkillsFolderError,
  parseGitHubSkillUrl
} from "../src/githubImport";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("parseGitHubSkillUrl", () => {
  it("uses the repository skills folder for a repository URL", () => {
    expect(parseGitHubSkillUrl("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
      skillsPath: "skills"
    });
  });

  it("appends skills to a tree path", () => {
    expect(parseGitHubSkillUrl("https://github.com/owner/repo/tree/main/packages/demo")).toEqual({
      owner: "owner",
      repo: "repo",
      ref: "main",
      skillsPath: "packages/demo/skills"
    });
  });

  it("resolves slash-containing refs from known refs", () => {
    expect(
      parseGitHubSkillUrl("https://github.com/owner/repo/tree/feature/x/packages/demo", {
        knownRefs: ["main", "feature/x"]
      })
    ).toEqual({
      owner: "owner",
      repo: "repo",
      ref: "feature/x",
      skillsPath: "packages/demo/skills"
    });
  });

  it("uses a direct skills folder as the scan path", () => {
    expect(parseGitHubSkillUrl("https://github.com/owner/repo/tree/main/skills")).toEqual({
      owner: "owner",
      repo: "repo",
      ref: "main",
      skillsPath: "skills"
    });
  });

  it("rejects non-GitHub URLs", () => {
    expect(() => parseGitHubSkillUrl("https://gitlab.com/owner/repo")).toThrow(InvalidGitHubUrlError);
  });
});

describe("GitHubSkillDownloader", () => {
  it("lists only directories directly below the configured skills path", async () => {
    const requests: string[] = [];
    const downloader = new GitHubSkillDownloader({
      fetchJson: async (path) => {
        requests.push(path);
        return {
          status: 200,
          data: [
            { type: "dir", name: "writer", path: "packages/demo/skills/writer" },
            { type: "file", name: "README.md", path: "packages/demo/skills/README.md" }
          ]
        };
      },
      downloadFile: async () => undefined
    });

    await expect(
      downloader.listSkillFolders({ owner: "owner", repo: "repo", ref: "main", skillsPath: "packages/demo/skills" })
    ).resolves.toEqual(["writer"]);
    expect(requests).toEqual(["/repos/owner/repo/contents/packages/demo/skills?ref=main"]);
  });

  it("downloads recursively only within the selected skill folder and discovers the staged skill", async () => {
    const destination = await mkdtemp(join(tmpdir(), "skillhub-github-import-"));
    temporaryDirectories.push(destination);
    const requests: string[] = [];
    const downloads: Array<{ url: string; path: string }> = [];
    const downloader = new GitHubSkillDownloader({
      fetchJson: async (path) => {
        requests.push(path);
        if (path.includes("/skills/writer/docs")) {
          return { status: 200, data: [{ type: "file", name: "guide.md", path: "skills/writer/docs/guide.md", download_url: "https://files/guide" }] };
        }
        return {
          status: 200,
          data: [
            { type: "file", name: "SKILL.md", path: "skills/writer/SKILL.md", download_url: "https://files/skill" },
            { type: "dir", name: "docs", path: "skills/writer/docs" },
            { type: "file", name: "outside.md", path: "README.md", download_url: "https://files/outside" },
            { type: "file", name: "escaped.md", path: "skills/writer/../other/escaped.md", download_url: "https://files/escaped" }
          ]
        };
      },
      downloadFile: async (url, path) => {
        downloads.push({ url, path });
        await writeFile(path, url === "https://files/skill" ? "---\nname: Writer\ndescription: Writes\n---\n" : "Guide", { encoding: "utf8", flush: true });
      }
    });

    const result = await downloader.downloadSkillFolder(
      { owner: "owner", repo: "repo", ref: "main", skillsPath: "skills" },
      "writer",
      destination
    );

    expect(requests).toEqual([
      "/repos/owner/repo/contents/skills/writer?ref=main",
      "/repos/owner/repo/contents/skills/writer/docs?ref=main"
    ]);
    expect(downloads).toEqual([
      { url: "https://files/skill", path: join(destination, "skills/writer/SKILL.md") },
      { url: "https://files/guide", path: join(destination, "skills/writer/docs/guide.md") }
    ]);
    expect(result.skills.map((skill) => skill.folderName)).toEqual(["writer"]);
    await expect(readFile(join(destination, "skills/writer/docs/guide.md"), "utf8")).resolves.toBe("Guide");
  });

  it("reports a missing skills folder from a 404 response", async () => {
    const downloader = new GitHubSkillDownloader({
      fetchJson: async () => ({ status: 404, data: [] }),
      downloadFile: async () => undefined
    });

    await expect(downloader.listSkillFolders({ owner: "owner", repo: "repo", skillsPath: "skills" })).rejects.toThrow(
      MissingSkillsFolderError
    );
  });

  it("rejects truncated listings", async () => {
    const downloader = new GitHubSkillDownloader({
      fetchJson: async () => ({ status: 200, truncated: true, data: [] }),
      downloadFile: async () => undefined
    });

    await expect(downloader.listSkillFolders({ owner: "owner", repo: "repo", skillsPath: "skills" })).rejects.toThrow(
      GitHubImportLimitError
    );
  });

  it("rejects listings at GitHub's unsupported 1,000-entry limit", async () => {
    const downloader = new GitHubSkillDownloader({
      fetchJson: async () => ({
        status: 200,
        data: Array.from({ length: 1000 }, (_, index) => ({ type: "dir", name: `skill-${index}`, path: `skills/skill-${index}` }))
      }),
      downloadFile: async () => undefined
    });

    await expect(downloader.listSkillFolders({ owner: "owner", repo: "repo", skillsPath: "skills" })).rejects.toThrow(
      GitHubImportLimitError
    );
  });
});
