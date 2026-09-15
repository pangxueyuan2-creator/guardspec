import { readdir, readlink, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

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

export const MAX_SYMLINK_DIAGNOSTICS = 100;

export type RepositorySymlinkKind = "file" | "directory" | "other" | "unknown";

export interface RepositorySymlink {
  path: string;
  kind: RepositorySymlinkKind;
  target?: string;
}

export interface SymlinkDiagnosticReport {
  symlinks: RepositorySymlink[];
  truncated: boolean;
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
    // Do not traverse or read an inaccessible target merely to classify it.
  }

  return { path: repositoryPath, kind, ...(target ? { target } : {}) };
}

export async function inspectRepositorySymlinks(
  root: string,
): Promise<SymlinkDiagnosticReport> {
  const symlinks: RepositorySymlink[] = [];
  let truncated = false;

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const full = resolve(current, entry.name);
      const repositoryPath = relative(root, full).split(sep).join("/");
      if (entry.isSymbolicLink()) {
        if (symlinks.length < MAX_SYMLINK_DIAGNOSTICS) {
          symlinks.push(await inspectSymlink(full, repositoryPath));
        } else {
          truncated = true;
        }
        continue;
      }
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
        await walk(full);
      }
    }
  }

  await walk(root);
  return {
    symlinks: symlinks.sort((left, right) => left.path.localeCompare(right.path)),
    truncated,
  };
}
