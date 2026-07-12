# 工作流示例

[English](../en/examples.md)

以下示例重点展示正确的事件过滤、Checkout Ref 和 Token 处理方式。如果供应链策略要求 Action 引用不可变，请将 `Mieluoxxx/pi-action@v1` 替换为具体 Commit SHA。

## 只读评论助手

仅当新建的 Issue 或 PR 评论包含 `@pi-agent` 时运行。这是推荐的起点。

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

仓库协作者现在可以评论：

```text
@pi-agent 解释这个测试为什么不稳定，并建议如何修复
```

为了让生产运行可复现，应将 `pi_version` 设置为经过验证的版本或 SemVer 范围。

## 自动只读 PR Review

`direct_prompt` 会启用直接触发，无需评论即可在配置的 PR 动作发生时运行。

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

直接触发不会检查作者关联身份。如果只希望为指定作者或分支来源运行 Review，应增加 Job 级 `if:`。

## 评论触发写模式

该示例只接受 PR 评论中的写入任务。Checkout 使用 PR Head Ref，使最终提交可以推送回同仓库分支。

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

`allowed_users` 为原本没有仓库写入关联身份的用户增加权限。Owner、Member 和 Collaborator 仍然具有触发权限。自动推送面向同仓库 PR 分支，Fork PR 应保持只读。

## 对同仓库 PR 自动修复

直接启用写模式时，应显式拒绝 Fork PR，并检出 Head 提交，而不是 GitHub 生成的合并引用。

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

该配置排除了整文件 `write` 工具，但保留 `edit` 和 `bash`。

## 自定义端点

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

Action 会向 `~/.pi/agent/models.json` 写入 `custom` 提供商配置。写模式下，自定义提供商密钥会存在于 Pi 的 Shell 环境中，因此不要为不可信任务启用 `bash`。

## 允许贡献者触发只读分析

```yaml
with:
  api_key: ${{ secrets.ANTHROPIC_API_KEY }}
  allowed_users: 'alice,bob'
```

这适用于没有仓库写入关联身份的贡献者，但不会限制 Owner、Member 或 Collaborator。

## 使用 Action 输出

为 Action 步骤设置 `id`，即可在后续步骤中读取输出：

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

`triggered` 是字符串 `true` 或 `false`。`response` 最多包含 60,000 个字符。Action 会尝试将 Pi 的完整响应发布为评论，因此仍受 GitHub 评论大小限制。
