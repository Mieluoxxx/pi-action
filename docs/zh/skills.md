# 仓库级 Skills 配置

[English](../en/skills.md)

本文说明仓库如何为 pi-action 提供 Pi Skills。Skill 是纳入版本控制的指令包，Pi 会从已检出的仓库中发现它，并在任务匹配时按需加载。

pi-action 已经支持 Pi 的项目本地 Skill 自动发现。它从仓库工作区启动 Pi，并启用项目资源信任，因此使用标准目录时不需要额外的 Action 输入。

## 推荐的仓库结构

每个 Skill 使用独立目录，并包含必需的 `SKILL.md`：

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

也可以使用具备跨 Agent 兼容性的 `.agents/skills/`：

```text
.agents/skills/pr-review/SKILL.md
```

Pi 会发现：

- 当前工作目录中的 `.pi/skills/`；
- 当前目录及其祖先目录中的 `.agents/skills/`，向上搜索到 Git 仓库根目录；
- 上述位置中递归存在的所有 `SKILL.md` 目录。

`.pi/skills/` 也会发现直接放在目录根部的 Markdown 文件，`.agents/skills/` 则不会。推荐始终使用包含 `SKILL.md` 的目录，这种形式行为一致，也便于附带脚本、参考资料和资源文件。

一个项目最好只选用一种约定并保持一致。多个兼容 Agent Skills 的工具共享仓库资源时，可选择 `.agents/skills/`；需要明确归 Pi 管理时，可选择 `.pi/skills/`。

## 最小 SKILL.md

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

必需的 Frontmatter：

| 字段 | 要求 |
|---|---|
| `name` | 1–64 个字符，只能包含小写字母、数字和连字符 |
| `description` | 说明 Skill 的作用以及 Pi 应在什么情况下使用它 |

`description` 尤其重要。Pi 会把 Skill 名称和描述放入系统提示词，只在需要时加载完整指令。

## 工作流配置

当 Skill 提交在 `.pi/skills/` 或 `.agents/skills/` 下时，不需要专门的 Skill 输入：

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

请将 `<tested-version>` 替换为实际存在且经过验证的 Pi 版本或 SemVer 范围。Skill 行为取决于安装的 Pi 版本，生产工作流不应在未验证的情况下依赖 `latest`。

## 调用 Skill

Pi 可以根据描述自动选择 Skill：

```text
@pi-agent review this pull request for security and regressions
```

如需强制使用指定 Skill，在触发短语之后、任务开头写入 `/skill:<name>`：

```text
@pi-agent /skill:pr-review focus on concurrency and cleanup behavior
```

Skill 命令之后的参数会追加到加载后的 Skill 指令中。

直接触发也可以在 `direct_prompt` 中使用相同语法：

```yaml
with:
  direct_prompt: '/skill:pr-review focus on correctness and security'
```

## 管理多个 Skills

一个仓库可以包含多个小而专注的 Skills：

```text
.pi/skills/
├── pr-review/SKILL.md
├── test-debugging/SKILL.md
├── release-notes/SKILL.md
└── dependency-audit/SKILL.md
```

相比一个庞大的仓库手册，更推荐按任务拆分 Skill。共享背景资料可以放入参考文件，再从 `SKILL.md` 链接：

```markdown
Read [the architecture guide](references/architecture.md) only when the task changes service boundaries.
```

引用路径相对于 Skill 目录解析。

## 带脚本的 Skills

Skill 可以包含辅助脚本：

```text
.pi/skills/test-debugging/
├── SKILL.md
└── scripts/
    └── collect-diagnostics.sh
```

```markdown
Run `scripts/collect-diagnostics.sh` before investigating intermittent test failures.
```

pi-action 当前启用的工具策略始终优先：

| pi-action 模式 | Skill 可以执行的操作 |
|---|---|
| `write_mode: false` | 使用 `read`、`grep`、`find` 和 `ls` 读取与搜索文件 |
| `write_mode: true` | 还可以使用 `edit`、`write` 和 `bash` 编辑、写入及执行命令 |

