# Usage & cost tracking

sur9e logs every token it spends — input/output/cache counts plus estimated
USD — to `data/usage.json`, bucketed **by provider, model, and sur9e mode**, and
surfaces it in the Analytics view ("Cost transparency" in the README). This doc
explains the two spend paths and how to enable per-agent interactive tracking.

## Two spend paths

sur9e runs your AI agent in two different ways, and each is metered separately:

| Path                  | What runs                                                                               | How spend is captured                                                                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Headless workers**  | `scan` / `screen` / `evaluate` jobs the web app spawns in the background                | The provider adapters in `src/lib/server/providers/` parse each run's token telemetry (Claude/Codex emit real counts; OpenCode is estimated via tiktoken — `estimated: true`) and call `trackProvider()`. Cost resolves from the OpenRouter pricing cache. |
| **Interactive agent** | You typing `/sur9e <mode>` directly in your coding agent (Claude Code, Codex, OpenCode) | A per-agent **end-of-turn hook** attributes that turn's tokens to the active mode and calls `trackProvider()` / `trackClaude()`. This spend runs through your agent subscription — OpenRouter never sees it — so without the hook it would be invisible.   |

Both paths write to the same sink: [`cli/usage-tracker.mjs`](../cli/usage-tracker.mjs).

## Interactive hooks (one per agent)

All three hooks share the mode-detection logic in
[`cli/lib/mode-detect.mjs`](../cli/lib/mode-detect.mjs) — one source of truth for
the mode list and aliases, so the agents can't drift. A turn is attributed to a
`/sur9e <mode>` invocation, or to the literal label `session` when no mode is
active. Orchestration modes alias to the bucket that actually spends
(`evaluate-offer → evaluate`; `scan` / `batch` / `process-queue → screen`); the
pre-rename names `auto-pipeline` and `pipeline` alias to the same buckets so
historical usage data keeps resolving. `discovery` isn't tracked.

Every hook honors the bypass env var **`SUR9E_SKIP_USAGE_HOOK=1`** (Claude's
also respects `CLAUDE_SKIP_HOOK=1`).

| Agent           | Hook file                                                                                        | How it learns the cost                                                                                                                                                                               | Enable                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Claude Code** | [`.claude/hooks/track-mode-usage.mjs`](../.claude/hooks/track-mode-usage.mjs) (a `Stop` hook)    | Reads the per-message `usage` from the Claude Code transcript                                                                                                                                        | Wired via the `Stop` hook entry in `.claude/settings.json` — present in the repo's Claude config; nothing to install. |
| **OpenCode**    | [`.opencode/plugins/sur9e-track-usage.js`](../.opencode/plugins/sur9e-track-usage.js) (a plugin) | Reads exact `tokens` + `cost` + `modelID` off the completed `AssistantMessage` (`message.updated` event)                                                                                             | **Auto-loads** — OpenCode loads any file in `.opencode/plugins/` at startup. No `opencode.json` entry needed.         |
| **Codex**       | [`.codex/hooks/sur9e-track-usage.mjs`](../.codex/hooks/sur9e-track-usage.mjs) (a `Stop` hook)    | The Stop payload carries no usage, so the hook reads the session **rollout file** (`~/.codex/sessions/.../rollout-*.jsonl`) and computes the per-turn delta from the cumulative `token_count` events | Run **`node .codex/install-hook.mjs`** once — it registers the hook in your **user-level** `~/.codex/config.toml`.    |

### Why Codex needs an installer (and the caveats)

- **User-level only.** Codex ignores `hooks` in a repo-local `.codex/config.toml`
  for interactive sessions ([openai/codex#17532](https://github.com/openai/codex/issues/17532)),
  so `install-hook.mjs` writes into `~/.codex/config.toml`. It's idempotent and
  preserves your existing config.
- **`--ephemeral` breaks it.** Ephemeral sessions write no rollout file, and the
  per-turn numbers come from the rollout — there's nothing to read.
- **Unknown models cost 0.** Codex spend is priced from
  `PRICING_BY_PROVIDER.codex` in `cli/usage-tracker.mjs`; a model with no rate
  there records tokens with `cost_usd: 0` (sur9e never fabricates a price). Add
  new Codex model rates there when they ship.

### Coverage asymmetry

Claude Code has both paths (headless **and** interactive). Codex and OpenCode are
fully covered for **headless job** spend via the provider adapters; their
**interactive** spend is covered by the hooks above once enabled. OpenCode reports
exact per-turn cost; Codex reconstructs it from the rollout.

## State & data files (gitignored)

- `data/usage.json` — the cost ledger (the Analytics view reads this).
- `data/usage-mode-state.json` — Claude hook's per-session watermark + active mode.
- `data/usage-mode-opencode-state.json` — OpenCode plugin's per-session counted-message watermark + active mode.
- `data/usage-mode-codex-state.json` — Codex hook's per-session previous cumulative total + active mode.

These live under `data/` and are never committed.
