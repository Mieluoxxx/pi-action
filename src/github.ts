import * as core from '@actions/core';
import * as exec from '@actions/exec';

export interface RepoInfo {
  owner: string;
  repo: string;
}

export interface CommentInput {
  text: string;
  errorMessage?: string;
  writtenFiles: readonly string[];
  pushed: boolean;
  triggeredBy: string;
}

/** Build the token-bearing remote URL. Token must be masked via core.setSecret at call site. */
export function buildRemoteUrl(token: string, owner: string, repo: string): string {
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

/** Compose the Markdown comment posted back to the issue/PR. Pure function. */
export function buildCommentBody(input: CommentInput): string {
  const parts: string[] = [];
  parts.push(input.text.trim().length > 0 ? input.text : '_(pi produced no output)_');

  if (input.pushed && input.writtenFiles.length > 0) {
    const list = input.writtenFiles.map((f) => `\`${f}\``).join(', ');
    parts.push('', `**Committed changes to:** ${list}`);
  }

  if (input.errorMessage) {
    parts.push('', `> ⚠️ ${input.errorMessage}`);
  }

  parts.push(
    '',
    `<sub>🤖 Generated with [pi-action](https://github.com/earendil-works/pi) · triggered by @${input.triggeredBy}</sub>`,
  );
  return parts.join('\n');
}

export interface CommitOptions {
  token: string;
  repo: RepoInfo;
  branch: string;
  message: string;
  cwd: string;
  botId: string;
  botName: string;
}

export interface CommitResult {
  pushed: boolean;
  commitSha: string;
}

async function capture(cmd: string, args: string[], cwd: string): Promise<string> {
  let out = '';
  await exec.exec(cmd, args, {
    cwd,
    silent: true,
    ignoreReturnCode: true,
    listeners: {
      stdout: (d) => {
        out += d.toString();
      },
    },
  });
  return out;
}

/** Stage, commit, and push any working-tree changes. Returns pushed=false if nothing to commit. */
export async function commitAndPush(opts: CommitOptions): Promise<CommitResult> {
  core.setSecret(opts.token);
  await exec.exec(
    'git',
    ['config', 'remote.origin.url', buildRemoteUrl(opts.token, opts.repo.owner, opts.repo.repo)],
    {
      cwd: opts.cwd,
      silent: true,
    },
  );
  await exec.exec('git', ['add', '-A'], { cwd: opts.cwd });

  const staged = await capture('git', ['diff', '--cached', '--name-only'], opts.cwd);
  if (!staged.trim()) {
    core.info('No changes to commit.');
    return { pushed: false, commitSha: '' };
  }

  const author = opts.botId
    ? `${opts.botName} <${opts.botId}+${opts.botName}@users.noreply.github.com>`
    : `${opts.botName} <actions@github.com>`;
  await exec.exec('git', ['commit', '-m', opts.message, '--author', author], { cwd: opts.cwd });
  await exec.exec('git', ['push', 'origin', `HEAD:${opts.branch}`], {
    cwd: opts.cwd,
    silent: true,
  });

  const sha = await capture('git', ['rev-parse', 'HEAD'], opts.cwd);
  core.info(`Pushed commit ${sha.trim()}`);
  return { pushed: true, commitSha: sha.trim() };
}
