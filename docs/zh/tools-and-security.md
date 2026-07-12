# 工具、权限与安全

[English](../en/tools-and-security.md)

pi-action 将工具、工作流权限、凭据和触发策略视为相互独立的防护层。任何单独一层都不应被当作沙箱。

## Pi 工具策略

Action 始终通过 `--tools` 向 Pi 传递显式工具白名单。

| 模式 | 可用工具 |
|---|---|
| 默认模式（`write_mode: false`） | `read`、`grep`、`find`、`ls` |
| 写模式（`write_mode: true`） | `read`、`grep`、`find`、`ls`、`edit`、`write`、`bash` |

`exclude_tools` 会从当前模式的工具列表中移除指定名称。例如：

```yaml
with:
  write_mode: 'true'
  exclude_tools: 'bash,write'
```

最终只会保留 `read`、`grep`、`find`、`ls` 和 `edit`。

提示词也会描述当前模式，但真正的强制边界是 CLI 工具白名单。`extra_args` 属于受信任的工作流配置，并追加在托管参数之后；任意 Pi 参数都可能改变行为，因此必须仔细审查。

## 写模式的含义

写模式会产生两个效果：

1. 除非被排除，Pi 会获得 `edit`、`write` 和 `bash`。
2. Pi 退出后，Action 会暂存工作区中的所有修改，并尝试将它们提交和推送到 PR Head 分支。

Action 会直接检查 Git，因此通过 `bash` 创建的修改也会被包含，即使 Pi 没有产生 `edit` 或 `write` 事件。由于使用 `git add -A`，运行前已经存在的无关修改也会被纳入提交。请在干净的工作区中运行 pi-action。

纯 Issue 运行可以修改 Runner 的临时工作区，但由于不存在 PR 分支，修改不会被推送，并会随着 Runner 消失。

## 触发授权

评论触发必须同时满足：

- 事件动作是 `created`；
- 评论包含 `trigger_phrase`；
- 操作者不是 `pi-action` 或 `*[bot]` 账号；
- 评论者是 `OWNER`、`MEMBER`、`COLLABORATOR`，或者位于 `allowed_users` 中。

`allowed_users` 用于为没有仓库写入关联身份的用户增加权限，它不是排他名单。

直接触发使用 `direct_prompt` 和事件动作过滤，但不会检查作者关联身份。如果事件作者并非天然可信，应在 Job 上使用 `if:` 限制直接触发。

## GitHub Token 边界

Pi 子进程不会继承：

- `GITHUB_TOKEN`；
- `GH_TOKEN`；
- 以 `INPUT_` 开头的环境变量。

父级 Action 使用 GitHub Token 发布 API 评论，并在写模式下执行最终 Git 推送。

如果 checkout 凭据仍保存在 `.git/config` 中，仅过滤环境变量并不充分。始终使用：

```yaml
- uses: actions/checkout@v4
  with:
    persist-credentials: false
```

这在写模式下尤其重要，因为 `bash` 可以调用 Git 并检查 Runner 环境。

其他工作流环境变量仍会被 Pi 继承。不要在 Job 环境中放置无关密钥。自定义提供商需要向 Pi 保留 `PI_API_KEY`，这意味着 Pi 的 Shell 工具执行的命令也可以读取它。只有面对可信任务和输入时才启用 `bash`。

GitHub 不会向来自 Fork 的 `pull_request` 工作流传递普通仓库 Secrets。不要通过在 `pull_request_target` 下使用写凭据检出并执行不可信 Fork 代码来绕过限制。Fork 分析应保持只读；如果确实需要模型访问，应采用经过明确安全审查的独立架构。

## GitHub 权限

只授予实现目标所需的最小 Job 权限。

| 能力 | 建议权限 |
|---|---|
| 读取仓库内容 | `contents: read` |
| 向同仓库 PR 推送修改 | `contents: write` |
| 评论 Issue | `issues: write` |
| 评论 Pull Request | `pull-requests: write` |

默认 `GITHUB_TOKEN` 的推送不会触发大多数后续工作流。如果需要触发后续自动化，应使用权限范围尽可能小的 GitHub App Token。

## Checkout 与分支安全

只读分析可以使用默认检出引用。写模式必须检出 PR Head 提交或 Head Ref，不能使用 GitHub 生成的合并引用，也不能使用仓库默认分支。

对于 `pull_request` 工作流：

```yaml
with:
  ref: ${{ github.event.pull_request.head.sha }}
  fetch-depth: 0
  persist-credentials: false
```

对于 PR 上的 `issue_comment` 工作流：

```yaml
with:
  ref: refs/pull/${{ github.event.issue.number }}/head
  fetch-depth: 0
  persist-credentials: false
```

自动写回当前假设 PR 分支属于同一个仓库。在增加独立且经过审查的 Fork 推送机制之前，Fork PR 应保持只读。

## 不可信模型输入

以下内容会进入模型上下文，必须视为不可信：

- Issue 和 PR 的标题与正文；
- 触发词之后的评论内容；
- PR Diff；
- Pi 读取的仓库文件。

攻击者可以在任何位置放置指令。只读工具能显著限制影响，但不能阻止模型额度滥用或可读仓库内容泄露。写模式只应面向可信仓库、用户和分支。

## 超时与进程隔离

`timeout` 限制 Pi 直接进程。正数超时会先发送 `SIGTERM`，五秒后发送 `SIGKILL`；`0` 表示禁用 Action 层超时。

这不是完整的进程树或容器边界。Shell 命令创建的子进程可能比 Pi 直接进程存活更久。应同时配置 GitHub Job 级别的 `timeout-minutes` 作为外层限制。

## 自托管 Runner

在自托管 Runner 上：

- 已存在的 `pi` 可执行文件会被直接复用；
- 自定义提供商文件会写入 Runner 用户的主目录；
- 全局 npm 安装可能在多个 Job 之间持续存在；
- 工作区和进程状态可能比 GitHub 托管 Runner 保存得更久。

应固定 `pi_version`、隔离 Runner 账号、在 Job 之间清理工作区，并审查持久化的 `~/.pi/agent/models.json`。

## 建议检查清单

- 除非确实需要修改，否则保持 `write_mode: false`。
- checkout 时设置 `persist-credentials: false`。
- 使用最小化的 `permissions:`。
- 在生产环境固定 `pi_version`。
- 不要通过 Job 级 `env` 暴露无关 Secrets。
- 必要时用工作流 `if:` 限制直接触发。
- 只允许可信评论者在同仓库 PR 上使用写模式。
- 同时使用 Action 超时和 Job 超时。
