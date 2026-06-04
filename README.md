# hindsight-pi

Persistent, per-project memory for [pi](https://github.com/earendil-works/pi),
backed by a local [Hindsight](https://github.com/vectorize-io/hindsight) server.

A pi port of the `hindsight-cc` Claude Code plugin — rebuilt to be fast.

## Install

```bash
# From your team's git host (recommended — pin a tag)
pi install git:github.com/gcswan/hindsight-pi@v1.0.0

# Try it for one run without installing
pi -e git:github.com/gcswan/hindsight-pi
```

Manage it like any pi package:

```bash
pi list                            # show installed packages
pi update hindsight-pi             # update to a newer pinned ref
pi remove git:github.com/gcswan/hindsight-pi
```

### Share with a whole team (auto-install)

Commit the package into a repo's **project settings** so every coworker who runs
pi in that repo gets it automatically on startup:

`.pi/settings.json`
```json
{
  "packages": [
    "git:github.com/gcswan/hindsight-pi@v1.0.0"
  ]
}
```

Run `pi install -l git:github.com/gcswan/hindsight-pi@v1.0.0` to write that entry
for you, then commit `.pi/settings.json`.

## Prerequisites

Each coworker needs, once:

1. **Docker** running (the Hindsight server runs in a container, auto-started).
2. **LLM credentials** for the server, exported in their shell profile:

   ```bash
   export HINDSIGHT_API_LLM_PROVIDER=openai
   export HINDSIGHT_API_LLM_API_KEY=sk-...
   export HINDSIGHT_API_LLM_MODEL=gpt-5-nano
   ```

   Groq, Gemini, Anthropic, Ollama, and LM Studio also work — set the matching
   `HINDSIGHT_API_LLM_*` variables.

That's it. On the first session the extension creates and starts the
`hindsight-cc` Docker container and stores data in `~/hindsight-data/`.

## What it does

- **Recall on every prompt** — relevant memories from past sessions are injected
  as context before the agent runs (`before_agent_start`).
- **Retain every exchange** — the user/assistant exchange is stored at `agent_end`.
- **Per-project isolation** — bank id derives from the git remote (`owner-repo`)
  or the working directory, so the same repo shares memory across clones/paths.

### Commands

- `/hindsight-search <query>` — semantic search of this project's bank
- `/hindsight-reflect <query>` — LLM reflection over past project context
- `/hindsight-status` — server health, bank id, container status, browse URL

## Why it's faster than the Claude Code version

| Problem (hindsight-cc) | Fix (hindsight-pi) |
| --- | --- |
| `Stop` hook blocked until the server finished LLM extraction (`retain` was synchronous) | `retain` uses `async:true` — server returns in ~20ms, extracts in the background |
| A fresh `python3` venv subprocess was spawned per hook | Direct `fetch()` from pi's long-lived Node process; no subprocess, keep-alive connections |
| Prompt submission blocked on recall with no timeout | Recall is bounded by `HINDSIGHT_RECALL_TIMEOUT_MS`; on timeout the prompt proceeds without memories |

Retains also run through a background queue, so `agent_end` never waits on the network.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HINDSIGHT_API_LLM_API_KEY` | (none) | LLM key passed to the server container |
| `HINDSIGHT_API_LLM_MODEL` | `gpt-5-nano` | Server extraction/recall model |
| `HINDSIGHT_API_LLM_PROVIDER` | `openai` | Server LLM provider |
| `HINDSIGHT_BANK_PREFIX` | `claude-code--` | Bank namespace. Default **shares the same banks as hindsight-cc**. Set to `pi--` to keep pi separate. |
| `HINDSIGHT_BASE_URL` | `http://localhost:8888` | Hindsight server URL |
| `HINDSIGHT_IMAGE` | `ghcr.io/vectorize-io/hindsight:0.1.16` | Docker image |
| `HINDSIGHT_RECALL_TOKENS` | `2048` | Max tokens of injected memories |
| `HINDSIGHT_RECALL_TIMEOUT_MS` | `2500` | Recall budget before the prompt proceeds without memories |
| `HINDSIGHT_DEBUG` | (off) | `1`/`true`/`yes` for stderr debug logging |

## Layout

```
src/hindsight/
  index.ts    event wiring + commands
  client.ts   direct HTTP client (retain / recall / reflect / health)
  bank.ts     git/path -> bank id
  server.ts   Docker auto-start
```

## License

MIT