Skill 无法自行获得被 pi-action 排除的工具。实验性的 `allowed-tools` Skill Frontmatter 也不能覆盖 Action 的 `--tools` 白名单。

如果 Skill 依赖脚本，但工作流处于只读模式，应改写 Skill，使用读取和搜索工具描述诊断步骤；或者只对可信事件启用写模式。

## 显式指定 Skill 路径

Pi 支持重复使用 `--skill <path>`。pi-action 当前没有专门的 `skills` 输入，但受信任的工作流配置可以使用 `extra_args`：

```yaml
with:
  extra_args: '--skill tools/pi-skills/pr-review/SKILL.md'
```

关闭所有自动 Skill 发现：

```yaml
with:
  extra_args: '--no-skills'
```

即使设置了 `--no-skills`，显式的 `--skill` 路径仍会追加加载：

```yaml
with:
  extra_args: '--no-skills --skill .pi/skills/pr-review/SKILL.md'
```

pi-action 按空白字符拆分 `extra_args`，因此这一兼容入口不支持包含空格的 Skill 路径。优先使用项目本地自动发现。

## 安全模型

仓库 Skills 是受信任的项目指令。Pull Request 可以在 pi-action 启动前修改 `SKILL.md`、脚本、参考资料或资源文件。

应遵循以下规则：

- 只读模式会把 Skill 限制在检查工具范围内，但不能阻止提示词注入或泄露 Pi 可读取的仓库内容；
- 写模式允许 Skill 指令编辑文件并执行 Shell 命令；
- 自定义提供商凭据对 Pi 进程可见，因此在写模式下也可能被 `bash` 访问；
- Checkout 仍必须设置 `persist-credentials: false`；
- Fork PR 应保持只读；
- 当事件本身不可信时，直接触发需要使用工作流级作者或分支限制。

在写模式下，只应从你信任其执行仓库自动化的分支和用户加载 Skills。对 Skill 的修改应接受与工作流或构建脚本同等级别的审查。

## Runner 上的全局 Skills

Pi 也会发现 `~/.pi/agent/skills/` 和 `~/.agents/skills/`。

GitHub 托管 Runner 是临时环境，因此全局 Skills 必须在 pi-action 运行前由 Job 安装。通常，项目本地且纳入版本控制的 Skills 更容易复现。

自托管 Runner 可能跨 Job 保留全局 Skills。应审计这些目录、固定版本，并把变更视为 Runner 配置变更。

## 本地验证

安装兼容的 Pi CLI 后，在仓库根目录运行：

```bash
pi --approve --no-session --tools read,grep,find,ls -p "/skill:pr-review review the current changes"
```

对于具备写入能力的 Skill，只应在一次性分支或工作区中运行：

```bash
pi --approve --no-session --tools read,grep,find,ls,edit,write,bash -p "/skill:test-debugging diagnose and fix the failing test"
```

验证以下事项：

- Skill 能够被发现，不会出现未知命令错误；
- 引用文件能相对于 Skill 目录正确解析；
- Skill 能在工作流提供的工具集下完成任务；
- Skill 不依赖未声明的本地软件或凭据；
- 最终响应适合作为 GitHub 评论发布。

## 编写检查清单

- 使用具体的 `description`，明确说明 Skill 适用的场景。
- 保持 `SKILL.md` 专注，把大型参考资料移到独立文件。
- 对脚本、参考资料和资源文件使用相对路径。
- 明确声明安装步骤和环境假设。
- 按 pi-action 所需的最低工具模式设计 Skill。
- 不要在 Skill 文件中放置 Secret 或 Secret 值。
- 像审查工作流和可执行脚本一样审查 Skill 变更。
- 同时测试自动选择和显式 `/skill:name` 调用。

完整的上游格式和发现规则请参阅 [Pi Skills 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)。
