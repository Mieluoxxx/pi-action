import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { type ActionDependencies, runAction } from '../src/action';
import type { Config } from '../src/config';
import type { CommitOptions, CommitResult } from '../src/github';
import type { PiResult, RunPiOptions } from '../src/pi-runner';

type GithubModule = typeof import('@actions/github');
type GithubContext = GithubModule['context'];
type Octokit = ReturnType<GithubModule['getOctokit']>;

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    piVersion: 'latest',
    provider: 'anthropic',
    model: '',
    apiKey: 'provider-key',
    baseUrl: '',
    api: 'anthropic-messages',
    triggerPhrase: '@pi-agent',
    directPrompt: '',
    writeMode: false,
    thinking: 'medium',
    systemPrompt: '',
    appendSystemPrompt: '',
    excludeTools: [],
    extraArgs: [],
    installArgs: [],
    timeoutSeconds: 600,
    allowedUsers: [],
    botId: '',
    botName: 'pi-action[bot]',
    ...overrides,
  };
}

function makeContext(eventName: string, payload: unknown, actor = 'alice'): GithubContext {
  return {
    eventName,
    payload,
    actor,
    repo: { owner: 'acme', repo: 'demo' },
  } as unknown as GithubContext;
}

function makeCoreRecorder(): {
  core: ActionDependencies['core'];
  outputs: Record<string, unknown>;
  failures: string[];
  secrets: string[];
} {
  const outputs: Record<string, unknown> = {};
  const failures: string[] = [];
  const secrets: string[] = [];
  return {
    core: {
      info: () => {},
      setOutput: (name, value) => {
        outputs[name] = value;
      },
      setFailed: (message) => {
        failures.push(message instanceof Error ? message.message : String(message));
      },
      setSecret: (secret) => {
        secrets.push(secret);
      },
    },
    outputs,
    failures,
    secrets,
  };
}

function piResult(overrides: Partial<PiResult> = {}): PiResult {
  return {
    ok: true,
    text: 'Pi response',
    exitCode: 0,
    writtenFiles: [],
    toolCalls: 0,
    ...overrides,
  };
}

test('runAction exits before installation and API-key validation when not triggered', async () => {
  const recorder = makeCoreRecorder();
  let installs = 0;

  await runAction({
    core: recorder.core,
    loadConfig: () => makeConfig({ apiKey: '' }),
    getContext: () =>
      makeContext('issue_comment', {
        action: 'created',
        issue: { number: 3 },
        comment: {
          id: 9,
          body: 'ordinary comment',
          user: { login: 'alice' },
          author_association: 'OWNER',
        },
      }),
    ensurePiInstalled: async () => {
      installs += 1;
    },
  });

  assert.equal(installs, 0);
  assert.deepEqual(recorder.outputs, { triggered: 'false', response: '' });
  assert.deepEqual(recorder.failures, []);
});

test('runAction rejects a triggered run without an API key before installation', async () => {
  const recorder = makeCoreRecorder();
  let installs = 0;
  await assert.rejects(
    runAction({
      core: recorder.core,
      loadConfig: () => makeConfig({ apiKey: '', directPrompt: 'Triage this issue.' }),
      getContext: () =>
        makeContext('issues', {
          action: 'opened',
          issue: { number: 4, title: 'Bug', body: '', user: { login: 'bob' } },
        }),
      ensurePiInstalled: async () => {
        installs += 1;
      },
    }),
    /api_key.*required/,
  );
  assert.equal(installs, 0);
  assert.equal(recorder.outputs.triggered, 'true');
});

test('runAction handles a direct issue event and posts the response', async () => {
  const recorder = makeCoreRecorder();
  let installed: { version: string; args: readonly string[] } | undefined;
  let runOptions: RunPiOptions | undefined;
  let commentBody = '';
  const octokit = {
    rest: {
      issues: {
        createComment: async (input: { body: string }) => {
          commentBody = input.body;
          return { data: {} };
        },
      },
    },
    request: async () => ({ data: '' }),
  } as unknown as Octokit;

  await runAction({
    core: recorder.core,
    loadConfig: () =>
      makeConfig({ directPrompt: 'Triage this issue.', installArgs: ['--prefer-offline'] }),
    getContext: () =>
      makeContext('issues', {
        action: 'opened',
        issue: { number: 4, title: 'Bug report', body: 'Steps', user: { login: 'bob' } },
      }),
    getToken: () => 'github-token',
    getOctokit: () => octokit,
    ensurePiInstalled: async (version, args) => {
      installed = { version, args };
    },
    runPi: async (options) => {
      runOptions = options;
      return piResult({ text: 'Needs more information.' });
    },
  });

  assert.deepEqual(installed, { version: 'latest', args: ['--prefer-offline'] });
  assert.match(runOptions?.prompt ?? '', /Triage this issue\./);
  assert.match(runOptions?.prompt ?? '', /Bug report/);
  assert.equal(runOptions?.timeoutMs, 600_000);
  assert.match(commentBody, /Needs more information\./);
  assert.deepEqual(recorder.outputs, {
    triggered: 'true',
    response: 'Needs more information.',
  });
  assert.deepEqual(recorder.secrets, ['provider-key']);
});

