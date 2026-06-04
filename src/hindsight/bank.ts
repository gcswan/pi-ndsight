/**
 * Bank ID generation, ported from hindsight-cc's bank_utils.py.
 *
 * A project's memory bank is identified by its git remote (owner-repo) when
 * available, falling back to the last two path components. This means the same
 * repo cloned to different paths shares one bank.
 *
 * The prefix is configurable via HINDSIGHT_BANK_PREFIX. It defaults to
 * "claude-code--" so this extension shares the exact same per-project banks
 * your hindsight-cc plugin already populated (continuity of existing memory).
 * Set HINDSIGHT_BANK_PREFIX=pi-- to keep pi's memory separate.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

const PREFIX = process.env.HINDSIGHT_BANK_PREFIX ?? "claude-code--";

function git(args: string[], cwd: string): string | null {
  try {
    const out = execFileSync("git", args, {
      cwd,
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.toString().trim() || null;
  } catch {
    return null;
  }
}

/** Find the git repo root, falling back to the given working directory. */
export function getProjectDir(cwd: string): string {
  const root = git(["rev-parse", "--show-toplevel"], cwd);
  return root ?? cwd;
}

/** Extract "owner-repo" from the origin remote URL, if any. */
function getGitRemoteId(projectDir: string): string | null {
  let url = git(["remote", "get-url", "origin"], projectDir);
  if (!url) return null;
  url = url.replace(/\.git$/, "");

  // SSH: git@domain:path
  const ssh = url.match(/^git@[^:]+:(.+)$/);
  // HTTPS: https://[user@]domain/path
  const https = url.match(/^https?:\/\/(?:[^@]+@)?[^/]+\/(.+)$/);
  const p = ssh?.[1] ?? https?.[1];
  if (!p) return null;

  const parts = p.split("/").filter(Boolean);
  if (parts.length >= 2) return `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
  if (parts.length === 1) return parts[0];
  return null;
}

/** Fallback: last two path components, e.g. /home/user/code/app -> code-app */
function getPathBasedId(projectDir: string): string {
  const parts = projectDir.split(path.sep).filter(Boolean);
  if (parts.length >= 2) return `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
  if (parts.length === 1) return `${parts[0]}-${parts[0]}`;
  return "unknown-unknown";
}

/** Resolve the full bank id for a working directory. */
export function getBankId(cwd: string): string {
  let projectDir = getProjectDir(cwd);
  try {
    projectDir = fs.realpathSync(projectDir);
  } catch {
    /* use as-is */
  }
  const suffix = getGitRemoteId(projectDir) ?? getPathBasedId(projectDir);
  return `${PREFIX}${suffix}`.toLowerCase();
}
