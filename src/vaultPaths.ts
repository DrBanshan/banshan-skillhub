import { realpath, rm } from "fs/promises";
import { dirname, isAbsolute, relative, resolve, sep, win32 } from "path";

export class UnsafeVaultPathError extends Error {
  constructor(relativePath: string) {
    super(`Path must be a non-empty vault-relative path: ${relativePath}`);
    this.name = "UnsafeVaultPathError";
  }
}

export function resolveVaultRelativePath(vaultPath: string, relativePath: string): string;
export function resolveVaultRelativePath(
  vaultPath: string,
  relativePath: string,
  options: { verifyFilesystem: true }
): Promise<string>;
export function resolveVaultRelativePath(
  vaultPath: string,
  relativePath: string,
  options?: { verifyFilesystem: true }
): string | Promise<string> {
  const trimmed = relativePath.trim();
  if (!trimmed || trimmed === "." || isAbsolute(trimmed) || win32.isAbsolute(trimmed)) {
    throw new UnsafeVaultPathError(relativePath);
  }

  const normalized = trimmed.replace(/[\\/]+/g, sep);
  const resolvedVault = resolve(vaultPath);
  const resolvedPath = resolve(resolvedVault, normalized);
  const pathFromVault = relative(resolvedVault, resolvedPath);
  if (!pathFromVault || pathFromVault === ".." || pathFromVault.startsWith(`..${sep}`) || isAbsolute(pathFromVault)) {
    throw new UnsafeVaultPathError(relativePath);
  }

  return options?.verifyFilesystem ? verifyExistingAncestor(resolvedVault, resolvedPath, relativePath) : resolvedPath;
}

export async function removeVaultRelativePath(vaultPath: string, relativePath: string): Promise<void> {
  const resolvedPath = await resolveVaultRelativePath(vaultPath, relativePath, { verifyFilesystem: true });
  await rm(resolvedPath, { force: true, recursive: true });
}

async function verifyExistingAncestor(vaultPath: string, targetPath: string, relativePath: string): Promise<string> {
  const realVaultPath = await realpath(vaultPath);
  let candidate = targetPath;

  while (true) {
    try {
      const realCandidate = await realpath(candidate);
      const pathFromVault = relative(realVaultPath, realCandidate);
      if (pathFromVault === ".." || pathFromVault.startsWith(`..${sep}`) || isAbsolute(pathFromVault)) {
        throw new Error(`Resolved path is outside the vault: ${relativePath}`);
      }
      return targetPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw new UnsafeVaultPathError(relativePath);
      candidate = parent;
    }
  }
}
