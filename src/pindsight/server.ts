/**
 * Ensure the Hindsight server container is running. Prefers `docker compose`
 * with the bundled docker-compose.yml; falls back to `docker run`. Runs in the
 * background from session_start so startup is never blocked on Docker.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import { health, debug } from "./client.ts";
import { serverEnv, type Config } from "./config.ts";

const exec = promisify(execFile);

export const CONTAINER = "pindsight";

/** docker-compose.yml lives at the package root, two levels up from this file. */
const COMPOSE_FILE = path.resolve(fileURLToPath(import.meta.url), "../../../docker-compose.yml");

export type DockerStatus = "ok" | "not-installed" | "not-running";

/** Probe Docker availability for the setup wizard and status command. */
export async function dockerStatus(): Promise<DockerStatus> {
  try {
    await exec("docker", ["--version"], { timeout: 5000 });
  } catch {
    return "not-installed";
  }
  try {
    await exec("docker", ["info"], { timeout: 10_000 });
    return "ok";
  } catch {
    return "not-running";
  }
}

async function hasComposeV2(): Promise<boolean> {
  try {
    await exec("docker", ["compose", "version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function startWithCompose(env: NodeJS.ProcessEnv): Promise<boolean> {
  if (!fs.existsSync(COMPOSE_FILE)) return false;
  if (!(await hasComposeV2())) return false;
  try {
    await exec("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d"], { env, timeout: 120_000 });
    debug("started via docker compose");
    return true;
  } catch (e) {
    debug(`docker compose up failed: ${e}`);
    return false;
  }
}

async function startWithRun(cfg: Config, env: NodeJS.ProcessEnv): Promise<void> {
  // Reuse an existing container if present, else create one.
  const existing = await exec("docker", ["ps", "-aq", "-f", `name=${CONTAINER}`], { timeout: 10_000 })
    .then((r) => r.stdout.trim())
    .catch(() => "");
  if (existing) {
    debug("starting existing container");
    await exec("docker", ["start", CONTAINER], { timeout: 30_000 }).catch(() => {});
    return;
  }
  debug("creating container via docker run");
  await exec(
    "docker",
    [
      "run", "-d", "--name", CONTAINER,
      "-p", "8888:8888", "-p", "9999:9999",
      "--add-host", "host.docker.internal:host-gateway",
      "-e", `HINDSIGHT_API_LLM_PROVIDER=${env.HINDSIGHT_API_LLM_PROVIDER}`,
      "-e", `HINDSIGHT_API_LLM_MODEL=${env.HINDSIGHT_API_LLM_MODEL}`,
      "-e", `HINDSIGHT_API_LLM_API_KEY=${env.HINDSIGHT_API_LLM_API_KEY}`,
      "-e", `HINDSIGHT_API_LLM_BASE_URL=${env.HINDSIGHT_API_LLM_BASE_URL}`,
      "-v", `${env.HINDSIGHT_DATA_DIR}:/home/hindsight/.pg0`,
      env.HINDSIGHT_IMAGE!,
    ],
    { timeout: 120_000 },
  ).catch((e) => debug(`docker run failed: ${e}`));
}

/**
 * Bring the server up if it isn't already healthy. Returns true once reachable.
 * `onProgress` reports human-readable status for the footer/notify.
 */
export async function ensureServer(cfg: Config, onProgress?: (msg: string) => void): Promise<boolean> {
  if (await health(1500)) {
    debug("server already running");
    return true;
  }
  if ((await dockerStatus()) !== "ok") {
    debug("docker not available; skipping auto-start");
    return false;
  }

  onProgress?.("starting memory server…");
  fs.mkdirSync(serverEnv(cfg).HINDSIGHT_DATA_DIR!, { recursive: true });
  const env = serverEnv(cfg);

  if (!(await startWithCompose(env))) {
    await startWithRun(cfg, env);
  }

  for (let i = 0; i < 30; i++) {
    if (await health(1000)) {
      debug(`server ready after ~${i + 1}s`);
      onProgress?.("");
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  debug("server did not become healthy within 30s");
  onProgress?.("");
  return false;
}
