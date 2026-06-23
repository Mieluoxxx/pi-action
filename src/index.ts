import * as core from '@actions/core';
import * as github from '@actions/github';
import { loadConfig } from './config';
import { decideTrigger } from './decisions';
import { classifyEvent, logEvent } from './events';
import { type RepoInfo, buildCommentBody, commitAndPush } from './github';
import { ensurePiInstalled } from './install';
import { buildModelsJson, writeModelsJson } from './models-config';
import { runPi } from './pi-runner';
import { type TargetContext, buildPrompt } from './prompt';

const RESPONSE_LIMIT = 60_000;

function tokenOrThrow(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN env var is required.');
  return token;
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.apiKey) throw new Error('`api_key` input is required.');

  await ensurePiInstalled(config.piVersion, config.installArgs);
  if (config.baseUrl) {
    const file = writeModelsJson(
      buildModelsJson({
        baseUrl: config.baseUrl,
        api: config.api,
        modelId: config.model,
        apiKeyEnv: 'PI_API_KEY',
      }),
    );
    core.info(`Wrote custom provider config to ${file}`);
    core.setSecret(config.apiKey);
    process.env.PI_API_KEY = config.apiKey;
  }

  const ctx = github.context;
  const event = classifyEvent(ctx.eventName, ctx.payload);
  logEvent(event);

  const decision = decideTrigger(event, config, ctx.actor);
  if (!decision.run) {
    core.info('Not triggered; exiting.');
    core.setOutput('triggered', 'false');
    core.setOutput('response', '');
    return;
  }
  core.setOutput('triggered', 'true');

  const octokit = github.getOctokit(tokenOrThrow());
  const repo: RepoInfo = { owner: ctx.repo.owner, repo: ctx.repo.repo };

  // Resolve target metadata + branch + optional diff.
  let target: TargetContext;
  let branch = '';
  if (event.kind === 'pull_request') {
    target = {
      kind: 'pull_request',
      number: event.number,
      title: event.title,
      body: event.body,
      author: event.login,
    };
    branch = event.headRef;
  } else if (event.kind === 'issues') {
    target = {
      kind: 'issues',
      number: event.number,
      title: event.title,
      body: event.body,
      author: event.login,
    };
  } else if (event.kind === 'issue_comment') {
    if (event.isPr) {
      const pr = await octokit.rest.pulls.get({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: event.number,
      });
      target = {
        kind: 'pull_request',
        number: event.number,
        title: pr.data.title,
        body: pr.data.body ?? '',
        author: pr.data.user?.login ?? '',
      };
      branch = pr.data.head.ref;
    } else {
      const issue = await octokit.rest.issues.get({
        owner: repo.owner,
        repo: repo.repo,
        issue_number: event.number,
      });
      target = {
        kind: 'issues',
        number: event.number,
        title: issue.data.title,
        body: issue.data.body ?? '',
        author: issue.data.user?.login ?? '',
      };
    }
  } else {
    core.info('Unsupported event after trigger decision.');
    return;
  }

  let diff: string | undefined;
  if (target.kind === 'pull_request') {
    const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner: repo.owner,
      repo: repo.repo,
      pull_number: target.number,
      headers: { accept: 'application/vnd.github.v3.diff' },
    });
    diff = typeof res.data === 'string' ? res.data : '';
  }

  const prompt = buildPrompt({
    task: decision.task,
    target,
    diff,
    repo,
    writeMode: config.writeMode,
    triggeredBy: decision.triggeredBy,
  });

  const result = await runPi({ prompt, config, cwd: process.cwd() });

  let pushed = false;
  if (config.writeMode && result.writtenFiles.length > 0 && branch.length > 0) {
    const pushResult = await commitAndPush({
      token: tokenOrThrow(),
      repo,
      branch,
      message: `pi-action: ${decision.task.slice(0, 72) || 'changes'}`,
      cwd: process.cwd(),
    });
    pushed = pushResult.pushed;
  }

  const body = buildCommentBody({
    text: result.text,
    errorMessage: result.errorMessage,
    writtenFiles: result.writtenFiles,
    pushed,
    triggeredBy: decision.triggeredBy,
  });
  await octokit.rest.issues.createComment({
    owner: repo.owner,
    repo: repo.repo,
    issue_number: target.number,
    body,
  });

  core.setOutput('response', result.text.slice(0, RESPONSE_LIMIT));
  if (!result.ok) {
    core.setFailed(result.errorMessage ?? 'pi did not produce a result');
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  core.setFailed(message);
});
