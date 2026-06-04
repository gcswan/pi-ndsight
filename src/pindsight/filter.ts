/**
 * Retention filter: decides what, if anything, is worth storing from an
 * exchange. Keeps the memory bank clean by dropping trivial turns that
 * otherwise produce noise like "User issued the command '/cc'", bare commit
 * hashes, and clipboard-path-only prompts.
 */

/** Bare acknowledgements that carry no memory value. */
const ACK = /^(y|yes|n|no|ok|okay|k|sure|thanks|thx|ty|yep|yeah|nope|nvm|go|go ahead|do it|continue|proceed|please|pls|stop|wait|nice|cool|great|perfect)\b[\s.!?]*$/i;

/** A standalone file path token (e.g. pasted clipboard images). */
const PATH_TOKEN = /(^|\s)[/~][\w./@-]+\.\w+(\s|$)/g;

/** Pull plain text out of a message's content (string or content blocks). */
export function messageText(content: unknown): string {
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

/** True when the user's prompt is too trivial to be worth remembering. */
export function isTrivialPrompt(text: string): boolean {
  let t = text.trim();
  if (!t) return true;
  // Strip standalone paths so "/tmp/x.png + a real question" keeps the question.
  t = t.replace(PATH_TOKEN, " ").trim();
  if (!t) return true; // was only a path (e.g. a pasted clipboard image)
  if (ACK.test(t)) return true; // bare "ok" / "yes" / "do it"
  if (/^\/[\w:-]+(\s+\S+){0,4}$/.test(t)) return true; // short slash command, e.g. "/cc and push"
  return false;
}

/** A single line that is pure noise even within a substantive exchange. */
function isNoiseLine(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^[0-9a-f]{7,40}$/i.test(t)) return true; // a bare commit hash
  if (/^[/~][\w./@-]+\.\w+$/.test(t)) return true; // a lone file path
  return false;
}

interface RoleMessage {
  role?: string;
  content?: unknown;
}

/**
 * Build the transcript to retain from this exchange's messages, or return null
 * if the exchange isn't worth storing.
 */
export function buildRetention(messages: RoleMessage[]): string | null {
  const pairs: { role: string; text: string }[] = [];
  for (const msg of messages) {
    const role = msg.role;
    if (role !== "user" && role !== "assistant") continue; // skip tool-result noise
    const text = messageText(msg.content);
    if (text) pairs.push({ role, text });
  }

  const userText = pairs.filter((p) => p.role === "user").map((p) => p.text).join("\n").trim();
  if (!userText || isTrivialPrompt(userText)) return null;

  const lines = pairs.filter((p) => !isNoiseLine(p.text)).map((p) => `${p.role}: ${p.text}`);
  const out = lines.join("\n").trim();
  return out || null;
}
