# Workflow examples

[中文](../zh/examples.md)

These examples emphasize correct event filtering, checkout refs, and token handling. Replace `Mieluoxxx/pi-action@v1` with a commit SHA if your supply-chain policy requires immutable action references.

## Read-only comment assistant

This runs only when a newly created issue or PR comment contains `@pi-agent`. It is the recommended starting point.

```yaml
name: Pi Assistant

on:
  issue_comment:
    types: [created]

jobs:
  ask-pi:
    if: contains(github.event.comment.body, '@pi-agent')
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.issue.pull_request && format('refs/pull/{0}/head', github.event.issue.number) || github.event.repository.default_branch }}
          fetch-depth: 0
          persist-credentials: false

      - uses: Mieluoxxx/pi-action@v1
        with:
          api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          timeout: '600'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Repository collaborators can now comment:

```text
@pi-agent explain why this test is flaky and suggest a fix
```

For reproducible production runs, set `pi_version` to a version or semver range that you have tested.

## Automatic read-only PR review

`direct_prompt` enables direct triggering. The action runs on each configured PR action without requiring a comment.

```yaml
name: Pi Review

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: Mieluoxxx/pi-action@v1
        with:
          api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          direct_prompt: |
            Review this PR for correctness, security, and regressions.
            Lead with a verdict, then list actionable findings with file:line references.
          thinking: high
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Direct triggers are not author-association gated. Add a job-level `if:` if reviews should run only for selected authors or branch sources.

## Comment-triggered write mode

This example accepts write tasks only on PR comments. The checkout uses the PR head ref so the resulting commit can be pushed back to the same-repository branch.

```yaml
name: Pi Changes

on:
  issue_comment:
    types: [created]

jobs:
  change:
    if: github.event.issue.pull_request && contains(github.event.comment.body, '@pi-agent')
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          ref: refs/pull/${{ github.event.issue.number }}/head
          fetch-depth: 0
          persist-credentials: false

      - uses: Mieluoxxx/pi-action@v1
        with:
          api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          write_mode: 'true'
          trigger_phrase: '@pi-agent'
          allowed_users: 'trusted-contributor'
          thinking: high
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`allowed_users` adds users who do not already have repository write association. Owners, members, and collaborators remain authorized. Automatic push is intended for same-repository PR branches; keep fork PRs read-only.

## Automatic fixes on same-repository PRs

For direct write mode, explicitly reject fork PRs and check out the head commit rather than GitHub's synthetic merge ref.

```yaml
name: Pi Autofix

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  autofix:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
          persist-credentials: false

      - uses: Mieluoxxx/pi-action@v1
        with:
          api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          write_mode: 'true'
          direct_prompt: |
            Run the existing tests, fix narrowly scoped failures caused by this PR,
            and explain every change in the final response.
          exclude_tools: 'write'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

This excludes the whole-file `write` tool while keeping `edit` and `bash` available.

## Custom endpoint

```yaml
- uses: Mieluoxxx/pi-action@v1
  with:
    base_url: https://gateway.example.com/v1
    api: openai-responses
    model: company-model
    api_key: ${{ secrets.COMPANY_MODEL_KEY }}
    thinking: medium
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The action writes a `custom` provider entry to `~/.pi/agent/models.json`. In write mode, the custom provider key is available to Pi's shell environment, so do not enable `bash` for untrusted tasks.

## Allowing a contributor to trigger read-only analysis

```yaml
with:
  api_key: ${{ secrets.ANTHROPIC_API_KEY }}
  allowed_users: 'alice,bob'
```

This is useful for contributors without repository write association. It does not restrict owners, members, or collaborators.

## Consuming outputs

Assign an `id` to the action step and use its outputs in later steps:

```yaml
- id: pi
  uses: Mieluoxxx/pi-action@v1
  with:
    api_key: ${{ secrets.ANTHROPIC_API_KEY }}
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

- name: Record whether Pi ran
  if: always()
  run: |
    echo "triggered=${{ steps.pi.outputs.triggered }}"
    echo "response-length=${#PI_RESPONSE}"
  env:
    PI_RESPONSE: ${{ steps.pi.outputs.response }}
```

`triggered` is the string `true` or `false`. `response` contains at most 60,000 characters. The action attempts to post the full Pi response as a comment, so GitHub's comment-size limit still applies.
