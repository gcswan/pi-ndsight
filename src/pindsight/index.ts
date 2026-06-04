/**
 * pi-ndsight — persistent project memory for pi, backed by a local Hindsight
 * server. A fast pi port of the hindsight-cc Claude Code plugin.
 *
 * Streamlined startup:
 *   - First interactive session with no config -> setup wizard (Docker, provider,
 *     model, API key), then the server auto-starts in the background.
 *   - Configured sessions just auto-start the server (non-blocking).
 *   - Re-run anytime with /pindsight-setup.
 *
 * Slowness fixes vs hindsight-cc:
 *   - Direct fetch() from pi's long-lived process (no python subprocess per turn)
 *   - retain uses async:true, so a turn is never blocked on LLM extraction
 *   - retains are fire-and-forget through a background queue
 *   - recall is bounded by a timeout so a slow server never stalls a prompt
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getBankId, getProjectDir } from "./bank.ts";
import { retain, recall, reflect, health, debug, BASE_URL } from "./client.ts";
import { ensureServer, dockerStatus, CONTAINER } from "./server.ts";
import { resolveConfig, isConfigured, providerById } from "./config.ts";
import { runSetup, type WizardUI } from "./setup.ts";
import { buildRetention } from "./filter.ts";

const MAX_MEMORY_TOKENS = Number(process.env.HINDSIGHT_RECALL_TOKENS ?? 2048);
const RECALL_TIMEOUT_MS = Number(process.env.HINDSIGHT_RECALL_TIMEOUT_MS ?? 2500);

/** Sequential background queue: retains never block a turn and never pile up. */
function makeQueue() {
  let tail: Promise<void> = Promise.resolve();
  return (job: () => Promise<void>) => {
    tail = tail.then(job).catch((e) => debug(`retain failed: ${e}`));
  };
}

export default function (pi: ExtensionAPI) {
  let bankId = "";
  const enqueue = makeQueue();

  // Kick off the server in the background, surfacing progress in the footer.
  function startServer(ctx: { ui: { setStatus(k: string, v: string | undefined): void } }) {
    const cfg = resolveConfig();
    if (!isConfigured(cfg)) return;
    void ensureServer(cfg, (msg) => ctx.ui.setStatus("pindsight", msg || undefined)).then((ok) => {
      if (!ok) debug("server unavailable; memory features will no-op this session");
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    bankId = getBankId(ctx.cwd);
    debug(`bank: ${bankId}`);

    const cfg = resolveConfig();
    // First run: walk the user through setup (interactive sessions only).
    if (!isConfigured(cfg) && ctx.hasUI) {
      ctx.ui.notify("Welcome to pi-ndsight — let's set up persistent memory.", "info");
      const saved = await runSetup(ctx.ui as WizardUI);
      if (!saved) {
        ctx.ui.notify("Setup skipped. Run /pindsight-setup when ready.", "warning");
        return;
      }
    } else if (!isConfigured(cfg)) {
      debug("not configured and no UI; set HINDSIGHT_API_LLM_* env or run /pindsight-setup");
      return;
    }
    startServer(ctx);
  });

  // Recall relevant memories and inject them before the agent runs.
  pi.on("before_agent_start", async (event) => {
    const query = event.prompt?.trim();
    if (!bankId || !query) return;
    try {
      const results = await recall(bankId, query, {
        budget: "low",
        maxTokens: MAX_MEMORY_TOKENS,
        timeoutMs: RECALL_TIMEOUT_MS,
      });
      if (results.length === 0) {
        debug("no relevant memories");
        return;
      }
      debug(`injecting ${results.length} memories`);
      const block =
        "<pindsight-memories>\n" +
        results.map((r) => r.text).join("\n") +
        "\n</pindsight-memories>";
      return {
        message: {
          customType: "pindsight-memories",
          content: block,
          display: false, // sent to the LLM as context, kept out of the UI
        },
      };
    } catch (e) {
      debug(`recall skipped: ${e}`); // soft-fail: never block the prompt
    }
  });

  // Retain the exchange once the agent finishes — fire-and-forget.
  // buildRetention drops trivial turns (bare commands, acks, clipboard paths)
  // so they never pollute the memory bank.
  pi.on("agent_end", async (event) => {
    if (!bankId) return;
    const transcript = buildRetention((event.messages ?? []) as any[]);
    if (!transcript) {
      debug("exchange not worth retaining; skipped");
      return;
    }
    enqueue(() => retain(bankId, transcript));
  });

  // ---- Commands -----------------------------------------------------------

  pi.registerCommand("pindsight-setup", {
    description: "Configure pi-ndsight (Docker, provider, model, API key)",
    handler: async (_args, ctx) => {
      const saved = await runSetup(ctx.ui as WizardUI);
      if (saved) startServer(ctx);
    },
  });

  pi.registerCommand("pindsight-search", {
    description: "Search this project's memory bank",
    handler: async (args, ctx) => {
      const query = args.trim();
      if (!query) return ctx.ui.notify("Usage: /pindsight-search <query>", "warning");
      try {
        const results = await recall(bankId, query, { budget: "mid", maxTokens: 4096, timeoutMs: 15_000 });
        if (results.length === 0) return ctx.ui.notify("No relevant memories found.", "info");
        const body = results.map((r, i) => `--- Memory ${i + 1} ---\n${r.text}`).join("\n\n");
        pi.sendMessage({
          customType: "pindsight-search",
          content: `Found ${results.length} memories for "${query}":\n\n${body}`,
          display: true,
        });
      } catch (e) {
        ctx.ui.notify(`Search failed: ${e}`, "error");
      }
    },
  });

  pi.registerCommand("pindsight-reflect", {
    description: "Reflect on a decision using past project context",
    handler: async (args, ctx) => {
      const query = args.trim();
      if (!query) return ctx.ui.notify("Usage: /pindsight-reflect <query>", "warning");
      ctx.ui.setStatus("pindsight", "reflecting…");
      try {
        const answer = await reflect(bankId, query, { budget: "mid" });
        pi.sendMessage({ customType: "pindsight-reflect", content: answer, display: true });
      } catch (e) {
        ctx.ui.notify(`Reflect failed: ${e}`, "error");
      } finally {
        ctx.ui.setStatus("pindsight", undefined);
      }
    },
  });

  pi.registerCommand("pindsight-status", {
    description: "Show server status and this project's memory bank",
    handler: async (_args, ctx) => {
      const cfg = resolveConfig();
      const provider = providerById(cfg.provider);
      const ok = await health();
      const docker = await dockerStatus();
      const container = await import("node:child_process").then(
        (cp) =>
          new Promise<string>((resolve) => {
            cp.execFile(
              "docker",
              ["ps", "-f", `name=${CONTAINER}`, "--format", "{{.Status}}"],
              { timeout: 5000 },
              (err, stdout) => resolve(err ? "unknown" : stdout.trim() || "not running"),
            );
          }),
      );
      const lines = [
        `Project:   ${getProjectDir(ctx.cwd)}`,
        `Bank:      ${bankId}`,
        `Configured:${isConfigured(cfg) ? " yes" : " no — run /pindsight-setup"}`,
        `Provider:  ${provider ? `${provider.label} (${cfg.model})` : "unset"}`,
        `Docker:    ${docker}`,
        `Server:    ${ok ? "healthy" : "unavailable"} (${BASE_URL})`,
        `Container: ${container}`,
        `Browse:    http://localhost:9999/banks/${bankId}`,
      ];
      pi.sendMessage({ customType: "pindsight-status", content: lines.join("\n"), display: true });
    },
  });
}