test('runAction resolves PR comments, writes custom model config, and commits bash changes', async (t) => {
  const recorder = makeCoreRecorder();
  const originalPiKey = process.env.PI_API_KEY;
  t.after(() => {
    if (originalPiKey === undefined) Reflect.deleteProperty(process.env, 'PI_API_KEY');
    else process.env.PI_API_KEY = originalPiKey;
  });
  let modelsJson = '';
  let runOptions: RunPiOptions | undefined;
  let commitOptions: CommitOptions | undefined;
  let commentBody = '';
  const octokit = {
    rest: {
      pulls: {
        get: async () => ({
          data: {
            title: 'Improve feature',
            body: 'PR body',
            user: { login: 'contributor' },
            head: { ref: 'feature-branch' },
          },
        }),
      },
      issues: {
        createComment: async (input: { body: string }) => {
          commentBody = input.body;
          return { data: {} };
        },
      },
    },
    request: async () => ({ data: '+changed line' }),
  } as unknown as Octokit;

  await runAction({
    core: recorder.core,
    loadConfig: () =>
      makeConfig({
        provider: 'custom',
        model: 'custom-model',
        baseUrl: 'https://gateway.example',
        writeMode: true,
        botId: '123',
      }),
    getContext: () =>
      makeContext('issue_comment', {
        action: 'created',
        issue: { number: 8, pull_request: {} },
        comment: {
          id: 10,
          body: '@pi-agent implement this',
          user: { login: 'alice' },
          author_association: 'OWNER',
        },
      }),
    getToken: () => 'github-token',
    getOctokit: () => octokit,
    ensurePiInstalled: async () => {},
    writeModelsJson: (content) => {
      modelsJson = content;
      return '/tmp/models.json';
    },
    runPi: async (options) => {
      runOptions = options;
      return piResult({ text: 'Implemented.', writtenFiles: [] });
    },
    commitAndPush: async (options): Promise<CommitResult> => {
      commitOptions = options;
      return { pushed: true, commitSha: 'abc', changedFiles: ['generated.txt'] };
    },
  });

  assert.equal(JSON.parse(modelsJson).providers.custom.apiKey, '$PI_API_KEY');
  assert.equal(process.env.PI_API_KEY, 'provider-key');
  assert.match(runOptions?.prompt ?? '', /\+changed line/);
  assert.match(runOptions?.prompt ?? '', /implement this/);
  assert.equal(commitOptions?.branch, 'feature-branch');
  assert.match(commitOptions?.message ?? '', /implement this/);
  assert.match(commentBody, /Committed changes to.*`generated\.txt`/s);
  assert.deepEqual(recorder.secrets, ['provider-key']);
});

test('runAction resolves issue comments and marks failed Pi runs after commenting', async () => {
  const recorder = makeCoreRecorder();
  let commentBody = '';
  let commits = 0;
  const octokit = {
    rest: {
      issues: {
        get: async () => ({
          data: { title: 'Issue title', body: null, user: { login: 'reporter' } },
        }),
        createComment: async (input: { body: string }) => {
          commentBody = input.body;
          return { data: {} };
        },
      },
    },
    request: async () => ({ data: '' }),
  } as unknown as Octokit;

  await runAction({
    core: recorder.core,
    loadConfig: () => makeConfig({ writeMode: true }),
    getContext: () =>
      makeContext('issue_comment', {
        action: 'created',
        issue: { number: 11 },
        comment: {
          id: 12,
          body: '@pi-agent investigate',
          user: { login: 'alice' },
          author_association: 'MEMBER',
        },
      }),
    getToken: () => 'github-token',
    getOctokit: () => octokit,
    ensurePiInstalled: async () => {},
    runPi: async () =>
      piResult({ ok: false, text: '', errorMessage: 'provider failed', exitCode: 1 }),
    commitAndPush: async () => {
      commits += 1;
      return { pushed: false, commitSha: '', changedFiles: [] };
    },
  });

  assert.equal(commits, 0);
  assert.match(commentBody, /pi produced no output/);
  assert.match(commentBody, /provider failed/);
  assert.deepEqual(recorder.failures, ['provider failed']);
});

test('runAction truncates the response output while preserving the full comment', async () => {
  const recorder = makeCoreRecorder();
  const text = 'x'.repeat(60_100);
  let commentBody = '';
  const octokit = {
    rest: {
      issues: {
        createComment: async (input: { body: string }) => {
          commentBody = input.body;
          return { data: {} };
        },
      },
    },
    request: async () => ({ data: { unexpected: true } }),
  } as unknown as Octokit;

  await runAction({
    core: recorder.core,
    loadConfig: () => makeConfig({ directPrompt: 'Review this PR.' }),
    getContext: () =>
      makeContext('pull_request', {
        action: 'opened',
        number: 5,
        pull_request: {
          title: 'PR title',
          body: '',
          user: { login: 'alice' },
          head: { ref: 'feature' },
          base: { ref: 'main' },
        },
      }),
    getToken: () => 'github-token',
    getOctokit: () => octokit,
    ensurePiInstalled: async () => {},
    runPi: async () => piResult({ text }),
  });

  assert.equal(String(recorder.outputs.response).length, 60_000);
  assert.ok(commentBody.includes(text));
});
