/**
 * Configuration for the Hindsight server: which LLM provider/model it uses for
 * memory extraction and recall, plus the API key.
 *
 * Resolution order (highest priority first):
 *   1. ~/.pi/agent/pindsight/config.json  (written by the setup wizard)
 *   2. HINDSIGHT_API_LLM_* environment variables (for headless / CI use)
 *
 * Storing the key in a 0600 file is the same trust level as exporting it in a
 * shell profile, but lets the wizard manage it without editing dotfiles.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface Provider {
  id: string;
  label: string;
  defaultModel: string;
  needsKey: boolean;
  /** Local providers run outside the container; default points at the host. */
  defaultBaseUrl?: string;
}

/** Providers the Hindsight server understands. */
export const PROVIDERS: Provider[] = [
  { id: "openai", label: "OpenAI", defaultModel: "gpt-5-mini", needsKey: true },
  { id: "groq", label: "Groq (fast inference)", defaultModel: "openai/gpt-oss-20b", needsKey: true },
  { id: "anthropic", label: "Anthropic", defaultModel: "claude-sonnet-4-20250514", needsKey: true },
  { id: "gemini", label: "Google Gemini", defaultModel: "gemini-2.0-flash", needsKey: true },
  // Local providers: the server runs in Docker, so it reaches the host via host.docker.internal.
  { id: "ollama", label: "Ollama (local, no key)", defaultModel: "llama3", needsKey: false, defaultBaseUrl: "http://host.docker.internal:11434/v1" },
  { id: "lmstudio", label: "LM Studio (local, no key)", defaultModel: "", needsKey: false, defaultBaseUrl: "http://host.docker.internal:1234/v1" },
];

export function providerById(id: string | undefined): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export interface Config {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  image?: string;
  dataDir?: string;
}

export const CONFIG_DIR = path.join(os.homedir(), ".pi", "agent", "pindsight");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const DEFAULT_DATA_DIR = path.join(os.homedir(), "hindsight-data");

function readFileConfig(): Config {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Config;
  } catch {
    return {};
  }
}

/** Merge the saved config file over environment-variable fallbacks. */
export function resolveConfig(): Config {
  const file = readFileConfig();
  const env = process.env;
  return {
    provider: file.provider ?? env.HINDSIGHT_API_LLM_PROVIDER,
    model: file.model ?? env.HINDSIGHT_API_LLM_MODEL,
    apiKey: file.apiKey ?? env.HINDSIGHT_API_LLM_API_KEY,
    baseUrl: file.baseUrl ?? env.HINDSIGHT_API_LLM_BASE_URL,
    image: file.image ?? env.HINDSIGHT_IMAGE ?? "ghcr.io/vectorize-io/hindsight:0.1.16",
    dataDir: file.dataDir ?? env.HINDSIGHT_DATA_DIR ?? DEFAULT_DATA_DIR,
  };
}

/** True when the server has enough config to start successfully. */
export function isConfigured(cfg: Config): boolean {
  const p = providerById(cfg.provider);
  if (!p || !cfg.model) return false;
  return p.needsKey ? !!cfg.apiKey : true;
}

/** Persist only the user-chosen fields (not resolved defaults) to a 0600 file. */
export function saveConfig(cfg: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const out: Config = {
    provider: cfg.provider,
    model: cfg.model,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
  };
  if (cfg.image) out.image = cfg.image;
  if (cfg.dataDir) out.dataDir = cfg.dataDir;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* best effort */
  }
}

/** Environment passed to docker compose / docker run for the server container. */
export function serverEnv(cfg: Config): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HINDSIGHT_API_LLM_PROVIDER: cfg.provider ?? "openai",
    HINDSIGHT_API_LLM_MODEL: cfg.model ?? "gpt-5-mini",
    HINDSIGHT_API_LLM_API_KEY: cfg.apiKey ?? "",
    HINDSIGHT_API_LLM_BASE_URL: cfg.baseUrl ?? "",
    HINDSIGHT_IMAGE: cfg.image ?? "ghcr.io/vectorize-io/hindsight:0.1.16",
    HINDSIGHT_DATA_DIR: cfg.dataDir ?? DEFAULT_DATA_DIR,
  };
}
