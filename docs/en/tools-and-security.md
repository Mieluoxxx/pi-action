# Tools, permissions, and security

[中文](../zh/tools-and-security.md)

pi-action treats tools, workflow permissions, credentials, and trigger policy as separate layers. No single layer should be considered a sandbox.

## Pi tool policy

The action always passes an explicit `--tools` allowlist to Pi.

| Mode | Available tools |
|---|---|
| Default (`write_mode: false`) | `read`, `grep`, `find`, `ls` |
| Write mode (`write_mode: true`) | `read`, `grep`, `find`, `ls`, `edit`, `write`, `bash` |

`exclude_tools` removes names from the selected list. For example:

```yaml
with:
  write_mode: 'true'
  exclude_tools: 'bash,write'
```

This leaves `read`, `grep`, `find`, `ls`, and `edit` available.

The prompt also describes the active mode, but the CLI allowlist is the enforcement mechanism. `extra_args` is trusted workflow configuration and is appended after the managed arguments; review it carefully because arbitrary Pi flags may change behavior.

## What write mode means

Write mode has two effects:

1. Pi receives `edit`, `write`, and `bash` unless excluded.
2. After Pi exits, the action stages all working-tree changes and attempts to commit and push them to the PR head branch.

The action checks Git directly, so changes created through `bash` are included even when Pi does not emit an `edit` or `write` event. Because `git add -A` is used, unrelated changes already present in the checkout are also included. Run pi-action against a clean working tree.

Issue-only runs can edit the temporary runner workspace, but there is no PR branch to push. Those changes disappear with the runner.

## Trigger authorization

Comment triggers require all of the following:

- the event action is `created`;
- the comment contains `trigger_phrase`;
- the actor is not `pi-action` or a `*[bot]` account;
- the commenter is `OWNER`, `MEMBER`, or `COLLABORATOR`, or is listed in `allowed_users`.

`allowed_users` expands access for users without repository write association. It is not an exclusive allow-list.

Direct triggers use `direct_prompt` and the event-action filter, but do not apply author-association checks. Restrict direct workflows with a job-level `if:` when the event author is not automatically trusted.

## GitHub token boundary

The Pi child process does not inherit:

- `GITHUB_TOKEN`;
- `GH_TOKEN`;
- environment variables beginning with `INPUT_`.

The parent action uses the GitHub token for API comments and, in write mode, the final Git push.

This filtering is not sufficient if checkout credentials remain in `.git/config`. Always use:

```yaml
- uses: actions/checkout@v4
  with:
    persist-credentials: false
```

It is especially important in write mode because `bash` can invoke Git and inspect the runner environment.

Other workflow environment variables are inherited by Pi. Do not place unrelated secrets in the job environment. For custom providers, `PI_API_KEY` must remain available to the Pi process, which means it is also visible to commands executed by Pi's shell tool. Only enable `bash` for trusted tasks and inputs.

GitHub does not pass ordinary repository secrets to `pull_request` workflows opened from forks. Do not work around this by checking out untrusted fork code under `pull_request_target` with write credentials. Keep fork analysis read-only and use an explicitly reviewed architecture if provider access is required.

## GitHub permissions

Use the smallest job permissions that support the intended behavior.

| Capability | Suggested permission |
|---|---|
| Read repository contents | `contents: read` |
| Push same-repository PR changes | `contents: write` |
| Comment on issues | `issues: write` |
| Comment on pull requests | `pull-requests: write` |

The default `GITHUB_TOKEN` does not trigger most downstream workflows from its own pushes. Use a narrowly scoped GitHub App token if downstream automation is required.

## Checkout and branch safety

Read-only analysis may use the normal checkout ref. Write mode must check out the PR head commit or head ref, not the synthetic merge ref and not the repository default branch.

For `pull_request` workflows:

```yaml
with:
  ref: ${{ github.event.pull_request.head.sha }}
  fetch-depth: 0
  persist-credentials: false
```

For `issue_comment` workflows on a PR:

```yaml
with:
  ref: refs/pull/${{ github.event.issue.number }}/head
  fetch-depth: 0
  persist-credentials: false
```

Automatic write-back currently assumes the PR branch belongs to the same repository. Fork PRs should remain read-only unless a separate, explicitly reviewed fork-push mechanism is added.

## Untrusted model input

The following content is inserted into the model context and must be considered untrusted:

- issue and PR titles and bodies;
- comments after the trigger phrase;
- PR diffs;
- repository files read by Pi.

An attacker may place instructions in any of these locations. Read-only tools substantially limit the impact, but they do not prevent model-token abuse or disclosure of readable repository content. Write mode should be reserved for trusted repositories, users, and branches.

## Timeouts and process isolation

`timeout` limits the direct Pi process. A positive timeout sends `SIGTERM`, followed by `SIGKILL` after five seconds. `0` disables the action-level timeout.

This is not a full process-tree or container boundary. Shell commands may create child processes that outlive the direct Pi process. Configure a GitHub job-level `timeout-minutes` as an outer limit.

## Self-hosted runners

On a self-hosted runner:

- an existing `pi` executable is reused;
- a custom provider file is written under the runner user's home directory;
- global npm installation may persist between jobs;
- workspace and process state may survive longer than on hosted runners.

Pin `pi_version`, isolate the runner account, clean workspaces between jobs, and review persisted `~/.pi/agent/models.json` configuration.

## Recommended checklist

- Keep `write_mode: false` unless edits are required.
- Set `persist-credentials: false` on checkout.
- Use minimal `permissions:`.
- Pin `pi_version` in production.
- Do not expose unrelated secrets through job-level `env`.
- Restrict direct triggers with workflow `if:` expressions where necessary.
- Limit write mode to same-repository PRs and trusted commenters.
- Use both action and job timeouts.
