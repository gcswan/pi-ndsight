/**
 * hindsight — persistent project memory for pi, backed by the Hindsight server.
 *
 * A pi port of the hindsight-cc Claude Code plugin, with the slow parts fixed:
 *
 *   - Direct fetch() from pi's long-lived process (no python subprocess per turn)
 *   - Retain uses async:true, so the turn is never blocked on LLM extraction
 *   - Retains are fire-and-forget through a background queue
 *   - Recall is bounded by a timeout so a slow server never stalls a prompt
 *
 * Lifecycle mapping (Claude Code hook -> pi event):
 *   SessionStart      -> session_start        (compute bank id, ensure server)
 *   UserPromptSubmit  -> before_agent_start   (recall + inject memories)
 *   Stop              -> agent_end            (retain the exchange, async)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getBankId, getProjectDir } from "./bank.ts";
import { retain, recall, reflect, health, debug, BASE_URL } from "./client.ts";
import { ensureServer, CONTAINER } from "./server.ts";
import { execFile } from "node:child_process";

const MAX_MEMORY_TOKENS = Number(process.env.HINDSIGHT_RECALL_TOKENS ?? 2048);
const RECALL_TIMEOUT_MS = Number(process.env.HINDSIGHT_RECALL_TIMEOUT_MS ?? 2500);

/** Sequential background queue: retains never block a turn and never pile up. */
function makeQueue() {
  let tail: Promise<void> = Promise.resolve();
  return (job: () => Promise<void>) => {
    tail = tail.then(job).catch((e) => debug(`retain failed: ${e}`));
  };
}

/** Pull the plain-text body out of a message's content. */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: string; text: string } =>
        !!p && typeof p === "object" && (p as any).type === "text" && typeof (p as any).text === "string")
      .map((p) => p.text)
      .join("\n")
      .trim();
  }
  return "";
}

export default function (pi: ExtensionAPI) {
  let bankId = "";
  const enqueue = makeQueue();

  pi.on("session_start", async (_event, ctx) => {
    bankId = getBankId(ctx.cwd);
    debug(`bank: ${bankId}`);
    // Don't block startup on Docker — bring the server up in the background.
    void ensureServer().then((ok) => {
      if (!ok) debug("hindsight server unavailable; memory features will no-op");
    });
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
        "<hindsight-memories>\n" +
        results.map((r) => r.text).join("\n") +
        "\n</hindsight-memories>";
      return {
        message: {
          customType: "hindsight-memories",
          content: block,
          display: false, // sent to the LLM as context, kept out of the UI
        },
      };
    } catch (e) {
      debug(`recall skipped: ${e}`); // soft-fail: never block the prompt
    }
  });

  // Retain the full exchange once the agent finishes — fire-and-forget.
  pi.on("agent_end", async (event) => {
    if (!bankId) return;
    const lines: string[] = [];
    for (const msg of event.messages ?? []) {
      const role = (msg as any).role;
      if (role !== "user" && role !== "assistant") continue; // skip tool-result noise
      const text = messageText((msg as any).content);
      if (text) lines.push(`${role}: ${text}`);
    }
    const transcript = lines.join("\n");
    if (!transcript) return;
    enqueue(() => retain(bankId, transcript));
  });

  // ---- Commands -----------------------------------------------------------

  pi.registerCommand("hindsight-search", {
    description: "Search this project's Hindsight memory bank",
    handler: async (args, ctx) => {
      const query = args.trim();
      if (!query) return ctx.ui.notify("Usage: /hindsight-search <query>", "warning");
      try {
        const results = await recall(bankId, query, { budget: "mid", maxTokens: 4096, timeoutMs: 15_000 });
        if (results.length === 0) return ctx.ui.notify("No relevant memories found.", "info");
        const body = results.map((r, i) => `--- Memory ${i + 1} ---\n${r.text}`).join("\n\n");
        pi.sendMessage({
          customType: "hindsight-search",
          content: `Found ${results.length} memories for "${query}":\n\n${body}`,
          display: true,
        });
      } catch (e) {
        ctx.ui.notify(`Search failed: ${e}`, "error");
      }
    },
  });

  pi.registerCommand("hindsight-reflect", {
    description: "Reflect on a decision using past project context",
    handler: async (args, ctx) => {
      const query = args.trim();
      if (!query) return ctx.ui.notify("Usage: /hindsight-reflect <query>", "warning");
      ctx.ui.setStatus("hindsight", "reflecting…");
      try {
        const answer = await reflect(bankId, query, { budget: "mid" });
        pi.sendMessage({ customType: "hindsight-reflect", content: answer, display: true });
      } catch (e) {
        ctx.ui.notify(`Reflect failed: ${e}`, "error");
      } finally {
        ctx.ui.setStatus("hindsight", "");
      }
    },
  });

  pi.registerCommand("hindsight-status", {
    description: "Show Hindsight server status and this project's memory bank",
    handler: async (_args, ctx) => {
      const ok = await health();
      const container = await new Promise<string>((resolve) => {
        execFile(
          "docker",
          ["ps", "-f", `name=${CONTAINER}`, "--format", "{{.Status}}"],
          { timeout: 5000 },
          (err, stdout) => resolve(err ? "unknown" : stdout.trim() || "not running"),
        );
      });
      const lines = [
        `Project:   ${getProjectDir(ctx.cwd)}`,
        `Bank:      ${bankId}`,
        `Server:    ${ok ? "healthy" : "unavailable"} (${BASE_URL})`,
        `Container: ${container}`,
        `Browse:    http://localhost:9999/banks/${bankId}`,
      ];
      pi.sendMessage({ customType: "hindsight-status", content: lines.join("\n"), display: true });
    },
  });
}
