import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, relative, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { removeVaultRelativePath, resolveVaultRelativePath } from "../src/vaultPaths";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("vault-relative paths", () => {
  it.each(["../outside", "/tmp/outside", "C:\\outside", "", "."])("rejects unsafe path %j", (relativePath) => {
    expect(() => resolveVaultRelativePath("/vault", relativePath)).toThrow(/vault-relative/i);
  });

  it("resolves a valid path below the vault", () => {
    expect(resolveVaultRelativePath("/vault", "Skill/writer")).toBe(resolve("/vault", "Skill", "writer"));
  });

  it("rejects a path whose existing ancestor is a symlink outside the vault", async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), "skillhub-safe-vault-"));
    const outsidePath = await mkdtemp(join(tmpdir(), "skillhub-safe-outside-"));
    temporaryDirectories.push(vaultPath, outsidePath);
    await symlink(outsidePath, join(vaultPath, "Skill"), "dir");

    await expect(resolveVaultRelativePath(vaultPath, "Skill/writer", { verifyFilesystem: true })).rejects.toThrow(
      /outside the vault/i
    );
  });

  it("never deletes a configured path outside the vault", async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), "skillhub-safe-vault-"));
    const outsidePath = await mkdtemp(join(tmpdir(), "skillhub-safe-outside-"));
    temporaryDirectories.push(vaultPath, outsidePath);
    await mkdir(join(outsidePath, "writer"), { recursive: true });
    await writeFile(join(outsidePath, "writer", "SKILL.md"), "preserve", "utf8");

    await expect(removeVaultRelativePath(vaultPath, join(relative(vaultPath, outsidePath), "writer"))).rejects.toThrow();
    await expect(readFile(join(outsidePath, "writer", "SKILL.md"), "utf8")).resolves.toBe("preserve");
    await expect(access(vaultPath)).resolves.toBeUndefined();
  });
});
