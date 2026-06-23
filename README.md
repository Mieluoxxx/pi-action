# pi-action

A GitHub Action that runs the [Pi coding agent](https://github.com/earendil-works/pi) on issues and pull requests. Trigger it with an `@pi-agent` comment, or automatically on PR/issue open events — the same model as `claude-code-action`, powered by Pi.

## Features

- **`@pi-agent` comment trigger** — invoke the agent in any issue or PR thread
- **Direct trigger** — run automatically on `pull_request` / `issues` open events
- **Read-only by default** — Pi gets `read`/`grep`/`find`/`ls` only; opt into `write_mode` for edits + pushes
- **JSONL event parsing** — consumes Pi's `--mode json` stream for the final answer, tool calls, and written files
- **Auto-commit** — in write mode, file edits are committed and pushed to the PR branch
- **Any provider** — Anthropic, OpenAI, Google, ... (whatever Pi supports)

## Quick start

Drop this into `.github/workflows/pi.yml`:

```yaml
name: Pi
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
          trigger_phrase: '@pi-agent'
          direct_prompt: 'Review this change for correctness, security, and readability.'
          write_mode: 'false'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Then comment `@pi-agent explain the caching logic` on any PR.

## Inputs

| Input | Default | Description |
|---|---|---|
| `pi_version` | `latest` | `@earendil-works/pi-coding-agent` version |
| `provider` | `anthropic` | LLM provider |
| `model` | _provider default_ | e.g. `sonnet:high`, `openai/gpt-4o` |
| `api_key` | _(required)_ | Provider API key, passed via `--api-key` |
| `trigger_phrase` | `@pi-agent` | Comment phrase that triggers the agent |
| `direct_prompt` | `''` | Prompt for direct events (PR/issue open). Empty disables direct trigger |
| `write_mode` | `false` | When true, grants `edit`/`write`/`bash` and pushes commits |
| `thinking` | `medium` | `off` / `minimal` / `low` / `medium` / `high` / `xhigh` |
| `system_prompt` | `''` | Replace the default system prompt |
| `append_system_prompt` | `''` | Append to the system prompt |
| `exclude_tools` | `''` | Comma-separated tools to disable on top of the write_mode policy |
| `extra_args` | `''` | Extra raw args forwarded to `pi` |
| `install_args` | `''` | Extra npm flags when installing Pi |

## Outputs

| Output | Description |
|---|---|
| `triggered` | `"true"` if the agent ran |
| `response` | Final assistant text (truncated to 60k chars) |

## Security

Pi has **no built-in permission system** — it inherits whatever the runner process can do. This action enforces safety in two layers:

1. **Tool allowlist** — in the default read-only mode Pi only gets `read,grep,find,ls`. `write_mode` is required to enable `edit/write/bash`.
2. **Self-trigger guard** — comments by `pi-action` and `*[bot]` accounts are ignored to prevent loops.

For untrusted PRs, keep `write_mode: false` and tighten the workflow's `permissions:` block. The `GITHUB_TOKEN` is masked before being handed to git.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test (35 unit tests)
npm run build       # ncc bundle to dist/index.js
```

## License

MIT
