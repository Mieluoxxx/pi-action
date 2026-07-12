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

type ActionCore = Pick<typeof core, 'info' | 'setFailed' | 'setOutput' | 'setSecret'>;
type Octokit = ReturnType<typeof github.getOctokit>;

export interface ActionDependencies {
  core: ActionCore;
  getContext: () => typeof github.context;
  getOctokit: (token: string) => Octokit;
  getToken: () => string;
  loadConfig: typeof loadConfig;
  ensurePiInstalled: typeof ensurePiInstalled;
  writeModelsJson: typeof writeModelsJson;
  runPi: typeof runPi;
  commitAndPush: typeof commitAndPush;
}

function tokenOrThrow(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN env var is required.');
  return token;
}

const DEFAULT_DEPENDENCIES: ActionDependencies = {
  core,
  getContext: () => github.context,
  getOctokit: (token) => github.getOctokit(token),
  getToken: tokenOrThrow,
  loadConfig,
  ensurePiInstalled,
  writeModelsJson,
  runPi,
  commitAndPush,
};

/** Execute the action. Dependency overrides keep orchestration testable without network access. */
export async function runAction(overrides: Partial<ActionDependencies> = {}): Promise<void> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const config = deps.loadConfig();
  const ctx = deps.getContext();
  const event = classifyEvent(ctx.eventName, ctx.payload);
  logEvent(event);

  const decision = decideTrigger(event, config, ctx.actor);
  if (!decision.run) {
    deps.core.info('Not triggered; exiting.');
    deps.core.setOutput('triggered', 'false');
    deps.core.setOutput('response', '');
    return;
  }
  deps.core.setOutput('triggered', 'true');

  if (!config.apiKey) throw new Error('`api_key` input is required.');
  deps.core.setSecret(config.apiKey);
  await deps.ensurePiInstalled(config.piVersion, config.installArgs);
  if (config.baseUrl) {
    const file = deps.writeModelsJson(
      buildModelsJson({
        baseUrl: config.baseUrl,
        api: config.api,
        modelId: config.model,
        apiKeyEnv: 'PI_API_KEY',
      }),
    );
    deps.core.info(`Wrote custom provider config to ${file}`);
    process.env.PI_API_KEY = config.apiKey;
  }

  const octokit = deps.getOctokit(deps.getToken());
  const repo: RepoInfo = { owner: ctx.repo.owner, repo: ctx.repo.repo };

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
    deps.core.info('Unsupported event after trigger decision.');
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

  const result = await deps.runPi({
    prompt,
    config,
    cwd: process.cwd(),
    timeoutMs: config.timeoutSeconds * 1000,
  });

  let pushed = false;
  let changedFiles = [...result.writtenFiles];
  if (config.writeMode && branch.length > 0) {
    const pushResult = await deps.commitAndPush({
      token: deps.getToken(),
      repo,
      branch,
      message: `pi-action: ${decision.task.slice(0, 72) || 'changes'}`,
      cwd: process.cwd(),
      botId: config.botId,
      botName: config.botName,
    });
    pushed = pushResult.pushed;
    changedFiles = [...new Set([...changedFiles, ...pushResult.changedFiles])];
  }

  const body = buildCommentBody({
    text: result.text,
    errorMessage: result.errorMessage,
    writtenFiles: changedFiles,
    pushed,
    triggeredBy: decision.triggeredBy,
  });
  await octokit.rest.issues.createComment({
    owner: repo.owner,
    repo: repo.repo,
    issue_number: target.number,
    body,
  });

  deps.core.setOutput('response', result.text.slice(0, RESPONSE_LIMIT));
  if (!result.ok) {
    deps.core.setFailed(result.errorMessage ?? 'pi did not produce a result');
  }
}
