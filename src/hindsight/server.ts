/**
 * Ensure the Hindsight Docker container is running. Ported from
 * ensure-hindsight.sh. Runs in the background from session_start so startup is
 * never blocked waiting on Docker.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import * as path from "node:path";
import { health, debug } from "./client.ts";

const exec = promisify(execFile);

const CONTAINER = "hindsight-cc"; // reuse the same container the plugin created
const IMAGE = process.env.HINDSIGHT_IMAGE ?? "ghcr.io/vectorize-io/hindsight:0.1.16";
const DATA_DIR = path.join(os.homedir(), "hindsight-data");

async function docker(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await exec("docker", args, { timeout: 15_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Start the server if it isn't already healthy. Returns true once reachable. */
export async function ensureServer(): Promise<boolean> {
  if (await health(1500)) {
    debug("server already running");
    return true;
  }

  // Docker available?
  if ((await docker(["info"])) === null) {
    debug("docker not available; skipping auto-start");
    return false;
  }

  const existing = await docker(["ps", "-aq", "-f", `name=${CONTAINER}`]);
  if (existing) {
    debug("starting existing container");
    await docker(["start", CONTAINER]);
  } else {
    debug("creating new container");
    const apiKey = process.env.HINDSIGHT_API_LLM_API_KEY ?? "";
    if (!apiKey) debug("warning: HINDSIGHT_API_LLM_API_KEY not set");
    await docker([
      "run", "-d", "--name", CONTAINER,
      "-p", "8888:8888", "-p", "9999:9999",
      "-e", `HINDSIGHT_API_LLM_API_KEY=${apiKey}`,
      "-e", `HINDSIGHT_API_LLM_MODEL=${process.env.HINDSIGHT_API_LLM_MODEL ?? "gpt-5-nano"}`,
      "-e", `HINDSIGHT_API_LLM_PROVIDER=${process.env.HINDSIGHT_API_LLM_PROVIDER ?? "openai"}`,
      "-v", `${DATA_DIR}:/home/hindsight/.pg0`,
      IMAGE,
    ]);
  }

  // Wait up to 30s for health.
  for (let i = 0; i < 30; i++) {
    if (await health(1000)) {
      debug(`server ready after ~${i + 1}s`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  debug("server did not become healthy within 30s");
  return false;
}

export { CONTAINER };
