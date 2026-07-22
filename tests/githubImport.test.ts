import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GitHubImportLimitError,
  GitHubRequestBudget,
  GitHubSkillDownloader,
  InvalidGitHubUrlError,
  MissingSkillsFolderError,
  parseGitHubSkillUrl,
  resolveGitHubSkillUrl,
  writeBoundedGitHubResponse
} from "../src/githubImport";
import { SkillImportService } from "../src/importService";
import { createEmptySkillHubData, SkillRegistry } from "../src/registry";
import { DEFAULT_SETTINGS } from "../src/settingsDefaults";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("parseGitHubSkillUrl", () => {
  it("uses the repository skills folder for a repository URL", () => {
    expect(parseGitHubSkillUrl("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
      rootPath: "",
      skillsPath: "skills"
    });
  });

  it("appends skills to a tree path", () => {
    expect(parseGitHubSkillUrl("https://github.com/owner/repo/tree/main/packages/demo")).toEqual({
      owner: "owner",
      repo: "repo",
      ref: "main",
      rootPath: "packages/demo",
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
      rootPath: "packages/demo",
      skillsPath: "packages/demo/skills"
    });
  });

  it("resolves slash-containing refs through the UI-facing async helper", async () => {
    const checked: string[] = [];

    await expect(resolveGitHubSkillUrl(
      "https://github.com/owner/repo/tree/feature/x/packages/demo",
      async (_owner, _repo, candidate) => {
        checked.push(candidate);
        return candidate === "feature/x";
      }
    )).resolves.toEqual({
      owner: "owner",
      repo: "repo",
      ref: "feature/x",
      rootPath: "packages/demo",
      skillsPath: "packages/demo/skills"
    });
    expect(checked).toContain("feature/x");
  });

  it("keeps full commit SHA tree URLs without a ref lookup", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    await expect(resolveGitHubSkillUrl(
      `https://github.com/owner/repo/tree/${sha}/packages/demo`,
      async () => { throw new Error("ref lookup should not run"); }
    )).resolves.toEqual({ owner: "owner", repo: "repo", ref: sha, rootPath: "packages/demo", skillsPath: "packages/demo/skills" });
  });

  it("bounds ref probes for long tree URLs", async () => {
    let probes = 0;
    const path = Array.from({ length: 30 }, (_, index) => `segment-${index}`).join("/");

    await expect(resolveGitHubSkillUrl(
      `https://github.com/owner/repo/tree/${path}`,
      async () => {
        probes += 1;
        return false;
      },
      { maxProbes: 4 }
    )).rejects.toThrow(InvalidGitHubUrlError);
    expect(probes).toBe(4);
  });

  it("does not probe beyond the shared request budget", async () => {
    const budget = new GitHubRequestBudget(3);
    let probes = 0;
    const path = Array.from({ length: 10 }, (_, index) => `segment-${index}`).join("/");

    await expect(resolveGitHubSkillUrl(
      `https://github.com/owner/repo/tree/${path}`,
      async () => {
        probes += 1;
        budget.consume("ref probe");
        return false;
      },
      { maxProbes: 10, requestBudget: budget }
    )).rejects.toThrow(InvalidGitHubUrlError);
    expect(probes).toBe(3);
  });

  it("uses a direct skills folder as the scan path", () => {
    expect(parseGitHubSkillUrl("https://github.com/owner/repo/tree/main/skills")).toEqual({
      owner: "owner",
      repo: "repo",
      ref: "main",
      rootPath: "skills",
      skillsPath: "skills"
    });
  });

  it("rejects non-GitHub URLs", () => {
    expect(() => parseGitHubSkillUrl("https://gitlab.com/owner/repo")).toThrow(InvalidGitHubUrlError);
  });
});

