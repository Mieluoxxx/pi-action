# Repository Skills configuration

[中文](../zh/skills.md)

This guide explains how a repository can provide Pi Skills to pi-action. Skills are version-controlled instruction packages that Pi discovers from the checked-out repository and loads when a task matches.

pi-action already supports Pi's project-local Skill discovery. It runs Pi from the repository workspace with project approval enabled, so no extra Action input is required for the standard directories.

## Recommended repository layout

Use one directory per Skill with a required `SKILL.md` file:

```text
your-repository/
├── .pi/
│   └── skills/
│       ├── pr-review/
│       │   ├── SKILL.md
│       │   └── references/
│       │       └── review-checklist.md
│       └── test-debugging/
│           ├── SKILL.md
│           └── scripts/
│               └── collect-diagnostics.sh
├── src/
└── package.json
```

The portable alternative is `.agents/skills/`:

```text
.agents/skills/pr-review/SKILL.md
```

Pi discovers:

- `.pi/skills/` in the current working directory;
- `.agents/skills/` in the current directory and its ancestors up to the Git repository root;
- directories containing `SKILL.md`, recursively.

Direct root Markdown files are also discovered under `.pi/skills/`, but not under `.agents/skills/`. A directory containing `SKILL.md` is recommended because it works consistently and can carry scripts, references, and assets.

Choose one project convention and use it consistently. `.agents/skills/` is useful when several Agent Skills-compatible tools share the same repository resources; `.pi/skills/` makes the Pi-specific ownership explicit.

## Minimal SKILL.md

```markdown
---
name: pr-review
description: Reviews pull requests for correctness, security, regressions, and missing tests. Use for PR review and change-risk analysis.
---

# Pull request review

## Procedure

1. Read the PR description and diff.
2. Inspect the affected implementation and tests.
3. Prioritize correctness and security findings.
4. Report actionable findings with file and line references.
5. If no blocking issue exists, state that explicitly.

## Output

Lead with the verdict, then list findings from highest to lowest severity.
```

Required frontmatter:

| Field | Requirement |
|---|---|
| `name` | 1–64 characters; lowercase letters, digits, and hyphens |
| `description` | Explain what the Skill does and when Pi should use it |

The description is especially important because Pi places Skill names and descriptions in the system prompt and loads the full instructions only when needed.

## Workflow configuration

No Skill-specific input is needed when the Skill is committed under `.pi/skills/` or `.agents/skills/`.

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
          pi_version: '<tested-version>'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Replace `<tested-version>` with an available Pi version or SemVer range. Skill behavior depends on the installed Pi version, so production workflows should not rely on `latest` without validation.

## Invoking a Skill

Pi can select a Skill automatically from its description:

```text
@pi-agent review this pull request for security and regressions
```

To force a specific Skill, place `/skill:<name>` at the start of the task after the trigger phrase:

```text
@pi-agent /skill:pr-review focus on concurrency and cleanup behavior
```

Arguments after the Skill command are appended to the loaded Skill instructions.

For direct triggers, the same syntax can be used in `direct_prompt`:

```yaml
with:
  direct_prompt: '/skill:pr-review focus on correctness and security'
```

## Multiple Skills

A repository can contain several small, focused Skills:

```text
.pi/skills/
├── pr-review/SKILL.md
├── test-debugging/SKILL.md
├── release-notes/SKILL.md
└── dependency-audit/SKILL.md
```

Prefer focused Skills over a single large repository handbook. Put shared background material in reference files and link to them from `SKILL.md`:

```markdown
Read [the architecture guide](references/architecture.md) only when the task changes service boundaries.
```

Referenced paths are resolved relative to the Skill directory.

## Skills with scripts

A Skill may include helper scripts:

```text
.pi/skills/test-debugging/
├── SKILL.md
└── scripts/
    └── collect-diagnostics.sh
```

```markdown
Run `scripts/collect-diagnostics.sh` before investigating intermittent test failures.
```

The active pi-action tool policy still applies:

| pi-action mode | What the Skill can do |
|---|---|
| `write_mode: false` | Read files and search with `read`, `grep`, `find`, and `ls` |
| `write_mode: true` | Also edit, write, and execute commands with `bash` |

A Skill cannot grant itself tools that pi-action excluded. The experimental `allowed-tools` Skill frontmatter also does not override the Action's `--tools` allowlist.

If a Skill requires a script but the workflow is read-only, rewrite the Skill to describe the diagnostic steps using read/search tools, or enable write mode only for trusted events.

## Explicit Skill paths

Pi supports repeatable `--skill <path>` arguments. pi-action does not currently expose a dedicated `skills` input, but trusted workflow configuration can use `extra_args`:

```yaml
with:
  extra_args: '--skill tools/pi-skills/pr-review/SKILL.md'
```

Disable all automatic Skill discovery with:

```yaml
with:
  extra_args: '--no-skills'
```

Explicit `--skill` paths remain additive even when `--no-skills` is set:

```yaml
with:
  extra_args: '--no-skills --skill .pi/skills/pr-review/SKILL.md'
```

`extra_args` is split on whitespace by pi-action, so Skill paths containing spaces are not supported through this escape hatch. Project-local auto-discovery is preferred.

## Security model

Repository Skills are trusted project instructions. A Pull Request may modify `SKILL.md`, scripts, references, or assets before pi-action starts.

Consider the following rules:

- read-only mode limits Skills to inspection tools but does not prevent prompt injection or disclosure of readable repository content;
- write mode allows Skill instructions to edit files and execute shell commands;
- custom-provider credentials are available to the Pi process and therefore to `bash` in write mode;
- `persist-credentials: false` is still required on checkout;
- fork PRs should remain read-only;
- direct triggers need workflow-level author or branch restrictions when the event is not inherently trusted.

For write mode, only load Skills from branches and users you trust to execute repository automation. A Skill change should receive the same review as a workflow or build-script change.

## Global Skills on runners

Pi also discovers Skills from `~/.pi/agent/skills/` and `~/.agents/skills/`.

GitHub-hosted runners are ephemeral, so global Skills must be installed during the job before pi-action runs. Project-local, version-controlled Skills are usually more reproducible.

Self-hosted runners may retain global Skills across jobs. Audit those directories, pin their versions, and treat changes as runner configuration changes.

## Local verification

With a compatible Pi CLI installed, run from the repository root:

```bash
pi --approve --no-session --tools read,grep,find,ls -p "/skill:pr-review review the current changes"
```

For a write-capable Skill in a disposable branch or workspace:

```bash
pi --approve --no-session --tools read,grep,find,ls,edit,write,bash -p "/skill:test-debugging diagnose and fix the failing test"
```

Verify that:

- the Skill is discovered without an unknown-command error;
- referenced files resolve relative to the Skill directory;
- the Skill works with the workflow's tool set;
- it does not depend on undeclared local software or credentials;
- its final response is suitable for a GitHub comment.

## Authoring checklist

- Use a specific `description` that clearly states when the Skill applies.
- Keep `SKILL.md` focused and move large references into separate files.
- Use relative paths for scripts, references, and assets.
- Declare setup and environment assumptions explicitly.
- Design for the minimum required pi-action tool mode.
- Avoid placing secrets or secret values in Skill files.
- Review Skill changes like workflow and executable-script changes.
- Test automatic selection and explicit `/skill:name` invocation.

See the [Pi Skills documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md) for the complete upstream format and discovery rules.
