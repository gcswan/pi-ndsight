/**
 * Direct HTTP client for the Hindsight server.
 *
 * Talks to the REST API the Python client wraps:
 *   retain : POST /v1/default/banks/{bank}/memories
 *   recall : POST /v1/default/banks/{bank}/memories/recall
 *   reflect: POST /v1/default/banks/{bank}/reflect
 *   health : GET  /health
 *
 * Runs inside pi's long-lived Node process, so there is no per-turn subprocess
 * or interpreter startup cost, and fetch keeps connections alive automatically.
 */

const BASE_URL = process.env.HINDSIGHT_BASE_URL ?? "http://localhost:8888";
const DEBUG = ["1", "true", "yes"].includes((process.env.HINDSIGHT_DEBUG ?? "").toLowerCase());

export function debug(msg: string): void {
  if (DEBUG) process.stderr.write(`[hindsight] ${msg}\n`);
}

export interface RecallResult {
  id: string;
  text: string;
  type?: string;
  context?: string;
}

async function post(path: string, body: unknown, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Store a memory. Uses async:true so the server returns immediately (~20ms) and
 * runs LLM extraction in the background — this is the key fix vs the old plugin,
 * which blocked the turn until extraction finished.
 */
export async function retain(bankId: string, content: string, context?: string): Promise<void> {
  if (!content.trim()) return;
  const res = await post(
    `/v1/default/banks/${encodeURIComponent(bankId)}/memories`,
    { items: [{ content, context }], async: true },
    10_000,
  );
  if (!res.ok) throw new Error(`retain ${res.status}`);
}

/** Semantic recall, bounded by timeout so a slow server never stalls a prompt. */
export async function recall(
  bankId: string,
  query: string,
  opts: { budget?: "low" | "mid" | "high"; maxTokens?: number; timeoutMs?: number } = {},
): Promise<RecallResult[]> {
  if (!query.trim()) return [];
  const res = await post(
    `/v1/default/banks/${encodeURIComponent(bankId)}/memories/recall`,
    { query, budget: opts.budget ?? "low", max_tokens: opts.maxTokens ?? 2048 },
    opts.timeoutMs ?? 2500,
  );
  if (!res.ok) throw new Error(`recall ${res.status}`);
  const data = (await res.json()) as { results?: RecallResult[] };
  return data.results ?? [];
}

/** Contextual reflection over the bank's memories. */
export async function reflect(
  bankId: string,
  query: string,
  opts: { budget?: "low" | "mid" | "high"; context?: string; maxTokens?: number } = {},
): Promise<string> {
  const res = await post(
    `/v1/default/banks/${encodeURIComponent(bankId)}/reflect`,
    {
      query,
      budget: opts.budget ?? "low",
      context: opts.context,
      max_tokens: opts.maxTokens,
    },
    60_000,
  );
  if (!res.ok) throw new Error(`reflect ${res.status}`);
  const data = (await res.json()) as { answer?: string; text?: string };
  return data.answer ?? data.text ?? JSON.stringify(data);
}

export async function health(timeoutMs = 2000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${BASE_URL}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export { BASE_URL };