describe("GitHubSkillDownloader", () => {
  it("shares an aggregate request budget with earlier GitHub calls", async () => {
    const budget = new GitHubRequestBudget(2);
    let requests = 0;
    budget.consume("ref probe");
    const downloader = new GitHubSkillDownloader({
      fetchJson: async () => {
        requests += 1;
        return { status: 200, data: [] };
      },
      downloadFile: async () => 0
    }, {}, budget);

    await expect(downloader.listSkillFolders({ owner: "owner", repo: "repo", skillsPath: "skills" })).resolves.toEqual([]);
    await expect(downloader.listSkillFolders({ owner: "owner", repo: "repo", skillsPath: "skills" })).rejects.toThrow(
      GitHubImportLimitError
    );
    expect(requests).toBe(1);
  });

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
      downloadFile: async () => 0
    });

    await expect(
      downloader.listSkillFolders({ owner: "owner", repo: "repo", ref: "main", skillsPath: "packages/demo/skills" })
    ).resolves.toEqual(["writer"]);
    expect(requests).toEqual(["/repos/owner/repo/contents/packages/demo/skills?ref=main"]);
  });

  it("lists a root SKILL.md together with folders from the child skills directory", async () => {
    const requests: string[] = [];
    const downloader = new GitHubSkillDownloader({
      fetchJson: async (path) => {
        requests.push(path);
        return path.includes("/contents/skills")
          ? { status: 200, data: [{ type: "dir", name: "writer", path: "skills/writer" }] }
          : {
            status: 200,
            data: [
              { type: "file", name: "SKILL.md", path: "SKILL.md", download_url: "https://files/root-skill" },
              { type: "dir", name: "skills", path: "skills" }
            ]
          };
      },
      downloadFile: async () => 0
    });

    await expect(downloader.listSkillCandidates({ owner: "owner", repo: "repo", rootPath: "", skillsPath: "skills" })).resolves.toEqual([
      { kind: "root", name: "repo", label: "repo (root SKILL.md)" },
      { kind: "folder", name: "writer", label: "writer" }
    ]);
    expect(requests).toEqual([
      "/repos/owner/repo/contents",
      "/repos/owner/repo/contents/skills"
    ]);
  });

  it("downloads only SKILL.md when the URL root is itself a skill", async () => {
    const destination = await mkdtemp(join(tmpdir(), "skillhub-github-import-"));
    temporaryDirectories.push(destination);
    const downloads: Array<{ url: string; path: string }> = [];
    const downloader = new GitHubSkillDownloader({
      fetchJson: async () => ({
        status: 200,
        data: [
          { type: "file", name: "SKILL.md", path: "packages/reviewer/SKILL.md", download_url: "https://files/root-skill" },
          { type: "file", name: "README.md", path: "packages/reviewer/README.md", download_url: "https://files/readme" }
        ]
      }),
      downloadFile: async (url, path) => {
        downloads.push({ url, path });
        const content = "---\nname: Reviewer\ndescription: Reviews code\n---\n";
        await writeFile(path, content, { encoding: "utf8", flush: true });
        return Buffer.byteLength(content);
      }
    });
    const location = {
      owner: "owner",
      repo: "repo",
      ref: "main",
      rootPath: "packages/reviewer",
      skillsPath: "packages/reviewer/skills"
    };
    const candidates = await downloader.listSkillCandidates(location);

    const result = await downloader.downloadSkillCandidate(location, candidates[0], destination);

    expect(candidates).toEqual([{ kind: "root", name: "reviewer", label: "reviewer (root SKILL.md)" }]);
    expect(downloads).toEqual([
      { url: "https://files/root-skill", path: join(destination, "skills/reviewer/SKILL.md") }
    ]);
    expect(result.skills.map((skill) => skill.metadata.name)).toEqual(["Reviewer"]);
    await expect(readFile(join(destination, "skills/reviewer/README.md"), "utf8")).rejects.toThrow();
  });

  it("imports a downloaded root skill into the vault", async () => {
    const stagingPath = await mkdtemp(join(tmpdir(), "skillhub-github-import-"));
    const vaultPath = await mkdtemp(join(tmpdir(), "skillhub-github-vault-"));
    temporaryDirectories.push(stagingPath, vaultPath);
    const downloader = new GitHubSkillDownloader({
      fetchJson: async () => ({
        status: 200,
        data: [{
          type: "file",
          name: "SKILL.md",
          path: "SKILL.md",
          download_url: "https://files/root-skill"
        }]
      }),
      downloadFile: async (_url, path) => {
        const content = "---\nname: Root reviewer\ndescription: Reviews code\n---\n";
        await writeFile(path, content, { encoding: "utf8", flush: true });
        return Buffer.byteLength(content);
      }
    });
    const location = { owner: "owner", repo: "reviewer", rootPath: "", skillsPath: "skills" };
    const [candidate] = await downloader.listSkillCandidates(location);
    const discovered = await downloader.downloadSkillCandidate(location, candidate, stagingPath);
    const registry = new SkillRegistry(createEmptySkillHubData());

    const result = await new SkillImportService(registry, DEFAULT_SETTINGS).importDiscoveredSkills(discovered.skills, {
      vaultPath,
      source: { type: "github", url: "https://github.com/owner/reviewer" },
      importMethod: "github",
      stagingPath
    });

    expect(result.imported).toHaveLength(1);
    expect(Object.values(registry.data.skills)).toHaveLength(1);
    await expect(readFile(join(vaultPath, "Skill", "reviewer", "SKILL.md"), "utf8")).resolves.toContain("name: Root reviewer");
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
        const content = url === "https://files/skill" ? "---\nname: Writer\ndescription: Writes\n---\n" : "Guide";
        await writeFile(path, content, { encoding: "utf8", flush: true });
        return Buffer.byteLength(content);
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
      downloadFile: async () => 0
    });

    await expect(downloader.listSkillFolders({ owner: "owner", repo: "repo", skillsPath: "skills" })).rejects.toThrow(
      MissingSkillsFolderError
    );
  });

  it("reports a missing selected skill folder from a 404 response", async () => {
    const destination = await mkdtemp(join(tmpdir(), "skillhub-github-import-"));
    temporaryDirectories.push(destination);
    const downloader = new GitHubSkillDownloader({
      fetchJson: async () => ({ status: 404, data: [] }),
      downloadFile: async () => 0
    });

    await expect(
      downloader.downloadSkillFolder({ owner: "owner", repo: "repo", skillsPath: "skills" }, "writer", destination)
    ).rejects.toThrow(MissingSkillsFolderError);
  });

  it("rejects truncated listings", async () => {
    const downloader = new GitHubSkillDownloader({
      fetchJson: async () => ({ status: 200, truncated: true, data: [] }),
      downloadFile: async () => 0
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
      downloadFile: async () => 0
    });

    await expect(downloader.listSkillFolders({ owner: "owner", repo: "repo", skillsPath: "skills" })).rejects.toThrow(
      GitHubImportLimitError
    );
  });

  it("enforces an aggregate request limit across recursive listings", async () => {
    const destination = await mkdtemp(join(tmpdir(), "skillhub-github-import-"));
    temporaryDirectories.push(destination);
    const downloader = new GitHubSkillDownloader({
      fetchJson: async (path) => ({
        status: 200,
        data: path.endsWith("/writer")
          ? [
            { type: "dir", name: "one", path: "skills/writer/one" },
            { type: "dir", name: "two", path: "skills/writer/two" }
          ]
          : []
      }),
      downloadFile: async () => 0
    }, { maxRequests: 2 });

    await expect(downloader.downloadSkillFolder(
      { owner: "owner", repo: "repo", skillsPath: "skills" },
      "writer",
      destination
    )).rejects.toThrow(GitHubImportLimitError);
  });

  it("enforces aggregate file and byte limits", async () => {
    const destination = await mkdtemp(join(tmpdir(), "skillhub-github-import-"));
    temporaryDirectories.push(destination);
    const entries = [
      { type: "file" as const, name: "SKILL.md", path: "skills/writer/SKILL.md", download_url: "https://files/skill" },
      { type: "file" as const, name: "guide.md", path: "skills/writer/guide.md", download_url: "https://files/guide" }
    ];
    const fileLimited = new GitHubSkillDownloader({
      fetchJson: async () => ({ status: 200, data: entries }),
      downloadFile: async () => 1
    }, { maxFiles: 1 });
    const byteLimited = new GitHubSkillDownloader({
      fetchJson: async () => ({ status: 200, data: entries.slice(0, 1) }),
      downloadFile: async () => 6
    }, { maxBytes: 5 });

    await expect(fileLimited.downloadSkillFolder(
      { owner: "owner", repo: "repo", skillsPath: "skills" },
      "writer",
      destination
    )).rejects.toThrow(GitHubImportLimitError);
    await expect(byteLimited.downloadSkillFolder(
      { owner: "owner", repo: "repo", skillsPath: "skills" },
      "writer",
      destination
    )).rejects.toThrow(GitHubImportLimitError);
  });

  it("passes the remaining byte budget to the production download boundary", async () => {
    const destination = await mkdtemp(join(tmpdir(), "skillhub-github-import-"));
    temporaryDirectories.push(destination);
    const limits: number[] = [];
    const downloader = new GitHubSkillDownloader({
      fetchJson: async () => ({
        status: 200,
        data: [{
          type: "file",
          name: "SKILL.md",
          path: "skills/writer/SKILL.md",
          download_url: "https://files/skill",
          size: 4
        }]
      }),
      downloadFile: async (_url, path, maxBytes) => {
        limits.push(maxBytes);
        await writeFile(path, "test", "utf8");
        return 4;
      }
    }, { maxBytes: 5 });

    await downloader.downloadSkillFolder(
      { owner: "owner", repo: "repo", skillsPath: "skills" },
      "writer",
      destination
    );

    expect(limits).toEqual([5]);
  });

  it("counts file downloads as requests and rejects declared oversize files before download", async () => {
    const destination = await mkdtemp(join(tmpdir(), "skillhub-github-import-"));
    temporaryDirectories.push(destination);
    let downloads = 0;
    const entry = {
      type: "file" as const,
      name: "SKILL.md",
      path: "skills/writer/SKILL.md",
      download_url: "https://files/skill",
      size: 10
    };
    const requestLimited = new GitHubSkillDownloader({
      fetchJson: async () => ({ status: 200, data: [entry] }),
      downloadFile: async () => { downloads += 1; return 1; }
    }, { maxRequests: 1 });
    const byteLimited = new GitHubSkillDownloader({
      fetchJson: async () => ({ status: 200, data: [entry] }),
      downloadFile: async () => { downloads += 1; return 1; }
    }, { maxBytes: 5 });

    await expect(requestLimited.downloadSkillFolder(
      { owner: "owner", repo: "repo", skillsPath: "skills" },
      "writer",
      destination
    )).rejects.toThrow(GitHubImportLimitError);
    await expect(byteLimited.downloadSkillFolder(
      { owner: "owner", repo: "repo", skillsPath: "skills" },
      "writer",
      destination
    )).rejects.toThrow(GitHubImportLimitError);
    expect(downloads).toBe(0);
  });

  it("enforces recursive depth", async () => {
    const destination = await mkdtemp(join(tmpdir(), "skillhub-github-import-"));
    temporaryDirectories.push(destination);
    const downloader = new GitHubSkillDownloader({
      fetchJson: async () => ({
        status: 200,
        data: [{ type: "dir", name: "docs", path: "skills/writer/docs" }]
      }),
      downloadFile: async () => 0
    }, { maxDepth: 0 });

    await expect(downloader.downloadSkillFolder(
      { owner: "owner", repo: "repo", skillsPath: "skills" },
      "writer",
      destination
    )).rejects.toThrow(GitHubImportLimitError);
  });
});

describe("writeBoundedGitHubResponse", () => {
  it("rejects an oversized content length before writing", async () => {
    let writes = 0;

    await expect(writeBoundedGitHubResponse({
      status: 200,
      headers: { "content-length": "6" },
      arrayBuffer: new TextEncoder().encode("small").buffer
    }, "/tmp/skill", 5, async () => { writes += 1; })).rejects.toThrow(GitHubImportLimitError);

    expect(writes).toBe(0);
  });

  it("checks actual buffered bytes before the final write", async () => {
    let writes = 0;

    await expect(writeBoundedGitHubResponse({
      status: 200,
      headers: {},
      arrayBuffer: new TextEncoder().encode("larger").buffer
    }, "/tmp/skill", 5, async () => { writes += 1; })).rejects.toThrow(GitHubImportLimitError);

    expect(writes).toBe(0);
  });
});
