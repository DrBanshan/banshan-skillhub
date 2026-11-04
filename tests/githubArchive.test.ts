import { gzipSync } from "zlib";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ARCHIVE_LIMITS,
  GitHubArchiveDownloader,
  GitHubArchiveNotFoundError,
  GitHubArchiveTooLargeError,
  GitHubArchiveTreeSource,
  createArchiveDependencies,
  defaultBranchFromPage,
  parseTar,
  stripArchiveRoot,
  gunzip,
  type ArchiveEntry
} from "../src/githubArchive";
import { GitHubRequestBudget, GitHubSkillDownloader, MissingSkillsFolderError, SkillTreeImporter, type GitHubContentEntry } from "../src/githubImport";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function staging(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "skillhub-archive-"));
  temporaryDirectories.push(directory);
  return directory;
}

function octalSize(size: number): string {
  return `${size.toString(8).padStart(11, "0")}\0`;
}

/** A ustar block pair, built by hand so the reader is tested against bytes rather than another parser. */
function tarBlock(path: string, type: "file" | "dir", content = "", typeFlag = type === "dir" ? "5" : "0"): Buffer {
  const header = Buffer.alloc(512);
  header.write(path.slice(0, 99), 0, "utf8");
  header.write("0000644", 100, "utf8");
  header.write("0000000", 108, "utf8");
  header.write("0000000", 116, "utf8");
  header.write(octalSize(Buffer.byteLength(content)), 124, "utf8");
  header.write("00000000000", 136, "utf8");
  header.write(typeFlag, 156, "ascii");
  header.write("ustar  \0", 257, "ascii");
  header.write("00", 263, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");

  const body = Buffer.from(content, "utf8");
  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
  body.copy(padded);
  return Buffer.concat([header, padded]);
}

function tar(entries: Buffer[]): Buffer {
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}

function skillMarkdown(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} description\n---\n\nBody of ${name}.\n`;
}

const mattpocockFiles: Record<string, string> = {
  "README.md": "# skills",
  "skills/productivity/grill-me/SKILL.md": skillMarkdown("grill-me"),
  "skills/productivity/grill-me/agents/openai.yaml": "provider: openai\n",
  "skills/productivity/grilling/SKILL.md": skillMarkdown("grilling"),
  "skills/engineering/code-review/SKILL.md": skillMarkdown("code-review"),
  "skills/deprecated/README.md": "nothing here"
};

function mattpocockEntries(): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  for (const [path, content] of Object.entries(mattpocockFiles)) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const dir = segments.slice(0, index).join("/");
      if (!entries.some((entry) => entry.path === dir)) entries.push({ path: dir, type: "dir", size: 0 });
    }
    entries.push({ path, type: "file", size: Buffer.byteLength(content), bytes: Buffer.from(content, "utf8") });
  }
  return entries;
}

function apiListing(path: string): GitHubContentEntry[] {
  const prefix = path ? `${path}/` : "";
  const seen = new Map<string, GitHubContentEntry>();
  for (const fullPath of Object.keys(mattpocockFiles)) {
    if (!fullPath.startsWith(prefix)) continue;
    const rest = fullPath.slice(prefix.length);
    if (!rest) continue;
    const head = rest.split("/")[0];
    const childPath = `${prefix}${head}`;
    if (seen.has(childPath)) continue;
    seen.set(childPath, rest.includes("/") ? { type: "dir", name: head, path: childPath } : { type: "file", name: head, path: childPath, size: Buffer.byteLength(mattpocockFiles[fullPath]) });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const location = { owner: "mattpocock", repo: "skills", ref: "main", rootPath: "", skillsPath: "skills" };

/**
 * A pax record carries its own byte count including the count itself and the trailing newline, which is a
 * fixed point: the digits of the count change its length. Iterating reaches it, and the reader rejects a
 * record whose count does not add up.
 */
function paxRecord(keyword: string, value: string): Buffer {
  const body = `${keyword}=${value}`;
  let total = body.length + 2;
  for (let attempt = 0; attempt < 8; attempt += 1) total = String(total).length + body.length + 2;
  return Buffer.from(`${total} ${body}\n`, "utf8");
}

/** A header written by hand, for the entries a normal tarBlock cannot express. */
function rawHeader(path: string, size: number, typeFlag: string, linkname = ""): Buffer {
  const header = Buffer.alloc(512);
  header.write(path.slice(0, 99), 0, "utf8");
  header.write("0000644", 100, "utf8");
  header.write("0000000", 108, "utf8");
  header.write("0000000", 116, "utf8");
  header.write(octalSize(size), 124, "utf8");
  header.write("00000000000", 136, "utf8");
  header.write(typeFlag, 156, "ascii");
  if (linkname) header.write(linkname, 157, "utf8");
  header.write("ustar  \0", 257, "ascii");
  header.write("00", 263, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return header;
}

describe("parseTar", () => {
  it("reads files and directories with their bytes and sizes", () => {
    const buffer = tar([
      tarBlock("repo/skills", "dir"),
      tarBlock("repo/skills/demo/SKILL.md", "file", skillMarkdown("demo"))
    ]);

    const entries = parseTar(buffer);

    expect(entries.map((entry) => `${entry.path}:${entry.type}`)).toEqual(["repo/skills:dir", "repo/skills/demo/SKILL.md:file"]);
    const file = entries.find((entry) => entry.type === "file");
    expect(file?.size).toBe(Buffer.byteLength(skillMarkdown("demo")));
    expect(file?.bytes?.toString("utf8")).toBe(skillMarkdown("demo"));
  });

  it("takes a long name from the GNU entry that precedes it", () => {
    const longName = `repo/skills/${"deep-".repeat(24)}grill-me/SKILL.md`;
    expect(longName.length).toBeGreaterThan(100);
    const payload = Buffer.from(`${longName}\0`, "utf8");

    const buffer = Buffer.concat([
      rawHeader("././@LongLink", payload.byteLength, "L"),
      padded(payload),
      tarBlock(longName.slice(0, 99), "file", "body")
    ]);
    const entries = parseTar(buffer);

    expect(entries.at(-1)?.path).toBe(longName);
  });

  it("prefers the pax path over the truncated header name", () => {
    const longName = `repo/skills/${"x-".repeat(60)}skill/SKILL.md`;
    expect(longName.length).toBeGreaterThan(100);
    const payload = paxRecord("path", longName);

    const buffer = Buffer.concat([rawHeader("./PaxHeaders.0/entry", payload.byteLength, "x"), padded(payload), tarBlock(longName.slice(0, 99), "file", "body")]);
    const entries = parseTar(buffer);

    expect(entries.at(-1)?.path).toBe(longName);
    expect(entries.at(-1)?.bytes?.toString("utf8")).toBe("body");
  });

  it("passes over links, which a downloaded archive must never follow", () => {
    const buffer = Buffer.concat([
      tarBlock("repo/CLAUDE.md", "file", "real"),
      rawHeader("repo/AGENTS.md", 0, "2", "CLAUDE.md"),
      tarBlock("repo/skills/demo/SKILL.md", "file", skillMarkdown("demo"))
    ]);

    expect(parseTar(buffer).map((entry) => entry.path)).toEqual(["repo/CLAUDE.md", "repo/skills/demo/SKILL.md"]);
  });

  it("drops an entry whose path climbs out of the archive", () => {
    const buffer = tar([tarBlock("repo/vault/../../escape/SKILL.md", "file", "nope"), tarBlock("repo/keep/SKILL.md", "file", "yes")]);

    expect(parseTar(buffer).map((entry) => entry.path)).toEqual(["repo/keep/SKILL.md"]);
  });

  it("stops at the end of the archive rather than reading past it", () => {
    const buffer = Buffer.concat([tar([tarBlock("repo/keep/SKILL.md", "file", "yes")]), Buffer.alloc(4096, 7)]);

    expect(parseTar(buffer).map((entry) => entry.path)).toEqual(["repo/keep/SKILL.md"]);
  });

  it("refuses a repository that unpacks beyond the cap, naming the numbers and the alternative", () => {
    const content = "x".repeat(4096);
    const blocks: Buffer[] = [];
    for (let index = 0; index < 200; index += 1) blocks.push(tarBlock(`repo/big/file-${index}.md`, "file", content));

    expect(() => parseTar(tar(blocks), { ...DEFAULT_ARCHIVE_LIMITS, maxUnpackedBytes: 100 * 1024 })).toThrow(GitHubArchiveTooLargeError);
    try {
      parseTar(tar(blocks), { ...DEFAULT_ARCHIVE_LIMITS, maxUnpackedBytes: 100 * 1024 });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("over the 100 KB this plugin will download");
      expect(message).toContain("Use the npx command for this repository instead.");
    }
  });

  it("counts entries as well as bytes", () => {
    const blocks = Array.from({ length: 10 }, (_, index) => tarBlock(`repo/f${index}.md`, "file", "x"));

    expect(() => parseTar(tar(blocks), { ...DEFAULT_ARCHIVE_LIMITS, maxEntries: 5 })).toThrow(GitHubArchiveTooLargeError);
  });
});

describe("stripArchiveRoot", () => {
  it("removes the folder git names after the repository and ref", () => {
    const stripped = stripArchiveRoot([
      { path: "skills-main/README.md", type: "file", size: 1 },
      { path: "skills-main/skills/demo/SKILL.md", type: "file", size: 1 }
    ]);

    expect(stripped.map((entry) => entry.path)).toEqual(["README.md", "skills/demo/SKILL.md"]);
  });

  it("removes the wrapping folder git also lists by itself", async () => {
    // this is what a real git archive looks like: the root appears as an entry as well as a prefix, and a
    // prefix test that only accepts contained paths refuses to strip it, hiding every skill underneath
    const entries: ArchiveEntry[] = [
      { path: "skills-main", type: "dir", size: 0 },
      { path: "skills-main/README.md", type: "file", size: 8, bytes: Buffer.from("# skills") },
      { path: "skills-main/skills/productivity/grill-me/SKILL.md", type: "file", size: 10, bytes: Buffer.from(skillMarkdown("grill-me")) }
    ];

    const source = new GitHubArchiveTreeSource(stripArchiveRoot(entries));

    expect((await source.list("")).map((entry) => entry.name)).toEqual(["README.md", "skills"]);
  });

  it("does not mistake a lone file at the root for a wrapping folder", () => {
    const entries: ArchiveEntry[] = [{ path: "README.md", type: "file", size: 1 }];

    expect(stripArchiveRoot(entries)).toEqual(entries);
  });

  it("leaves a tree alone when the entries do not share a root", () => {
    const entries = [
      { path: "README.md", type: "file" as const, size: 1 },
      { path: "skills/demo/SKILL.md", type: "file" as const, size: 1 }
    ];

    expect(stripArchiveRoot(entries)).toBe(entries);
  });
});

describe("gunzip", () => {
  it("unpacks what the platform packer produced", async () => {
    const text = skillMarkdown("round").repeat(40);

    expect((await gunzip(gzipSync(Buffer.from(text, "utf8")))).toString("utf8")).toBe(text);
  });
});

describe("createArchiveDependencies", () => {
  it("probes with a HEAD, which costs nothing on a wrong guess", async () => {
    const seen: Array<{ url: string; method?: string }> = [];
    const deps = createArchiveDependencies(async (url, method) => {
      seen.push({ url, method });
      return { status: method === "HEAD" && url.endsWith("/main") ? 200 : 404, arrayBuffer: new ArrayBuffer(0) };
    });

    expect(await deps.probeArchive("https://codeload.github.com/o/r/tar.gz/main")).toBe(true);
    expect(await deps.probeArchive("https://codeload.github.com/o/r/tar.gz/nope")).toBe(false);
    expect(seen).toHaveLength(2);
    expect(seen.every((request) => request.method === "HEAD")).toBe(true);
  });

  it("refuses an archive over the allowance before anything unpacks it", async () => {
    const deps = createArchiveDependencies(async () => ({ status: 200, arrayBuffer: new Uint8Array(4096).buffer }));

    await expect(deps.fetchArchive("https://codeload.github.com/o/r/tar.gz/main", 1024)).rejects.toThrow(GitHubArchiveTooLargeError);
    await expect(deps.fetchArchive("https://codeload.github.com/o/r/tar.gz/main", 1024)).rejects.toThrow(/over the 1 KB this plugin will download/);
  });

  it("passes a refused status through instead of inventing one", async () => {
    const deps = createArchiveDependencies(async () => ({ status: 503, arrayBuffer: new ArrayBuffer(0) }));

    expect((await deps.fetchArchive("https://codeload.github.com/o/r/tar.gz/main", 1024)).status).toBe(503);
  });
});

describe("defaultBranchFromPage", () => {
  it("reads the branch the repository names for itself", () => {
    expect(defaultBranchFromPage('{"tree":{"items":[]},"defaultBranch":"develop","name":"skills"}')).toBe("develop");
  });

  it("gives up quietly when the page says nothing", () => {
    expect(defaultBranchFromPage("<html>Whoa there! Rate limited</html>")).toBeUndefined();
    expect(defaultBranchFromPage(undefined)).toBeUndefined();
  });
});

describe("GitHubArchiveTreeSource", () => {
  it("lists a folder the way the contents API would, sorted and with sizes", async () => {
    const source = new GitHubArchiveTreeSource(mattpocockEntries());

    expect((await source.list("skills/productivity")).map((entry) => `${entry.name}:${entry.type}`)).toEqual(["grill-me:dir", "grilling:dir"]);
    const files = await source.list("skills/productivity/grill-me");
    expect(files.map((entry) => entry.name)).toEqual(["SKILL.md", "agents"]);
    expect(files.find((entry) => entry.name === "SKILL.md")?.size).toBe(Buffer.byteLength(skillMarkdown("grill-me")));
  });

  it("lists the repository root without shaving characters off the names", async () => {
    const source = new GitHubArchiveTreeSource(mattpocockEntries());

    expect((await source.list("")).map((entry) => `${entry.name}:${entry.type}`)).toEqual(["README.md:file", "skills:dir"]);
  });

  it("says the same thing as a 404 when the folder is not there", async () => {
    const source = new GitHubArchiveTreeSource(mattpocockEntries());

    await expect(source.list("skills/nope")).rejects.toBeInstanceOf(MissingSkillsFolderError);
    await expect(source.readFile("skills/nope/SKILL.md", join(await staging(), "x"), 1024)).rejects.toBeInstanceOf(MissingSkillsFolderError);
  });

  it("writes a file out of memory and reports the bytes", async () => {
    const destination = join(await staging(), "skills/productivity/grill-me/SKILL.md");

    const written = await new GitHubArchiveTreeSource(mattpocockEntries()).readFile("skills/productivity/grill-me/SKILL.md", destination, 4096);

    expect(written).toBe(Buffer.byteLength(skillMarkdown("grill-me")));
    expect(await readFile(destination, "utf8")).toBe(skillMarkdown("grill-me"));
  });
});

describe("the two routes agree", () => {
  const apiDownloader = () =>
    new GitHubSkillDownloader({
      fetchJson: async (path) => {
        const match = path.match(/\/contents(\/[^?]*)?/);
        return { status: 200, data: apiListing(match?.[1] ? decodeURIComponent(match[1].slice(1)) : "") };
      },
      downloadFile: async () => 0
    }, {}, new GitHubRequestBudget());

  const archiveDownloader = async () => {
    const blocks = Object.entries(mattpocockFiles).map(([path, content]) => tarBlock(`skills-main/${path}`, "file", content));
    return new GitHubArchiveDownloader({
      fetchArchive: async () => ({ status: 200, body: gzipSync(tar(blocks)) as unknown as ArrayBuffer }),
      probeArchive: async () => true
    });
  };

  it("downloads through the archive object rather than only the importer", async () => {
    const downloader = await archiveDownloader();

    expect((await downloader.listSkillCandidates({ ...location, ref: undefined }, "main")).map((candidate) => candidate.name)).toContain("productivity/grilling");
  });

  it("lists the folders that only exist because a file sits inside them", async () => {
    // git spells directories out in its archives and other packers do not, so a tree of files alone has
    // to list the same way
    const blocks = Object.entries(mattpocockFiles).map(([path, content]) => tarBlock(`skills-main/${path}`, "file", content));
    const source = new GitHubArchiveTreeSource(stripArchiveRoot(parseTar(tar(blocks))));

    expect((await source.list("")).map((entry) => entry.name)).toEqual(["README.md", "skills"]);
    expect((await source.list("skills")).map((entry) => entry.name)).toEqual(["deprecated", "engineering", "productivity"]);
  });

  it("offers the same candidates through the contents API and through the archive", async () => {
    const viaApi = await apiDownloader().listSkillCandidates(location);
    const source = new GitHubArchiveTreeSource(mattpocockEntries());
    const viaArchive = await new SkillTreeImporter(source, location, DEFAULT_ARCHIVE_LIMITS).listSkillCandidates();

    expect(viaApi.map((candidate) => candidate.name)).toEqual([
      "engineering/code-review",
      "productivity/grill-me",
      "productivity/grilling"
    ]);
    expect(viaArchive).toEqual(viaApi);
  });

  it("stages a nested skill identically through either route", async () => {
    const candidate = { kind: "folder" as const, name: "productivity/grill-me", label: "productivity/grill-me" };
    const apiTarget = await staging();
    const archiveTarget = await staging();

    const apiFiles = new Map<string, string>();
    const viaApi = await new GitHubSkillDownloader(
      {
        fetchJson: async (path) => {
          const match = path.match(/\/contents(\/[^?]*)?/);
          return { status: 200, data: apiListing(match?.[1] ? decodeURIComponent(match[1].slice(1)) : "") };
        },
        downloadFile: async (url, destination) => {
          const repoPath = url.replace("https://raw.githubusercontent.com/mattpocock/skills/main/", "");
          apiFiles.set(destination, mattpocockFiles[repoPath]);
          await (await import("fs/promises")).mkdir(join(destination, ".."), { recursive: true });
          await (await import("fs/promises")).writeFile(destination, mattpocockFiles[repoPath], "utf8");
          return Buffer.byteLength(mattpocockFiles[repoPath]);
        }
      },
      {},
      new GitHubRequestBudget()
    ).downloadSkillCandidate(location, candidate, apiTarget);
    const viaArchive = await new SkillTreeImporter(new GitHubArchiveTreeSource(mattpocockEntries()), location, DEFAULT_ARCHIVE_LIMITS).downloadCandidate(
      candidate,
      archiveTarget
    );

    expect(viaApi.skills.map((skill) => skill.folderName)).toEqual(["grill-me"]);
    expect(viaArchive.skills.map((skill) => skill.folderName)).toEqual(["grill-me"]);
    expect(viaArchive.skills[0].metadata.description).toBe("grill-me description");
  });

  it("downloads the archive once and answers everything else from memory", async () => {
    const archiveRequests: string[] = [];
    const downloader = new GitHubArchiveDownloader({
      fetchArchive: async (url) => {
        archiveRequests.push(url);
        const entries: Buffer[] = [];
        for (const [path, content] of Object.entries(mattpocockFiles)) {
          entries.push(tarBlock(`skills-main/${path}`, "file", content));
        }
        return { status: 200, body: gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])) as unknown as ArrayBuffer };
      },
      probeArchive: async (url) => {
        archiveRequests.push(`HEAD ${url}`);
        return url.endsWith("/main");
      }
    });

    const candidates = await downloader.listSkillCandidates(location);
    const discovered = await downloader.downloadSkillCandidate(location, candidates[1], await staging());

    expect(candidates.map((candidate) => candidate.name)).toContain("productivity/grill-me");
    expect(discovered.skills.map((skill) => skill.folderName)).toEqual(["grill-me"]);
    expect(archiveRequests.filter((request) => !request.startsWith("HEAD"))).toHaveLength(1);
  });
});

describe("GitHubArchiveDownloader.resolveRef", () => {
  const probes: string[] = [];
  const downloader = (existing: string[]) =>
    new GitHubArchiveDownloader({
      fetchArchive: async () => ({ status: 200, body: new ArrayBuffer(0) }),
      probeArchive: async (url) => {
        const ref = url.split("/tar.gz/")[1];
        probes.push(ref);
        return existing.includes(ref);
      }
    });

  it("believes a ref spelled in the URL before trying the usual names", async () => {
    probes.length = 0;

    expect(await downloader(["release/v2"]).resolveRef({ owner: "o", repo: "r" }, { ref: "release/v2" })).toBe("release/v2");
    expect(probes).toEqual(["release/v2"]);
  });

  it("refuses a ref spelled in the URL that has no archive, rather than importing another branch", async () => {
    probes.length = 0;

    await expect(downloader(["main"]).resolveRef({ owner: "o", repo: "r" }, { ref: "gone-branch" })).rejects.toBeInstanceOf(GitHubArchiveNotFoundError);
    expect(probes).toEqual(["gone-branch"]);
  });

  it("tries the branch the repository page named before falling back to main and master", async () => {
    probes.length = 0;

    expect(await downloader(["develop"]).resolveRef({ owner: "o", repo: "r" }, { defaultBranch: "develop" })).toBe("develop");
    expect(probes).toEqual(["develop"]);

    probes.length = 0;
    expect(await downloader(["master"]).resolveRef({ owner: "o", repo: "r" })).toBe("master");
    expect(probes).toEqual(["main", "master"]);
  });

  it("says which names it tried when none of them exist", async () => {
    await expect(downloader([]).resolveRef({ owner: "o", repo: "r" })).rejects.toBeInstanceOf(GitHubArchiveNotFoundError);
    await expect(downloader([]).resolveRef({ owner: "o", repo: "r" })).rejects.toThrow(/none of main, master could be fetched/);
  });

  it("refuses to guess a branch for a repository with no ref and no metadata", async () => {
    const downloader2 = new GitHubArchiveDownloader({ fetchArchive: async () => ({ status: 200, body: new ArrayBuffer(0) }), probeArchive: async () => true });

    await expect(downloader2.listSkillCandidates({ owner: "o", repo: "r", skillsPath: "skills" })).rejects.toThrow(/o\/r/);
  });
});

function padded(payload: Buffer): Buffer {
  const paddedBuffer = Buffer.alloc(Math.ceil(payload.byteLength / 512) * 512);
  payload.copy(paddedBuffer);
  return paddedBuffer;
}
