import { realpathSync, lstatSync } from "node:fs";
import { readdir, readFile, readlink, stat } from "node:fs/promises";
import { relative, resolve, sep, isAbsolute, win32 } from "node:path";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".guardspec",
]);
export const MAX_FILE_BYTES = 512_000;
export const MAX_FILES = 2_000;
export const MAX_SYMLINK_DIAGNOSTICS = 100;

export type RepositorySymlinkKind =
  | "file"
  | "directory"
  | "other"
  | "unknown";

export interface RepositorySymlink {
  path: string;
  kind: RepositorySymlinkKind;
  target?: string;
}

export interface RepositoryWalkResult {
  files: string[];
  symlinks: RepositorySymlink[];
}

export function normalizeRepositoryPath(input: string): string {
  const universal = input.replaceAll("\\", "/");
  if (
    !universal ||
    isAbsolute(universal) ||
    win32.isAbsolute(input) ||
    universal.startsWith("//")
  ) {
    throw new Error(
      `Path must be a non-empty repository-relative path: ${input}`,
    );
  }
  const parts = universal.split("/");
  if (parts.some((part) => part === ".." || part === "" || part === ".")) {
    throw new Error(`Unsafe relative path: ${input}`);
  }
  return parts.join("/");
}

export function repositoryRoot(start: string): string {
  return realpathSync(start);
}

export function safeResolve(root: string, candidate: string): string {
  const normalized = normalizeRepositoryPath(candidate);
  const target = resolve(root, ...normalized.split("/"));
  const rel = relative(root, target);
  if (
    rel === "" ||
    rel.startsWith(`..${sep}`) ||
    rel === ".." ||
    isAbsolute(rel)
  ) {
    throw new Error(`Path escapes repository root: ${candidate}`);
  }
  return target;
}

export async function safeRead(
  root: string,
  candidate: string,
): Promise<string> {
  const target = safeResolve(root, candidate);
  const metadata = await stat(target);
  if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) {
    throw new Error(
      `Refusing to read unsupported or oversized file: ${candidate}`,
    );
  }
  const resolvedTarget = realpathSync(target);
  const rel = relative(root, resolvedTarget);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error(`Symlink escapes repository root: ${candidate}`);
  }
  return readFile(resolvedTarget, "utf8");
}

async function inspectSymlink(
  full: string,
  repositoryPath: string,
): Promise<RepositorySymlink> {
  let target: string | undefined;
  try {
    target = await readlink(full);
  } catch {
    // A broken or concurrently-mutated symlink is still useful as a diagnostic.
  }

  let kind: RepositorySymlinkKind = "unknown";
  try {
    const metadata = await stat(full);
    kind = metadata.isDirectory()
      ? "directory"
      : metadata.isFile()
        ? "file"
        : "other";
  } catch {
    // Never follow the link further just to classify an inaccessible target.
  }

  return { path: repositoryPath, kind, ...(target ? { target } : {}) };
}

export async function walkRepositoryDetailed(
  root: string,
): Promise<RepositoryWalkResult> {
  const output: string[] = [];
  const symlinks: RepositorySymlink[] = [];
  async function walk(current: string): Promise<void> {
    if (output.length >= MAX_FILES) return;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (output.length >= MAX_FILES) return;
      const full = resolve(current, entry.name);
      const relativePath = relative(root, full).split(sep).join("/");
      if (entry.isSymbolicLink()) {
        if (symlinks.length < MAX_SYMLINK_DIAGNOSTICS) {
          symlinks.push(await inspectSymlink(full, relativePath));
        }
        continue;
      }
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        if (lstatSync(full).size <= MAX_FILE_BYTES) output.push(relativePath);
      } catch {
        // Concurrent workspace mutations are ignored; callers retain deterministic sorted output.
      }
    }
  }
  await walk(root);
  return {
    files: output.sort((a, b) => a.localeCompare(b)),
    symlinks: symlinks.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export async function walkRepository(root: string): Promise<string[]> {
  return (await walkRepositoryDetailed(root)).files;
}
