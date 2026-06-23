export interface TargetContext {
  kind: 'pull_request' | 'issues';
  number: number;
  title: string;
  body: string;
  author: string;
}

export interface PromptInput {
  task: string;
  target: TargetContext;
  diff?: string;
  repo: { owner: string; repo: string };
  writeMode: boolean;
  triggeredBy: string;
}

const DIFF_MAX_CHARS = 60_000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…[truncated ${text.length - max} chars]`;
}

function describeTarget(t: TargetContext): string {
  return t.kind === 'pull_request' ? `pull request #${t.number}` : `issue #${t.number}`;
}

/** Compose the initial user prompt that pi will act on. Pure function. */
export function buildPrompt(input: PromptInput): string {
  const lines: string[] = [];
  const noun = describeTarget(input.target);

  lines.push(
    `You are pi-action, running inside GitHub Actions to help with ${noun} in ${input.repo.owner}/${input.repo.repo}.`,
  );
  lines.push('');
  lines.push('## Task');
  lines.push(
    input.task.trim().length > 0
      ? input.task.trim()
      : '(no explicit instruction — summarize and triage this item)',
  );
  lines.push('');
  lines.push(`## ${input.target.kind === 'pull_request' ? 'Pull Request' : 'Issue'}`);
  lines.push(`- Title: ${input.target.title}`);
  lines.push(`- Author: @${input.target.author}`);
  if (input.target.body.trim()) {
    lines.push('- Body:');
    lines.push('---');
    lines.push(truncate(input.target.body.trim(), 20_000));
    lines.push('---');
  }

  if (input.diff?.trim()) {
    lines.push('');
    lines.push('## Diff');
    lines.push('```diff');
    lines.push(truncate(input.diff.trim(), DIFF_MAX_CHARS));
    lines.push('```');
  }

  lines.push('');
  lines.push('## Constraints');
  if (input.writeMode) {
    lines.push(
      '- You may edit files; changes will be committed and pushed automatically to the PR branch.',
    );
    lines.push('- Keep changes minimal and focused on the task.');
  } else {
    lines.push('- You are in READ-ONLY mode: do not attempt to write or edit files.');
    lines.push('- Investigate using read/grep/find/ls only.');
  }
  lines.push('- Be concise and technical.');
  lines.push(
    '- Your final message becomes a GitHub comment: use Markdown, lead with the conclusion.',
  );

  lines.push('');
  lines.push(`Triggered by @${input.triggeredBy}.`);

  return lines.join('\n');
}
