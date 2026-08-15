import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

interface ResolveChangedFilesOptions {
  cwd?: string;
  eventPath?: string;
}

interface GitHubEvent {
  before?: unknown;
  pull_request?: {
    base?: {
      sha?: unknown;
    };
  };
}

function eventBase(eventPath: string | undefined): string | undefined {
  if (!eventPath) return undefined;
  const payload = JSON.parse(readFileSync(eventPath, "utf8")) as GitHubEvent;
  const pullRequestBase = payload.pull_request?.base?.sha;
  if (typeof pullRequestBase === "string" && pullRequestBase.trim())
    return pullRequestBase;
  if (typeof payload.before === "string" && payload.before.trim())
    return payload.before;
  return undefined;
}

export function resolveChangedFiles(
  input: string,
  options: ResolveChangedFilesOptions = {},
): string[] {
  if (input.trim())
    return input
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);

  const base = eventBase(options.eventPath ?? process.env.GITHUB_EVENT_PATH);
  const diffArgs = base
    ? ["diff", "--name-only", "--no-renames", base, "HEAD"]
    : ["diff", "--name-only", "--no-renames", "HEAD^", "HEAD"];
  try {
    return execFileSync("git", diffArgs, {
      cwd: options.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    throw new Error(
      "Unable to determine changed files; provide changed-files explicitly or fetch the event base revision.",
    );
  }
}
