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
  githubRateLimitFromResponse,
  githubRequestFailure,
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

  it("settles a default branch tree URL from repository metadata without any ref probe", async () => {
    const checked: string[] = [];

    await expect(resolveGitHubSkillUrl(
      "https://github.com/mattpocock/skills/tree/main",
      async (_owner, _repo, candidate) => {
        checked.push(candidate);
        return false;
      },
      { repoInfo: { defaultBranch: "main" } }
    )).resolves.toEqual({
      owner: "mattpocock",
      repo: "skills",
      ref: "main",
      rootPath: "",
      skillsPath: "skills"
    });
    expect(checked).toEqual([]);
  });

  it("still probes when the metadata default branch does not match the tree path", async () => {
    const checked: string[] = [];

    await expect(resolveGitHubSkillUrl(
      "https://github.com/owner/repo/tree/feature/x/packages/demo",
      async (_owner, _repo, candidate) => {
        checked.push(candidate);
        return candidate === "feature/x";
      },
      { repoInfo: { defaultBranch: "main" } }
    )).resolves.toMatchObject({ ref: "feature/x" });
    expect(checked).toContain("feature/x");
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
        if (path === "/repos/owner/repo/contents/skills/writer") {
          return { status: 200, data: [{ type: "file", name: "SKILL.md", path: "skills/writer/SKILL.md" }] };
        }
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
    // the third listing is what tells a skill from a grouping: it asks whether skills/writer holds a SKILL.md
    expect(requests).toEqual([
      "/repos/owner/repo/contents",
      "/repos/owner/repo/contents/skills",
      "/repos/owner/repo/contents/skills/writer"
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
      { url: "https://raw.githubusercontent.com/owner/repo/main/packages/reviewer/SKILL.md", path: join(destination, "skills/reviewer/SKILL.md") }
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
        const content = path.endsWith("SKILL.md") ? "---\nname: Writer\ndescription: Writes\n---\n" : "Guide";
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
      { url: "https://raw.githubusercontent.com/owner/repo/main/skills/writer/SKILL.md", path: join(destination, "skills/writer/SKILL.md") },
      { url: "https://raw.githubusercontent.com/owner/repo/main/skills/writer/docs/guide.md", path: join(destination, "skills/writer/docs/guide.md") }
    ]);
    expect(result.skills.map((skill) => skill.folderName)).toEqual(["writer"]);
    await expect(readFile(join(destination, "skills/writer/docs/guide.md"), "utf8")).resolves.toBe("Guide");
  });

  it("reaches one level deeper when the skills folders are grouped by category", async () => {
    const requests: string[] = [];
    const downloader = new GitHubSkillDownloader({
      fetchJson: async (path) => {
        requests.push(path);
        if (path.startsWith("/repos/owner/repo/contents/skills/engineering")) {
          return {
            status: 200,
            data: [
              { type: "dir", name: "code-review", path: "skills/engineering/code-review" },
              { type: "dir", name: "grill-with-docs", path: "skills/engineering/grill-with-docs" },
              { type: "file", name: "README.md", path: "skills/engineering/README.md" }
            ]
          };
        }
        if (path.startsWith("/repos/owner/repo/contents/skills/productivity")) {
          return {
            status: 200,
            data: [
              { type: "dir", name: "grill-me", path: "skills/productivity/grill-me" },
              { type: "file", name: "SKILL.md", path: "skills/productivity/SKILL.md" }
            ]
          };
        }
        if (path.startsWith("/repos/owner/repo/contents/skills/deprecated")) {
          return { status: 200, data: [{ type: "file", name: "README.md", path: "skills/deprecated/README.md" }] };
        }
        if (path.startsWith("/repos/owner/repo/contents/skills?")) {
          return {
            status: 200,
            data: [
              { type: "dir", name: "engineering", path: "skills/engineering" },
              { type: "dir", name: "productivity", path: "skills/productivity" },
              { type: "dir", name: "deprecated", path: "skills/deprecated" }
            ]
          };
        }
        return { status: 200, data: [{ type: "dir", name: "skills", path: "skills" }] };
      },
      downloadFile: async () => 0
    });

    await expect(downloader.listSkillCandidates({ owner: "owner", repo: "repo", ref: "main", rootPath: "", skillsPath: "skills" })).resolves.toEqual([
      { kind: "folder", name: "engineering/code-review", label: "engineering/code-review" },
      { kind: "folder", name: "engineering/grill-with-docs", label: "engineering/grill-with-docs" },
      // productivity holds its own SKILL.md, so it is a skill in its own right and is not expanded
      { kind: "folder", name: "productivity", label: "productivity" }
    ]);
    // deprecated holds neither a SKILL.md nor skill folders, so it contributes nothing rather than a
    // grouping that would install as one skill
    expect(requests).toEqual([
      "/repos/owner/repo/contents?ref=main",
      "/repos/owner/repo/contents/skills?ref=main",
      "/repos/owner/repo/contents/skills/engineering?ref=main",
      "/repos/owner/repo/contents/skills/productivity?ref=main",
      "/repos/owner/repo/contents/skills/deprecated?ref=main"
    ]);
  });

  it("downloads a nested candidate into its own folder and discovers the staged skill", async () => {
    const destination = await mkdtemp(join(tmpdir(), "skillhub-github-import-"));
    temporaryDirectories.push(destination);
    const downloads: string[] = [];
    const downloader = new GitHubSkillDownloader({
      fetchJson: async (path) => {
        if (path === "/repos/owner/repo/contents/skills/productivity/grill-me?ref=main") {
          return {
            status: 200,
            data: [
              { type: "file", name: "SKILL.md", path: "skills/productivity/grill-me/SKILL.md" },
              { type: "dir", name: "agents", path: "skills/productivity/grill-me/agents" }
            ]
          };
        }
        return {
          status: 200,
          data: [{ type: "file", name: "openai.yaml", path: "skills/productivity/grill-me/agents/openai.yaml" }]
        };
      },
      downloadFile: async (url, stagedPath) => {
        downloads.push(url);
        const content = stagedPath.endsWith("SKILL.md") ? "---\nname: Grill me\ndescription: Interrogates a plan\n---\n" : "agent config";
        await writeFile(stagedPath, content, { encoding: "utf8", flush: true });
        return Buffer.byteLength(content);
      }
    });

    const result = await downloader.downloadSkillFolder(
      { owner: "owner", repo: "repo", ref: "main", rootPath: "", skillsPath: "skills" },
      "productivity/grill-me",
      destination
    );

    expect(result.skills.map((skill) => skill.folderName)).toEqual(["grill-me"]);
    expect(downloads).toEqual([
      "https://raw.githubusercontent.com/owner/repo/main/skills/productivity/grill-me/SKILL.md",
      "https://raw.githubusercontent.com/owner/repo/main/skills/productivity/grill-me/agents/openai.yaml"
    ]);
    await expect(readFile(join(destination, "skills/productivity/grill-me/SKILL.md"), "utf8")).resolves.toContain("name: Grill me");
  });

  it("refuses a nested candidate name that could escape the skills folder", async () => {
    const destination = await mkdtemp(join(tmpdir(), "skillhub-github-import-"));
    temporaryDirectories.push(destination);
    const downloader = new GitHubSkillDownloader({
      fetchJson: async () => ({ status: 200, data: [] }),
      downloadFile: async () => 0
    });
    const location = { owner: "owner", repo: "repo", ref: "main", rootPath: "", skillsPath: "skills" };

    for (const name of ["", "../outside", "a/../../b", "a//b", "a/./b", "a\\b", "/a", "a/"]) {
      await expect(downloader.downloadSkillFolder(location, name, destination)).rejects.toThrow(InvalidGitHubUrlError);
    }
  });

  it("fetches file bytes from the raw host so the api quota is spent only on listings", async () => {
    const destination = await mkdtemp(join(tmpdir(), "skillhub-github-import-"));
    temporaryDirectories.push(destination);
    const downloads: string[] = [];
    // no download_url anywhere: the listing is enough, the raw host address is derived from the location
    const entries = [
      { type: "file" as const, name: "SKILL.md", path: "skills/writer/SKILL.md" },
      { type: "file" as const, name: "guide.md", path: "skills/writer/guide.md" }
    ];

    const withRef = new GitHubSkillDownloader({
      fetchJson: async () => ({ status: 200, data: entries }),
      downloadFile: async (url, path) => {
        downloads.push(url);
        await writeFile(path, "x", "utf8");
        return 1;
      }
    });
    await withRef.downloadSkillFolder({ owner: "owner", repo: "repo", ref: "feature/x", skillsPath: "skills" }, "writer", destination);

    const withoutRef = new GitHubSkillDownloader({
      fetchJson: async () => ({ status: 200, data: entries }),
      downloadFile: async (url, path) => {
        downloads.push(url);
        await writeFile(path, "x", "utf8");
        return 1;
      }
    });
    await withoutRef.downloadSkillFolder({ owner: "owner", repo: "repo", skillsPath: "skills" }, "writer", destination);

    expect(downloads).toEqual([
      "https://raw.githubusercontent.com/owner/repo/feature%2Fx/skills/writer/SKILL.md",
      "https://raw.githubusercontent.com/owner/repo/feature%2Fx/skills/writer/guide.md",
      "https://raw.githubusercontent.com/owner/repo/HEAD/skills/writer/SKILL.md",
      "https://raw.githubusercontent.com/owner/repo/HEAD/skills/writer/guide.md"
    ]);
    expect(downloads.some((url) => url.includes("api.github.com"))).toBe(false);
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

describe("GitHub rate limit reporting", () => {
  const now = Date.parse("2026-04-01T00:00:00.000Z");
  const reset = Math.floor(now / 1000) + 600;

  it("lifts the quota from headers and the explanation from the body", () => {
    expect(
      githubRateLimitFromResponse(
        { "X-RateLimit-Remaining": "0", "X-RateLimit-Limit": "60", "X-RateLimit-Reset": String(reset) },
        { message: "API rate limit exceeded for 203.0.113.9." }
      )
    ).toEqual({ remaining: 0, limit: 60, resetEpochSeconds: reset, message: "API rate limit exceeded for 203.0.113.9." });
  });

  it("says nothing when the response carries neither headers nor a message", () => {
    expect(githubRateLimitFromResponse({}, [])).toBeUndefined();
    expect(githubRateLimitFromResponse(undefined, undefined)).toBeUndefined();
  });

  it("names the quota and its window rather than leaving a bare status", () => {
    const message = githubRequestFailure("contents", 403, { remaining: 0, resetEpochSeconds: reset }, now).message;

    expect(message).toContain("GitHub contents request failed with status 403");
    expect(message).toContain("this network has used up the GitHub quota it shares");
    expect(message).toContain("about 10 minutes");
  });

  it("treats the wording of the response alone as evidence of the limit", () => {
    expect(githubRequestFailure("contents", 403, { message: "API rate limit exceeded for 203.0.113.9" }, now).message).toContain(
      "used up the GitHub quota"
    );
  });

  it("keeps another reason in its own words", () => {
    expect(githubRequestFailure("contents", 403, { remaining: 30, message: "Resource not accessible by personal access token" }, now).message).toBe(
      "GitHub contents request failed with status 403: Resource not accessible by personal access token"
    );
  });

  it("keeps a plain status for a file that simply is not there", () => {
    expect(githubRequestFailure("file", 404).message).toBe("GitHub file request failed with status 404");
  });

  it("says the window is turning over when the reset has already gone by", () => {
    expect(githubRequestFailure("contents", 429, { remaining: 0, resetEpochSeconds: Math.floor(now / 1000) - 5 }, now).message).toContain(
      "turning over now"
    );
  });

  it("carries the quota through a rejected listing", async () => {
    const downloader = new GitHubSkillDownloader({
      fetchJson: async () => ({
        status: 403,
        data: [],
        rateLimit: { remaining: 0, resetEpochSeconds: reset, message: "API rate limit exceeded for 203.0.113.9." }
      }),
      downloadFile: async () => 0
    }, {}, new GitHubRequestBudget());

    await expect(downloader.listSkillFolders({ owner: "owner", repo: "repo", ref: "main", rootPath: "", skillsPath: "skills" })).rejects.toThrow(
      /used up the GitHub quota it shares/
    );
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
