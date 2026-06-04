# pi-ndsight

Persistent, per-project memory for [pi](https://github.com/earendil-works/pi),
backed by a local [Hindsight](https://github.com/vectorize-io/hindsight) server.

A fast pi port of the `hindsight-cc` Claude Code plugin, with a guided first-run
setup.

## Install

```bash
# From git (recommended — pin a tag)
pi install git:github.com/gcswan/pi-ndsight@v1.0.0

# Try it for one run without installing
pi -e git:github.com/gcswan/pi-ndsight
```

The **first time you start pi** after installing, a setup wizard walks you
through everything: checking Docker, picking a model provider, choosing a model,
and entering your API key. After that the memory server auto-starts in the
background on every session.

Re-run the wizard anytime with `/pindsight-setup`.

### Share with a whole team (auto-install)

Commit the package into a repo's project settings so every coworker who runs pi
in that repo gets it automatically on startup:

`.pi/settings.json`
```json
{
  "packages": [
    "git:github.com/gcswan/pi-ndsight@v1.0.0"
  ]
}
```

`pi install -l git:github.com/gcswan/pi-ndsight@v1.0.0` writes that entry for you;
commit `.pi/settings.json`. Each coworker still completes the one-time wizard
(or sets `HINDSIGHT_API_LLM_*` env vars) on first run.

## Prerequisite

**Docker** must be installed and running — the Hindsight server runs in a
container that the extension starts for you. Everything else (provider, model,
API key) is handled by the setup wizard.

## What it does

- **Recall on every prompt** — relevant memories from past sessions are injected
  as context before the agent runs.
- **Retain every exchange** — the user/assistant exchange is stored for recall.
- **Per-project isolation** — bank id derives from the git remote (`owner-repo`)
  or the working directory, so the same repo shares memory across clones/paths.
- **Auto-start** — brings the `pindsight` container up in the background via the
  bundled `docker-compose.yml`.

### Commands

- `/pindsight-setup` — run the configuration wizard
- `/pindsight-search <query>` — semantic search of this project's bank
- `/pindsight-reflect <query>` — LLM reflection over past project context
- `/pindsight-status` — config, server health, Docker, bank id, browse URL

## Why it's fast

- `retain` uses `async:true` — server returns in ~20ms, extracts in the background
- Direct `fetch()` from pi's long-lived Node process; no subprocess, keep-alive connections
- Recall is bounded by `HINDSIGHT_RECALL_TIMEOUT_MS`; on timeout the prompt proceeds without memories

Retains also run through a background queue, so the turn never waits on the network.

## Running the server by hand (optional)

The extension manages the container for you, but you can drive it directly:

```bash
HINDSIGHT_API_LLM_API_KEY=sk-... \
HINDSIGHT_DATA_DIR=$HOME/hindsight-data \
docker compose up -d
```

## Configuration

The wizard writes `~/.pi/agent/pindsight/config.json` (mode `0600`). For headless
or CI use you can skip the wizard entirely by setting environment variables,
which the extension reads as a fallback:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HINDSIGHT_API_LLM_PROVIDER` | `openai` | Server LLM provider |
| `HINDSIGHT_API_LLM_MODEL` | `gpt-5-nano` | Server extraction/recall model |
| `HINDSIGHT_API_LLM_API_KEY` | (none) | LLM key |
| `HINDSIGHT_API_LLM_BASE_URL` | (none) | For local providers (Ollama, LM Studio) |
| `HINDSIGHT_BANK_PREFIX` | `claude-code--` | Bank namespace. Default **shares banks with hindsight-cc**. Set to `pi--` to separate. |
| `HINDSIGHT_BASE_URL` | `http://localhost:8888` | Hindsight server URL |
| `HINDSIGHT_IMAGE` | `ghcr.io/vectorize-io/hindsight:0.1.16` | Docker image |
| `HINDSIGHT_DATA_DIR` | `~/hindsight-data` | Memory data volume |
| `HINDSIGHT_RECALL_TOKENS` | `2048` | Max tokens of injected memories |
| `HINDSIGHT_RECALL_TIMEOUT_MS` | `2500` | Recall budget before proceeding without memories |
| `HINDSIGHT_DEBUG` | (off) | `1`/`true`/`yes` for stderr debug logging |

## Layout

```
docker-compose.yml      memory server definition (used by auto-start)
src/pindsight/
  index.ts    event wiring + commands + streamlined startup
  setup.ts    first-run / on-demand configuration wizard
  config.ts   provider catalog + config persistence
  client.ts   direct HTTP client (retain / recall / reflect / health)
  server.ts   Docker auto-start (compose, with docker run fallback)
  bank.ts     git/path -> bank id
```

## License

MIT
