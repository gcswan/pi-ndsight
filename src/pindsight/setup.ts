/**
 * First-run setup wizard. Walks the user through Docker, provider, model, and
 * API key, then saves config. Runs on first session (when unconfigured) and on
 * demand via /pindsight-setup.
 */
import { PROVIDERS, providerById, resolveConfig, saveConfig, type Config } from "./config.ts";
import { dockerStatus } from "./server.ts";

/** The subset of ctx.ui the wizard needs (kept loose to avoid type coupling). */
export interface WizardUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

/**
 * Run the interactive setup. Returns the saved config, or undefined if the user
 * cancelled. Pre-fills from any existing config/env so re-running is easy.
 */
export async function runSetup(ui: WizardUI): Promise<Config | undefined> {
  const current = resolveConfig();

  // 1. Docker environment.
  const docker = await dockerStatus();
  if (docker === "not-installed") {
    const cont = await ui.confirm(
      "Docker not found",
      "pi-ndsight needs Docker to run the memory server. Install Docker Desktop (https://docker.com), then re-run /pindsight-setup.\n\nSave LLM settings now anyway?",
    );
    if (!cont) return undefined;
  } else if (docker === "not-running") {
    const cont = await ui.confirm(
      "Docker not running",
      "Docker is installed but not running. Start Docker Desktop, then the server will come up automatically.\n\nContinue with setup now?",
    );
    if (!cont) return undefined;
  }

  // 2. Provider.
  const labels = PROVIDERS.map((p) => p.label);
  const currentLabel = providerById(current.provider)?.label;
  const chosenLabel = await ui.select(
    `Select the model provider for memory${currentLabel ? ` (current: ${currentLabel})` : ""}`,
    labels,
  );
  if (chosenLabel === undefined) return undefined;
  const provider = PROVIDERS.find((p) => p.label === chosenLabel)!;

  // 3. Model.
  const modelDefault =
    current.provider === provider.id && current.model ? current.model : provider.defaultModel;
  const hint = modelDefault
    ? `default: ${modelDefault}${provider.id === "groq" ? ", recommended" : ""}`
    : "enter a model name";
  const entered = await ui.input(`Model for ${provider.label} (${hint})`, modelDefault || "model name");
  // Empty submit (Enter) accepts the default rather than failing.
  const model = entered && entered.trim() ? entered.trim() : modelDefault;
  if (!model) {
    ui.notify("A model name is required.", "error");
    return undefined;
  }

  // 4. Base URL for local providers.
  let baseUrl: string | undefined;
  if (provider.defaultBaseUrl) {
    const def = current.baseUrl || provider.defaultBaseUrl;
    baseUrl = (await ui.input(`${provider.label} base URL`, def)) || def;
  }

  // 5. API key for cloud providers.
  let apiKey: string | undefined = current.apiKey;
  if (provider.needsKey) {
    const entered = await ui.input(
      `${provider.label} API key${current.apiKey ? " (leave blank to keep current)" : ""}`,
      "sk-...",
    );
    if (entered) apiKey = entered;
    if (!apiKey) ui.notify("No API key set — memory features will be disabled until you add one.", "warning");
  } else {
    apiKey = undefined;
  }

  const cfg: Config = {
    provider: provider.id,
    model,
    apiKey,
    baseUrl,
    image: current.image,
    dataDir: current.dataDir,
  };
  saveConfig(cfg);
  ui.notify("pi-ndsight configured. Starting the memory server…", "info");
  return cfg;
}
