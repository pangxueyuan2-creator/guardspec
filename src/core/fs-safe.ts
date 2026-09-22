import { realpathSync, lstatSync } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve, sep, isAbsolute, win32 } from "node:path";

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

/**
 * Validate existing path components before creating directories or writing.
 * The selected root may be an alias, but writes below it never follow links.
 * This guards a static workspace, not concurrent filesystem replacement.
 */
export async function safeWrite(
  root: string,
  candidate: string,
  contents: string,
  { createParents = false }: { createParents?: boolean } = {},
): Promise<void> {
  if (Buffer.byteLength(contents, "utf8") > MAX_FILE_BYTES) {
    throw new Error(`Refusing to write oversized file: ${candidate}`);
  }
  const canonicalRoot = repositoryRoot(root);
  const target = safeResolve(canonicalRoot, candidate);
  const parts = relative(canonicalRoot, target).split(sep);
  let current = canonicalRoot;
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    // lstat also identifies Windows directory junctions and dangling links.
    if (metadata.isSymbolicLink()) {
      throw new Error(`Refusing to write through symbolic link: ${candidate}`);
    }
    const rel = relative(canonicalRoot, realpathSync(current));
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`Path escapes repository root: ${candidate}`);
    }
    if (
      index === parts.length - 1 ? !metadata.isFile() : !metadata.isDirectory()
    ) {
      throw new Error(`Refusing to write unsupported file path: ${candidate}`);
    }
  }
  if (createParents) await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
}

export async function walkRepository(root: string): Promise<string[]> {
  const output: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = resolve(current, entry.name);
      const relativePath = relative(root, full).split(sep).join("/");
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      let size: number;
      try {
        size = lstatSync(full).size;
      } catch {
        // Concurrent workspace mutations are ignored; callers retain deterministic sorted output.
        continue;
      }
      if (size > MAX_FILE_BYTES) continue;
      // Check at the next eligible file, so a complete tree containing exactly
      // MAX_FILES remains valid. Never let callers treat a prefix as a full scan.
      if (output.length >= MAX_FILES)
        throw new Error(
          `Repository discovery exceeds ${MAX_FILES} files; refusing an incomplete scan.`,
        );
      output.push(relativePath);
    }
  }
  await walk(root);
  return output.sort((a, b) => a.localeCompare(b));
}
