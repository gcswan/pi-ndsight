# Changelog

## 1.0.0

- Initial release. Fast pi port of the hindsight-cc plugin (renamed pi-ndsight).
- Guided first-run setup wizard: Docker check, provider/model selection, API key.
- Auto-start via bundled docker-compose.yml (docker run fallback).
- Async (non-blocking) retain, direct fetch client, bounded recall, background
  retain queue.
- Commands: /pindsight-setup, /pindsight-search, /pindsight-reflect, /pindsight-status.

## 1.1.0

- Default model is now gpt-5-mini (better extraction quality; chat/completions
  compatible). Wizard shows the default/recommended model.
- Added a lightweight retention filter that drops trivial turns (bare commands,
  acknowledgements, clipboard paths, commit-hash-only replies).

## 1.2.0

- Default provider/model is now Groq `openai/gpt-oss-20b` (fast, the proven
  hindsight-cc default). Groq is the wizard's top/recommended choice.
- Pass through `HINDSIGHT_API_LLM_GROQ_SERVICE_TIER` for Groq free-tier users.
- Fix: pressing Enter in the wizard now accepts the default model instead of
  erroring with "model required".
