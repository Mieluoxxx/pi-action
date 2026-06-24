# pi-action

A GitHub Action that runs the [Pi coding agent](https://github.com/earendil-works/pi) on GitHub issues and pull requests. Trigger it with an `@pi-agent` comment, or run it automatically on PR/issue open events. Works with any LLM provider Pi supports (Anthropic, OpenAI, Google, or any compatible endpoint).

## Features

- **`@pi-agent` comment trigger** — invoke the agent in any issue or PR thread
- **Direct trigger** — run automatically on `pull_request` / `issues` open events
- **Read-only by default** — Pi gets `read`/`grep`/`find`/`ls` only; opt into `write_mode` for edits + pushes
- **Any provider** — Anthropic, OpenAI, Google, or any OpenAI/Anthropic-compatible endpoint
- **JSONL event parsing** — consumes Pi's `--mode json` stream for the final answer, tool calls, and written files
- **Auto-commit** — in write mode, file edits are committed and pushed to the PR branch

## Prerequisites

In the repo that will use pi-action:

1. **Add an API key as a repository secret.**
   Settings → Secrets and variables → Actions → New repository secret.
   For Anthropic, name it `ANTHROPIC_API_KEY` and paste your key.
2. **`GITHUB_TOKEN` is auto-injected** by GitHub Actions — you don't create it. You just declare what permissions it gets via the workflow's `permissions:` block.
3. **That's it.** No fork, no install. `uses:` pulls the action.

## Quick start (Anthropic)

Drop this into `.github/workflows/pi-agent.yml`:

```yaml
name: Pi Agent
on:
  issue_comment:
    types: [created]
  pull_request:
    types: [opened]
  issues:
    types: [opened]

jobs:
  pi:
    runs-on: ubuntu-latest
    permissions:
      contents: write       # lower to `read` if you never enable write_mode
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: Mieluoxxx/pi-action@v1
        with:
          api_key: ${{ secrets.ANTHROPIC_API_KEY }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Commit, then comment `@pi-agent explain the caching logic` on any PR or issue.

## Other providers

**OpenAI:**
```yaml
- uses: Mieluoxxx/pi-action@v1
  with:
    provider: openai
    model: openai/gpt-4o
    api_key: ${{ secrets.OPENAI_API_KEY }}
```

**Google Gemini:**
```yaml
- uses: Mieluoxxx/pi-action@v1
  with:
    provider: google
    model: gemini-2.5-pro
    api_key: ${{ secrets.GEMINI_API_KEY }}
```

**Custom / self-hosted endpoint** (OpenRouter, DeepSeek, Azure, corporate proxy, ...):
```yaml
- uses: Mieluoxxx/pi-action@v1
  with:
    base_url: 'https://your-endpoint/v1'
    api: openai-responses          # or anthropic-messages / openai-completions / google-generative-ai
    model: 'your-model-id'         # required when base_url is set
    api_key: ${{ secrets.MY_ENDPOINT_KEY }}
```
When `base_url` is set, pi-action writes a `custom` provider into `~/.pi/agent/models.json` pointing at that URL; the `provider` input is ignored.

## Trigger modes

| Mode | When it runs | Config |
|---|---|---|
| **Comment trigger** | someone comments `@pi-agent <task>` | default (`trigger_phrase: '@pi-agent'`) |
| **Direct trigger** | auto-run on PR/issue open | `direct_prompt: '<what pi should do>'` |
| **Both** | comment + auto on open | set `direct_prompt`, leave `trigger_phrase` default |

Leave `direct_prompt` empty to require an explicit comment.

## Write mode & permissions

Default is **read-only**: Pi only gets `read`, `grep`, `find`, `ls`. To let it edit files and push commits:

```yaml
- uses: Mieluoxxx/pi-action@v1
  with:
    api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    write_mode: 'true'
```

`write_mode: true` adds `edit`/`write`/`bash` to the tool set; the action commits and pushes file changes to the PR branch.

**Permissions cheat sheet** — declare in the job's `permissions:` block:

| Want | Permission |
|---|---|
| Comment on PR/issue | `pull-requests: write`, `issues: write` |
| Pi reads code only | `contents: read` |
| Pi edits + pushes | `contents: write` |
| Trigger downstream workflows from pi's commits | GitHub App token (default `GITHUB_TOKEN` won't trigger `pull_request`/`push` events) |

**⚠️ Public repos:** with `write_mode: true` and no `allowed_users`, anyone can comment `@pi-agent` and run shell on your runner. Keep `write_mode: false` for untrusted input, or set `allowed_users: 'alice,bob'`.

## Inputs

| Input | Default | Description |
|---|---|---|
| `pi_version` | `latest` | `@earendil-works/pi-coding-agent` version |
| `provider` | `anthropic` | LLM provider. Ignored when `base_url` is set (forces `custom`). |
| `model` | _provider default_ | e.g. `sonnet:high`, `openai/gpt-4o`, `gemini-2.5-pro`. Required when `base_url` is set. |
| `base_url` | `''` | Custom endpoint URL. When set, registers a `custom` provider. |
| `api` | `anthropic-messages` | Protocol for custom endpoint: `anthropic-messages` / `openai-completions` / `openai-responses` / `google-generative-ai` |
| `api_key` | _(required)_ | Provider API key |
| `trigger_phrase` | `@pi-agent` | Comment phrase that triggers the agent |
| `direct_prompt` | `''` | Prompt for direct events (PR/issue open). Empty disables direct trigger |
| `write_mode` | `false` | Grants `edit`/`write`/`bash` and pushes commits |
| `thinking` | `medium` | `off` / `minimal` / `low` / `medium` / `high` / `xhigh` |
| `system_prompt` | `''` | Replace the default system prompt |
| `append_system_prompt` | `''` | Append to the system prompt |
| `exclude_tools` | `''` | Comma-separated tools to disable on top of the write_mode policy |
| `extra_args` | `''` | Extra raw args forwarded to `pi` |
| `install_args` | `''` | Extra npm flags when installing Pi |
| `timeout` | `600` | Hard timeout in seconds per pi run. `0` = no timeout |
| `allowed_users` | `''` | Comma-separated usernames allowed to trigger without write permission |
| `bot_id` | `''` | GitHub App ID for the commit author email |
| `bot_name` | `pi-action[bot]` | Bot username for commits |

## Outputs

| Output | Description |
|---|---|
| `triggered` | `"true"` if the agent ran |
| `response` | Final assistant text (truncated to 60k chars) |

## Security

Pi has **no built-in permission system** — it inherits whatever the runner process can do. This action enforces safety in layers:

1. **Tool allowlist** — read-only by default (`read,grep,find,ls`). `write_mode` gates `edit/write/bash`.
2. **Permission gating** — only `OWNER`/`MEMBER`/`COLLABORATOR` associations (or users in `allowed_users`) can trigger; others are denied.
3. **Self-trigger guard** — comments by `pi-action` and `*[bot]` accounts are ignored to prevent loops.
4. **Token masking** — `GITHUB_TOKEN` is stripped from Pi's environment so a rogue `git push` can't authenticate. The action itself handles pushes via `git` at a layer Pi can't reach.

For untrusted PRs: keep `write_mode: false`, tighten the workflow's `permissions:`, and use `allowed_users`.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test (40 unit tests)
npm run build       # ncc bundle to dist/index.js
```

## Contributing

Contributions are welcome — bug fixes, new providers, docs, and tests are all fair game.

### Workflow

1. **Fork & clone** the repo, then `npm install` (requires Node `>= 20`).
2. **Branch off `main`** — `feat/<topic>`, `fix/<issue>`, or `docs/<topic>`.
3. **Make your change** under `src/` (TypeScript) and/or `test/`. Keep the diff focused; one logical change per PR.
4. **Run the full quality gate locally** — all four must be green before you push:
   ```bash
   npm run typecheck   # tsc --noEmit
   npm test            # node --test
   npm run check       # biome lint + format
   npm run build       # ncc bundle to dist/
   ```
5. **Commit** with an imperative subject (`Add X`, `Fix Y`). Reference issues as `Closes #123` when relevant.
6. **Open a PR against `main`** — describe the change, rationale, and any manual verification you did.

### Guidelines

- **Cover behavioral changes with tests** in `test/*.test.ts` (`node --test` + `tsx`).
- **Don't commit `dist/`** in PRs — it's rebuilt at release time via the `prepack` hook.
- **Keep the default read-only** — any new tool exposure must stay gated behind `write_mode`.
- **Update docs alongside behavior** — the `Inputs`/`Outputs` tables, `action.yml`, and this README must agree.
- **Never log secrets** — redact API keys and tokens in issues, PRs, and sample logs.

### Reporting bugs

Open an issue with: Pi version (`pi_version`), provider + model, the workflow YAML with secrets redacted, and the action's log output. The more reproducible, the faster the fix.

## License

MIT
