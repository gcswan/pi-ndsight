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

## 1.3.0

- Pin the Hindsight server image to `0.7.2` (was `0.1.16`), via a single
  `DEFAULT_IMAGE` constant in `config.ts`. Override with `HINDSIGHT_IMAGE`.
- Give the server container `--shm-size=2g` (compose `shm_size: 2gb` and the
  docker-run fallback). The embedded Postgres builds a `to_tsvector` GENERATED
  column during migrations, which needs >500MB of shared memory; Docker's
  default 64MB `/dev/shm` causes `DiskFull` crashes on first start and on
  upgrades over a non-trivial data set.

## 1.2.1

- Drop the misleading `Container:` line from `/pindsight-status`. It filtered on
  a container literally named `pindsight` and reported "not running" whenever the
  server was served by a differently-named container (e.g. `hindsight-cc`), even
  though `Server: healthy` already reflects reality. Removed the unused probe and
  `CONTAINER` import from the status command.

## 1.2.0

- Default provider/model is now Groq `openai/gpt-oss-20b` (fast, the proven
  hindsight-cc default). Groq is the wizard's top/recommended choice.
- Pass through `HINDSIGHT_API_LLM_GROQ_SERVICE_TIER` for Groq free-tier users.
- Fix: pressing Enter in the wizard now accepts the default model instead of
  erroring with "model required".
